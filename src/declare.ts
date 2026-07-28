import { chromium, type Locator, type Page } from "playwright";
import { declarationState, hasBotChallenge, isLoginPage, isOtpPage } from "./flow.js";

const MY_PAGE_URL = "https://my.mineo.jp/";
const timeout = 20_000;

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

async function visibleText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout });
}

async function currentDeclarationState(page: Page): Promise<ReturnType<typeof declarationState>> {
  const flagControl = page.locator('input[name="devolveSengenFlg"]');
  const flag = await flagControl.count() === 1
    ? await flagControl.getAttribute("value")
    : undefined;
  return declarationState(await visibleText(page), flag);
}

async function firstVisible(candidates: Locator[]): Promise<Locator | undefined> {
  for (const candidate of candidates) {
    const matches = await candidate.all();
    for (const match of matches) {
      if (await match.isVisible().catch(() => false)) return match;
    }
  }
  return undefined;
}

async function declarationControl(page: Page): Promise<Locator | undefined> {
  return firstVisible([
    page.getByRole("button", { name: /ゆずるね.*宣言(?:する|します)?/ }),
    page.locator('input[type="button"][value*="宣言"], input[type="submit"][value*="宣言"]'),
  ]);
}

async function declarationLink(page: Page): Promise<Locator | undefined> {
  return firstVisible([
    page.getByRole("link", { name: /ゆずるね.*宣言(?:する|します)?/ }),
  ]);
}

async function clickAndWaitForNavigation(page: Page, control: Locator): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout }).catch(() => undefined),
    control.click({ timeout }),
  ]);
}

/**
 * Returns a privacy-safe description of the current page for diagnostics:
 * URL path, title, and generic form-control labels only. Never includes page
 * text, which may contain personal information.
 */
async function pageFingerprint(page: Page): Promise<string> {
  const url = new URL(page.url());
  const title = await page.title().catch(() => "");
  const controls = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, input"))
      .map((el) => {
        const label = el instanceof HTMLInputElement
          ? (el.value || el.getAttribute("alt") || el.name || el.type)
          : (el.textContent || "").trim();
        return label.replace(/\s+/g, " ").slice(0, 40);
      })
      .filter((label) => label.length > 0)
      .slice(0, 10),
  ).catch(() => [] as string[]);
  return `url=${url.origin}${url.pathname} title=${JSON.stringify(title)} controls=${JSON.stringify(controls)}`;
}

/**
 * Handles known interstitial pages between login and the my page top, such as
 * device-trust registration or informational notices. Returns true when an
 * action was taken and the caller should re-evaluate the page.
 */
async function handleIntermediatePage(page: Page): Promise<boolean> {
  const text = await visibleText(page);
  if (hasBotChallenge(text)) fail("BOT_CHALLENGE", "bot challenge detected; no attempt was made to bypass it");

  // An OTP page that actually shows an input cannot be handled unattended.
  if (isOtpPage(text)) {
    const editable = await firstVisible([
      page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="checkbox"])'),
    ]);
    if (editable) fail("OTP_REQUIRED", "mineo requested a one-time key; refresh the trusted-device session");
  }

  // "Register this device as trusted" style prompts: tick the trust box.
  await page.evaluate(() => {
    for (const box of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      const labelText = box.closest("label")?.innerText || box.parentElement?.innerText || "";
      if (/信頼/.test(labelText) && !box.checked) box.click();
    }
  }).catch(() => undefined);

  const continueControl = await firstVisible([
    page.getByRole("button", { name: "次へ", exact: true }),
    page.getByRole("button", { name: /同意する/ }),
    page.locator('input[type="submit"][value*="次へ"], input[type="submit"][value*="登録"], input[type="submit"][value*="同意"], input[type="submit"][value="OK"], input[type="submit"][value*="閉じる"]'),
    page.getByRole("link", { name: /マイページ/ }),
  ]);
  if (!continueControl) return false;
  await clickAndWaitForNavigation(page, continueControl);
  return true;
}

/**
 * Brings the browser to a page that exposes the Yuzurune declaration UI,
 * passing through login and known interstitial pages.
 */
async function ensureOnDeclarationPage(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await authenticateIfNeeded(page);
    const state = await currentDeclarationState(page);
    if (state !== "unknown") return;
    if (await declarationControl(page) || await declarationLink(page)) return;

    if (await handleIntermediatePage(page)) continue;

    // Unknown page: navigate back to the my page top and retry.
    await page.goto(MY_PAGE_URL, { waitUntil: "domcontentloaded", timeout });
  }
  fail("DECLARATION_CONTROL_NOT_FOUND", `no supported declaration page reached (${await pageFingerprint(page)})`);
}

async function authenticateIfNeeded(page: Page): Promise<void> {
  let text = await visibleText(page);
  if (hasBotChallenge(text)) fail("BOT_CHALLENGE", "bot challenge detected; no attempt was made to bypass it");
  if (!isLoginPage(page.url(), text)) return;

  const eoId = process.env.MINEO_EOID;
  const password = process.env.MINEO_PASSWORD;
  if (!eoId || !password) {
    fail("SESSION_EXPIRED", "the session expired and MINEO_EOID or MINEO_PASSWORD is not configured");
  }

  // Step 1: submit the eoID and wait for the password page to actually load.
  const idInput = page.getByRole("textbox", { name: "eoID", exact: true });
  const nextButton = page.getByRole("button", { name: "次へ", exact: true });
  if (await idInput.count() !== 1 || await nextButton.count() !== 1) {
    fail("LOGIN_UI_CHANGED", "the eoID login controls were not found");
  }
  await idInput.fill(eoId);
  await clickAndWaitForNavigation(page, nextButton);

  // Step 2: wait for the real password field on the new page. Without this
  // wait, the previous page (eoID form) is still rendered and its textbox can
  // be mistaken for the password field.
  const passwordInput = page.getByPlaceholder("eoIDパスワード", { exact: true })
    .or(page.locator('input[type="password"]'));
  const passwordAppeared = await passwordInput.first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!passwordAppeared) {
    text = await visibleText(page);
    if (hasBotChallenge(text)) fail("BOT_CHALLENGE", "bot challenge detected; no attempt was made to bypass it");
    if (isOtpPage(text)) fail("OTP_REQUIRED", "mineo requested a one-time key before the password page; refresh the trusted-device session");
    fail("LOGIN_UI_CHANGED", "the password field did not appear after submitting the eoID");
  }
  await passwordInput.first().fill(password);

  const loginButton = await firstVisible([
    page.getByRole("button", { name: "ログイン", exact: true }),
    page.locator('input[type="submit"][value="ログイン"]'),
    page.locator('input[type="image"][alt*="ログイン"]'),
    page.getByText("ログイン", { exact: true }),
  ]);
  if (!loginButton) {
    fail("LOGIN_UI_CHANGED", "the login button was not found on the password page");
  }
  await clickAndWaitForNavigation(page, loginButton);

  text = await visibleText(page);
  if (hasBotChallenge(text)) fail("BOT_CHALLENGE", "bot challenge detected; no attempt was made to bypass it");
  if (isOtpPage(text)) fail("OTP_REQUIRED", "mineo requested a one-time key; refresh the trusted-device session");
  if (/ログイン情報が正しくありません/.test(text)) {
    fail("CREDENTIALS_REJECTED", "mineo rejected the eoID/password; re-enter MINEO_EOID and MINEO_PASSWORD secrets carefully (paste from a password manager, do not retype)");
  }
  if (isLoginPage(page.url(), text)) fail("LOGIN_FAILED", "mineo did not accept the saved credentials");
}

async function main(): Promise<void> {
  const statePath = process.env.MINEO_STORAGE_STATE_PATH;
  if (!statePath) fail("CONFIGURATION", "MINEO_STORAGE_STATE_PATH is not set");

  // mineo accepts the stable Chrome channel used during bootstrap, while its
  // login may reject automation-controlled browsers. Launch stable Chrome
  // without automation markers.
  const headless = process.env.MINEO_HEADLESS !== "false";
  const browser = await chromium.launch({
    channel: "chrome",
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  try {
    const chromeVersion = browser.version();
    const context = await browser.newContext({
      storageState: statePath,
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
      viewport: { width: 1366, height: 768 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      const w = window as unknown as { chrome?: unknown };
      w.chrome = w.chrome ?? { runtime: {} };
    });
    const page = await context.newPage();
    await page.goto(MY_PAGE_URL, { waitUntil: "domcontentloaded", timeout });
    await ensureOnDeclarationPage(page);

    let state = await currentDeclarationState(page);
    if (state === "declared") {
      await context.storageState({ path: statePath }).catch(() => undefined);
      console.log("YUZURUNE_ALREADY_DECLARED");
      return;
    }

    let control = await declarationControl(page);
    if (!control) {
      const link = await declarationLink(page);
      if (!link) {
        fail("DECLARATION_CONTROL_NOT_FOUND", "no supported declaration control was visible; mineo UI may have changed");
      }
      await link.click({ timeout });
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await authenticateIfNeeded(page);
      control = await declarationControl(page);
      if (!control) {
        fail("DECLARATION_CONTROL_NOT_FOUND", "the declaration page opened, but no declaration control was visible");
      }
    }

    await control.click({ timeout });
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await authenticateIfNeeded(page);
    await page.waitForTimeout(500);
    state = await currentDeclarationState(page);

    if (state !== "declared") {
      fail("DECLARATION_NOT_CONFIRMED", "the confirmation text was not found after clicking the declaration control");
    }
    await context.storageState({ path: statePath }).catch(() => undefined);
    console.log("YUZURUNE_DECLARED");
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unexpected error";
  console.error(message);
  process.exitCode = 1;
});

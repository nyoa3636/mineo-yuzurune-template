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
    if (await candidate.count() > 0 && await candidate.first().isVisible().catch(() => false)) {
      return candidate.first();
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
    page.waitForLoadState("domcontentloaded").catch(() => undefined),
    control.click({ timeout }),
  ]);
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

  const idInput = page.getByRole("textbox", { name: "eoID", exact: true });
  const nextButton = page.getByRole("button", { name: "次へ", exact: true });
  if (await idInput.count() !== 1 || await nextButton.count() !== 1) {
    fail("LOGIN_UI_CHANGED", "the eoID login controls were not found");
  }
  await idInput.fill(eoId);
  await clickAndWaitForNavigation(page, nextButton);

  text = await visibleText(page);
  if (hasBotChallenge(text)) fail("BOT_CHALLENGE", "bot challenge detected; no attempt was made to bypass it");

  const passwordInput = page.locator('input[type="password"]');
  const loginButton = page.getByRole("button", { name: "ログイン", exact: true });
  if (await passwordInput.count() !== 1 || await loginButton.count() !== 1) {
    fail("LOGIN_UI_CHANGED", "the password login controls were not found");
  }
  await passwordInput.fill(password);
  await clickAndWaitForNavigation(page, loginButton);

  text = await visibleText(page);
  if (hasBotChallenge(text)) fail("BOT_CHALLENGE", "bot challenge detected; no attempt was made to bypass it");
  if (isOtpPage(text)) fail("OTP_REQUIRED", "mineo requested a one-time key; refresh the trusted-device session");
  if (isLoginPage(page.url(), text)) fail("LOGIN_FAILED", "mineo did not accept the saved credentials");
}

async function main(): Promise<void> {
  const statePath = process.env.MINEO_STORAGE_STATE_PATH;
  if (!statePath) fail("CONFIGURATION", "MINEO_STORAGE_STATE_PATH is not set");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: statePath, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
    const page = await context.newPage();
    await page.goto(MY_PAGE_URL, { waitUntil: "domcontentloaded", timeout });
    await authenticateIfNeeded(page);

    let state = await currentDeclarationState(page);
    if (state === "declared") {
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

import { chromium, type Locator, type Page } from "playwright";
import { declarationState, hasBotChallenge, isLoginPage } from "./flow.js";

const MY_PAGE_URL = "https://my.mineo.jp/";
const timeout = 20_000;

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

async function visibleText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout });
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

async function ensureAuthenticated(page: Page): Promise<void> {
  const text = await visibleText(page);
  if (hasBotChallenge(text)) fail("BOT_CHALLENGE", "bot challenge detected; no attempt was made to bypass it");
  if (isLoginPage(page.url(), text)) {
    fail("SESSION_EXPIRED", "the saved trusted-device session is no longer accepted; run bootstrap-session again");
  }
}

async function main(): Promise<void> {
  const statePath = process.env.MINEO_STORAGE_STATE_PATH;
  if (!statePath) fail("CONFIGURATION", "MINEO_STORAGE_STATE_PATH is not set");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: statePath, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
    const page = await context.newPage();
    await page.goto(MY_PAGE_URL, { waitUntil: "domcontentloaded", timeout });
    await ensureAuthenticated(page);

    let text = await visibleText(page);
    let state = declarationState(text);
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
      await ensureAuthenticated(page);
      control = await declarationControl(page);
      if (!control) {
        fail("DECLARATION_CONTROL_NOT_FOUND", "the declaration page opened, but no declaration control was visible");
      }
    }

    await control.click({ timeout });
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await ensureAuthenticated(page);
    await page.waitForTimeout(500);
    text = await visibleText(page);
    state = declarationState(text);

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

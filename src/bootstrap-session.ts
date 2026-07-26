import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { hasBotChallenge, isLoginPage } from "./flow.js";

const outputPath = resolve(process.cwd(), ".mineo-storage-state.json");

async function waitForLogin(page: Page): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  process.stdout.write("mineoへのログイン、ワンタイムキー入力、［この端末を信頼する］を完了してください。ログイン完了は自動で検出・保存します。\n");

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error("BROWSER_CLOSED: the browser was closed before login completed; no session was saved");
    }
    const text = await page.locator("body").innerText().catch(() => "");
    if (hasBotChallenge(text)) {
      throw new Error("BOT_CHALLENGE: bot challenge is displayed; no session was saved");
    }
    if (!isLoginPage(page.url(), text)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }

  throw new Error("LOGIN_TIMEOUT: login was not completed within 10 minutes; no session was saved");
}

// Use the locally installed stable Chrome for the one-time login. mineo may
// reject Chrome for Testing even when the same credentials work in Chrome.
// A fresh temporary profile is still used; the user's normal Chrome profile,
// saved passwords, and cookies are never read.
const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
  const context = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  await page.goto("https://my.mineo.jp/", { waitUntil: "domcontentloaded" });
  await waitForLogin(page);
  const text = await page.locator("body").innerText();
  if (hasBotChallenge(text)) {
    throw new Error("BOT_CHALLENGE: bot challenge is still displayed; no session was saved");
  }
  if (isLoginPage(page.url(), text)) {
    throw new Error("LOGIN_NOT_COMPLETE: the browser is still on a login page; no session was saved");
  }
  await context.storageState({ path: outputPath });
  await chmod(outputPath, 0o600).catch(() => undefined);
  console.log(`SESSION_SAVED: ${outputPath}`);
} finally {
  await browser.close();
}

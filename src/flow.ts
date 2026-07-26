export type DeclarationState = "declared" | "available" | "unknown";

/**
 * Determines the declaration state from visible Japanese UI text.  This is
 * deliberately independent of page markup so that it can be unit tested.
 */
export function declarationState(visibleText: string, declarationFlag?: string | null): DeclarationState {
  // mineo exposes the authoritative declaration state as a hidden form field.
  // The visible submit button can continue to say "宣言待ち" even after a
  // successful declaration, so prefer this signal when it is present.
  if (declarationFlag === "1") return "declared";
  if (declarationFlag === "0") return "available";

  const normalized = visibleText.replace(/\s/g, "");

  if (/ゆずるね。?(?:を)?宣言(?:済み|しました)/.test(normalized) || /宣言済み/.test(normalized)) {
    return "declared";
  }

  if (/ゆずるね。?(?:を)?宣言(?:する|します)/.test(normalized)) {
    return "available";
  }

  return "unknown";
}

export function isLoginPage(url: string, visibleText: string): boolean {
  return /(?:eonet\.jp|eoid|login)/i.test(url) || /(?:eoID|パスワード).{0,30}ログイン/.test(visibleText);
}

export function hasBotChallenge(visibleText: string): boolean {
  return /(?:captcha|recaptcha|私はロボットではありません|不正なアクセス)/i.test(visibleText);
}

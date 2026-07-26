import assert from "node:assert/strict";
import test from "node:test";
import { declarationState, hasBotChallenge, isLoginPage } from "../flow.js";

test("recognizes declared state", () => {
  assert.equal(declarationState("ゆずるね。を宣言済みです"), "declared");
  assert.equal(declarationState("ゆずるね。宣言しました"), "declared");
});

test("prefers mineo declaration flag over misleading button text", () => {
  assert.equal(declarationState("ゆずるね。宣言待ち", "1"), "declared");
  assert.equal(declarationState("ゆずるね。宣言済み", "0"), "available");
});

test("recognizes available declaration", () => {
  assert.equal(declarationState("明日のゆずるね。を宣言する"), "available");
});

test("does not guess unknown text", () => {
  assert.equal(declarationState("メンテナンス中です"), "unknown");
});

test("recognizes authentication and bot challenge pages", () => {
  assert.equal(isLoginPage("https://auth.eonet.jp/login", "ログイン"), true);
  assert.equal(hasBotChallenge("私はロボットではありません"), true);
});

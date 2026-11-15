import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../src/js/cloud.js";

test("写真の置き場所は 家庭/日付/時刻-乱数.jpg になる", () => {
  const p = C.photoPath("home", new Date(2026, 10, 14, 9, 5, 7), "abc123");
  assert.equal(p, "home/2026-11-14/090507-abc123.jpg");
});

test("家庭の名前に変な文字が入っていたら置き場所を作らない", () => {
  assert.throws(() => C.photoPath("../other"));
  assert.throws(() => C.photoPath(""));
  assert.throws(() => C.photoPath(null));
});

test("ログインの期限は、残り 60 秒を切ったら更新が要る", () => {
  assert.equal(C.needsRefresh(null), true);
  assert.equal(C.needsRefresh({ expires_at: 1000 }, 900), false);
  assert.equal(C.needsRefresh({ expires_at: 1000 }, 950), true);
  assert.equal(C.needsRefresh({ expires_at: 1000 }, 2000), true);
});

test("写真は長いほうの辺を 1600 に縮め、小さい写真は大きくしない", () => {
  assert.deepEqual(C.fitSize(4032, 3024), { w: 1600, h: 1200 });
  assert.deepEqual(C.fitSize(3024, 4032), { w: 1200, h: 1600 });
  assert.deepEqual(C.fitSize(800, 600), { w: 800, h: 600 });
});

test("端末に残すログイン状態にメールアドレスを入れない", () => {
  const s = C.keepSession({ access_token: "a", refresh_token: "r", expires_at: 123, user: { id: "u1", email: "someone@example.com" } });
  assert.deepEqual(Object.keys(s).sort(), ["access_token", "expires_at", "refresh_token", "user_id"]);
  assert.equal(JSON.stringify(s).includes("example.com"), false);
});

test("アプリのファイルに管理用の鍵が入っていない", () => {
  for (const f of ["../src/js/cloud.js", "../src/js/app.js", "../index.html", "../service-worker.js", "../tools/check_rules.py"]) {
    const text = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.equal(/sb_secret_[A-Za-z0-9_-]{8,}/.test(text), false, f);
    assert.equal(/service_role/.test(text) && /eyJ[A-Za-z0-9_-]{20,}/.test(text), false, f);
  }
});

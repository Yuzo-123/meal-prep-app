import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../src/js/cloud.js";

test("写真の置き場所は 家庭/日付/写真の指紋.jpg になる", () => {
  const p = C.photoPath("home", "0123456789abcdef", new Date(2026, 10, 14, 9, 5, 7));
  assert.equal(p, "home/2026-11-14/0123456789abcdef.jpg");
});

test("家庭の名前や指紋に変な文字が入っていたら置き場所を作らない", () => {
  assert.throws(() => C.photoPath("../other", "0123456789abcdef"));
  assert.throws(() => C.photoPath("", "0123456789abcdef"));
  assert.throws(() => C.photoPath(null, "0123456789abcdef"));
  assert.throws(() => C.photoPath("home", "../x"));
  assert.throws(() => C.photoPath("home", ""));
});

test("R-20 同じ写真なら同じ指紋、違う写真なら違う指紋になる", async () => {
  const a = await C.photoHash(new Blob([new Uint8Array([1, 2, 3])]));
  assert.equal(a, await C.photoHash(new Blob([new Uint8Array([1, 2, 3])])));
  assert.notEqual(a, await C.photoHash(new Blob([new Uint8Array([1, 2, 4])])));
  assert.match(a, /^[0-9a-f]{16}$/);
});

// サーバーの代わりに、決まった返事を返す fetch。呼ばれた URL と方法を控える。
function fakeServer(reply) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    const c = { url: String(url), method: opt.method || "GET", headers: opt.headers || {}, body: opt.body };
    calls.push(c);
    const [status, json] = reply(c);
    return new Response(json === undefined ? "" : JSON.stringify(json), { status });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const session = { access_token: "t" };

test("R-20 写真を送り直して置き場が「もうある」（HTTP 400 の中の 409）と返したら、成功として扱う", async () => {
  const s = fakeServer(() => [400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" }]);
  try {
    assert.equal(await C.uploadPhoto(session, "home/2026-11-17/0123456789abcdef.jpg", new Blob(["x"])), "home/2026-11-17/0123456789abcdef.jpg");
  } finally { s.restore(); }
  const t = fakeServer(() => [400, { statusCode: "400", error: "InvalidJWT", message: "bad" }]);
  try {
    await assert.rejects(C.uploadPhoto(session, "home/2026-11-17/0123456789abcdef.jpg", new Blob(["x"])));
  } finally { t.restore(); }
});

test("R-20 注文は画面で決めた番号で送り、もう入っていたら（空の返事）その注文を読み直して返す", async () => {
  const s = fakeServer((c) => c.method === "POST" ? [201, []] : [200, [{ id: "req-1", status: "working", week_start: "2026-11-23" }]]);
  try {
    const row = await C.sendRequest(session, "home", { week_start: "2026-11-23", text: "x" }, "req-1");
    assert.equal(row.status, "working");
    const post = s.calls[0];
    assert.match(post.url, /on_conflict=id/);
    assert.match(post.headers.Prefer, /resolution=ignore-duplicates/);
    assert.equal(JSON.parse(post.body).id, "req-1");
    assert.match(s.calls[1].url, /id=eq\.req-1/);
  } finally { s.restore(); }
});

test("R-22 週は印だけ先に取り、変わった週だけ中身を取りに行く", async () => {
  const stamps = [{ week_start: "2026-11-30", updated_at: "B2" }, { week_start: "2026-11-23", updated_at: "A" }];
  const s = fakeServer((c) => /bundle/.test(c.url) ? [200, [{ week_start: "2026-11-30", updated_at: "B2", bundle: {} }]] : [200, stamps]);
  try {
    const rows = await C.fetchWeeks(session, "home", { "2026-11-30": "B1", "2026-11-23": "A" });
    assert.equal(rows.length, 1);
    assert.equal(s.calls.length, 2);
    assert.doesNotMatch(s.calls[0].url, /bundle/);
    assert.match(s.calls[1].url, /week_start=in\.\(2026-11-30\)/);
  } finally { s.restore(); }
  const t = fakeServer(() => [200, stamps]);
  try {
    assert.deepEqual(await C.fetchWeeks(session, "home", { "2026-11-30": "B2", "2026-11-23": "A" }), []);
    assert.equal(t.calls.length, 1, "変わっていなければ中身は取りに行かない");
  } finally { t.restore(); }
});

test("R-22 品の一覧は、印が前と同じなら中身を取りに行かない", async () => {
  const s = fakeServer((c) => /data/.test(c.url) ? [200, [{ updated_at: "N", data: { dishes: [] } }]] : [200, [{ updated_at: "N" }]]);
  try {
    assert.equal(await C.fetchCatalog(session, "home", "N"), null);
    assert.equal(s.calls.length, 1);
    assert.equal((await C.fetchCatalog(session, "home", "OLD")).updated_at, "N");
    assert.equal((await C.fetchCatalog(session, "home", null)).updated_at, "N");
  } finally { s.restore(); }
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

test("R-13 端末に残すログイン状態にメールアドレスを入れない", () => {
  const s = C.keepSession({ access_token: "a", refresh_token: "r", expires_at: 123, user: { id: "u1", email: "someone@example.com" } });
  assert.deepEqual(Object.keys(s).sort(), ["access_token", "expires_at", "refresh_token", "user_id"]);
  assert.equal(JSON.stringify(s).includes("example.com"), false);
});

test("R-32 画面に出る文言に、作り手の呼び名（lio）を出さない", () => {
  // 2026-11-15 の Yuzo の指示。画面の骨組みと画面の動きのファイルを見る（計算の部品は、文字として書いた所だけ）
  for (const f of ["../index.html", "../src/js/app.js", "../manifest.json"]) {
    assert.equal(/lio/i.test(readFileSync(new URL(f, import.meta.url), "utf8")), false, f);
  }
  const model = readFileSync(new URL("../src/js/model.js", import.meta.url), "utf8");
  const strings = model.match(/"[^"\n]*"|`[^`]*`/g) || [];
  assert.deepEqual(strings.filter((s) => /lio/i.test(s)), []);
});

test("R-32 アプリのファイルに管理用の鍵が入っていない", () => {
  for (const f of ["../src/js/cloud.js", "../src/js/app.js", "../index.html", "../service-worker.js", "../tools/check_rules.py"]) {
    const text = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.equal(/sb_secret_[A-Za-z0-9_-]{8,}/.test(text), false, f);
    assert.equal(/service_role/.test(text) && /eyJ[A-Za-z0-9_-]{20,}/.test(text), false, f);
  }
});

test("R-23 ログインの更新でサーバーが不調（5xx）なら、ログイン状態は消さない。断られた（400・401）ときだけ消す", async () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const realFetch = globalThis.fetch;
  const old = { access_token: "a", refresh_token: "r", expires_at: 1, user_id: "u1" };
  try {
    for (const [status, kept] of [[503, true], [500, true], [400, false], [401, false]]) {
      mem["mealprep-session-v1"] = JSON.stringify(old);
      globalThis.fetch = async () => new Response(JSON.stringify({ msg: "x" }), { status });
      let thrown = false;
      try { await C.ensureSession(); } catch (e) { thrown = true; }
      assert.equal(!!C.getSession(), kept, `HTTP ${status}`);
      assert.equal(thrown, kept, `HTTP ${status} のとき、呼び出し元へ失敗を返すか`);
    }
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
  }
});

test("R-24 失敗の文は、使う人の言葉にする（アプリの日本語はそのまま、サーバーの英語や番号は出さない）", () => {
  assert.equal(C.friendlyError(new Error("サーバーにつながりません（電波を確かめてください）")), "サーバーにつながりません（電波を確かめてください）");
  const e401 = Object.assign(new Error("JWT expired"), { status: 401 });
  assert.match(C.friendlyError(e401), /ログインし直して/);
  const e503 = Object.assign(new Error("Service Unavailable"), { status: 503 });
  assert.match(C.friendlyError(e503), /もう一度試して/);
  assert.doesNotMatch(C.friendlyError(new Error("relation does not exist")), /relation/);
  assert.match(C.friendlyError(null), /もう一度試して/);
});

test("R-21 同じ週の注文が組まれている途中（409）なら、待ってほしいと伝える", async () => {
  const s = fakeServer(() => [409, { code: "23505", message: "duplicate key value violates unique constraint" }]);
  try {
    await assert.rejects(C.sendRequest(session, "home", { week_start: "2026-11-23" }, "req-2"), /いま組んでいるところ/);
  } finally { s.restore(); }
});

test("R-21 作り直しの取り消しは、手付かず（new）の注文だけを cancelled にする", async () => {
  const s = fakeServer(() => [200, [{ id: "req-1", status: "cancelled" }]]);
  try {
    assert.equal(await C.cancelRequest(session, "req-1"), true);
    const c = s.calls[0];
    assert.equal(c.method, "PATCH");
    assert.match(c.url, /id=eq\.req-1&status=eq\.new/);
    assert.equal(JSON.parse(c.body).status, "cancelled");
    assert.match(c.headers.Prefer, /return=representation/);
  } finally { s.restore(); }
  const t = fakeServer(() => [200, []]);
  try {
    assert.equal(await C.cancelRequest(session, "req-1"), false, "組み始めていたら取り消せない");
  } finally { t.restore(); }
});

test("R-30 画面の版の番号（APP_VERSION）と控えの番号（CACHE）がそろっている", () => {
  const app = readFileSync(new URL("../src/js/app.js", import.meta.url), "utf8").match(/APP_VERSION = "([\d.]+)"/)[1];
  const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8").match(/mealprep-([\d.]+)/)[1];
  assert.equal(app, sw);
});

test("R-31 画面に、ブラウザの「OK／キャンセル」の確認を使わない（押すと何が起きるかを書いた確認の画面を使う）", () => {
  const app = readFileSync(new URL("../src/js/app.js", import.meta.url), "utf8");
  assert.equal(/\bconfirm\(/.test(app), false);
});

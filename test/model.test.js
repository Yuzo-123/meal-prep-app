import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/js/model.js";

const bundle = () => ({
  format: "mealprep-week", version: 1, household: "home", week_start: "2026-11-16", memo: "テスト",
  days: { 月: { 朝: [{ id: "r1", name: "みそ汁", kind: "作りおき" }], 夜: [{ id: "x:トマト", name: "トマト", home: true }] } },
  cook_sunday: [{ id: "r1", name: "みそ汁", batches: 2, fridge: "3〜4日", freezer: "2週間", freezer_ok: true, print_page: 10 }],
  shopping: { buy: [{ name: "にんじん", amount: "2本", aisle: "野菜・きのこ・果物", for: ["みそ汁"] }, { name: "鶏もも肉", amount: "2枚", aisle: "肉", for: [] }], pantry: ["塩"], skip: [] },
  notes: [],
});

test("月〜金の日付は月をまたいでも正しい", () => {
  const ds = M.dayDates("2026-11-30");
  assert.deepEqual(ds.map((d) => `${d.month}/${d.date}`), ["11/30", "12/1", "12/2", "12/3", "12/4"]);
  assert.equal(M.weekSpan("2026-11-16"), "11/16〜11/20");
});

test("今日がその週なら曜日を返し、週の外なら null", () => {
  assert.equal(M.todayDay("2026-11-16", new Date(2026, 10, 18)), "水");
  assert.equal(M.todayDay("2026-11-16", new Date(2026, 10, 14)), null);
});

test("形の違うデータは理由つきで断る", () => {
  assert.ok(M.validateBundle({}).length > 0);
  assert.ok(M.validateBundle([]).length > 0);
  assert.deepEqual(M.validateBundle(bundle()), []);
  assert.throws(() => M.importBundle(M.emptyState(), { format: "x" }));
});

test("取り込むと、その週が家庭の区切りの下に入って表示中になる", () => {
  const s = M.importBundle(M.emptyState(), bundle());
  assert.equal(M.home(s).current, "2026-11-16");
  assert.equal(M.currentWeek(s).memo, "テスト");
  assert.ok(s.households.home.weeks["2026-11-16"]);
});

test("チェックの鍵は中身から作るので、取り込み直しても残る", () => {
  let s = M.importBundle(M.emptyState(), bundle());
  s = M.toggleCheck(s, "2026-11-16", "buy:にんじん", true);
  const again = bundle();
  again.shopping.buy.reverse(); // 並び順が変わっても
  s = M.importBundle(s, again);
  assert.equal(M.isDone(s, "2026-11-16", "buy:にんじん"), true);
  assert.equal(M.isDone(s, "2026-11-16", "buy:鶏もも肉"), false);
});

test("残りの数は調味料を分けて数えられ、外すと元に戻る", () => {
  let s = M.importBundle(M.emptyState(), bundle());
  const rows = M.shoppingRows(M.currentWeek(s));
  assert.equal(rows.length, 3);
  const buy = rows.filter((r) => !r.pantry);
  s = M.toggleCheck(s, "2026-11-16", "buy:にんじん", true);
  s = M.toggleCheck(s, "2026-11-16", "cook:r1", true);
  assert.deepEqual(M.progress(s, "2026-11-16", buy), { total: 2, left: 1, ratio: 0.5 });
  s = M.clearChecks(s, "2026-11-16", ["buy", "pantry"]);
  assert.equal(M.progress(s, "2026-11-16", buy).left, 2);
  assert.equal(M.isDone(s, "2026-11-16", "cook:r1"), true); // 日曜のチェックは消えない
});

test("日曜に作る品は回数と日持ちを持つ", () => {
  const [r] = M.cookRows(bundle());
  assert.equal(r.batches, 2);
  assert.equal(r.keep, "冷蔵 3〜4日・冷凍 2週間");
});

test("記録は週ごとに残り、書き出して読み戻せる", () => {
  let s = M.importBundle(M.emptyState(), bundle());
  s = M.setLog(s, "2026-11-16", { cook_minutes: "210", good: "朝が楽" });
  assert.equal(M.getLog(s, "2026-11-16").cook_minutes, "210");
  const back = M.fromBackup(JSON.parse(JSON.stringify(M.toBackup(s))));
  assert.deepEqual(back, s);
  assert.throws(() => M.fromBackup({ format: "other" }));
});

test("アプリの版と、端末に覚えさせるファイルの版がそろっている", () => {
  const app = readFileSync(new URL("../src/js/app.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  const v = app.match(/APP_VERSION = "([^"]+)"/)[1];
  assert.ok(sw.includes(`"mealprep-${v}"`), "service-worker.js の CACHE を APP_VERSION に合わせる");
});

test("覚えさせるファイルの一覧に、実在しないファイルが無い", () => {
  const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  const list = sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].match(/"\.\/[^"]*"/g).map((s) => s.slice(3, -1)).filter(Boolean);
  for (const f of list) assert.doesNotThrow(() => readFileSync(new URL("../" + f, import.meta.url)), f);
});

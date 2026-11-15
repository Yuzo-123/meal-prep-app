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

test("写真は取り込んだ週のぶんだけ持ち、前の週からは外す", () => {
  const a = bundle();
  a.photos = { r1: "data:image/jpeg;base64,AAAA" };
  let s = M.importBundle(M.emptyState(), a);
  assert.equal(M.photoOf(M.currentWeek(s), "r1"), "data:image/jpeg;base64,AAAA");
  assert.equal(M.photoOf(M.currentWeek(s), "x:トマト"), null);
  const b = bundle();
  b.week_start = "2026-11-23";
  b.photos = { r1: "data:image/jpeg;base64,BBBB" };
  s = M.importBundle(s, b);
  assert.equal(M.home(s).weeks["2026-11-16"].photos, undefined);
  assert.equal(M.photoOf(M.currentWeek(s), "r1"), "data:image/jpeg;base64,BBBB");
  assert.ok(M.home(s).weeks["2026-11-16"].days); // 献立そのものは残る
});

test("写真の欄に画像でないものが入っていても出さない", () => {
  const a = bundle();
  a.photos = { r1: "javascript:alert(1)" };
  assert.equal(M.photoOf(a, "r1"), null);
  assert.equal(M.photoOf(bundle(), "r1"), null); // 写真なしの週も読める
});

test("日曜の段取りは、入っていれば手順・材料・下準備に分かれ、無い週は空で返る", () => {
  assert.equal(M.sundayPlan(bundle()).has, false);
  assert.deepEqual(M.sundayPlan(bundle()).steps, []);
  const a = bundle();
  a.sunday = {
    assume: "コンロ 2 口", before: ["卵を出しておく"], cut: [{ what: "にんじん", how: "せん切り", for: "ナムル" }],
    steps: [{ at: "0:00", where: "コンロ①", title: "煮豚", print_page: 40, do: "最初に煮る" }, { at: "0:15", where: "まな板", title: "切る", do: "まとめて" }],
    materials: { items: [{ name: "にんじん", amount: "2本", for: ["ナムル"] }], pantry: ["塩"] },
  };
  const s = M.sundayPlan(a);
  assert.equal(s.has, true);
  assert.equal(s.steps.length, 2);
  assert.equal(s.steps[0].page, 40);
  assert.equal(s.steps[1].page, null);
  assert.equal(new Set(s.steps.map((x) => x.key)).size, 2); // 鍵が重ならない
  assert.equal(s.materials[0].key, "mat:にんじん");
  assert.equal(s.cut[0].for, "ナムル");
  let st = M.importBundle(M.emptyState(), a);
  st = M.toggleCheck(st, "2026-11-16", s.steps[0].key, true);
  st = M.clearChecks(st, "2026-11-16", ["step"]);
  assert.equal(M.isDone(st, "2026-11-16", s.steps[0].key), false);
});

test("作りおきは、日曜から数えて長いほうの日数の曜日まで", () => {
  assert.deepEqual(M.keepUntil("2026-11-16", "3〜4日"), { day: "木", days: 4 });
  assert.deepEqual(M.keepUntil("2026-11-16", "4〜5日"), { day: "金", days: 5 });
  assert.deepEqual(M.keepUntil("2026-11-16", "1週間"), { day: "日", days: 7 });
  assert.deepEqual(M.keepUntil("2026-11-16", "2週間"), { day: "日", days: 14 });
  assert.deepEqual(M.keepUntil("2026-11-16", "3〜4日", 3), { day: "水", days: 3 }); // 索引の日数があればそれを使う
  assert.equal(M.keepUntil("2026-11-16", "NG"), null);
  assert.equal(M.keepUntil("2026-11-16", null), null);
  assert.equal(M.keepUntil("2026-11-16", ""), null);
});

test("いまやることは、まだ済んでいない最初の手順。全部済めば無い", () => {
  const a = bundle();
  a.sunday = { steps: [
    { id: "r1", at: "0:00", where: "コンロ①", do: "煮る" },
    { at: "0:15", where: "まな板", title: "切る", do: "まとめて" },
    { id: "r1", at: "0:40", where: "コンロ①", title: "火を止める", do: "冷ます" },
  ] };
  const s = M.sundayPlan(a);
  assert.deepEqual(M.places(s.steps), ["コンロ①", "まな板"]);
  assert.deepEqual(s.steps.map((x) => x.dish), ["r1", null, "r1"]);
  let st = M.importBundle(M.emptyState(), a);
  assert.equal(M.currentStep(st, "2026-11-16", s.steps).at, "0:00");
  st = M.toggleCheck(st, "2026-11-16", s.steps[0].key, true);
  assert.equal(M.currentStep(st, "2026-11-16", s.steps).at, "0:15");
  for (const x of s.steps) st = M.toggleCheck(st, "2026-11-16", x.key, true);
  assert.equal(M.currentStep(st, "2026-11-16", s.steps), null);
});

test("手順に品の番号が無い古いファイルでも、料理名から料理を引ける", () => {
  const a = bundle();
  a.sunday = { steps: [{ at: "0:00", where: "コンロ①", title: "みそ汁", do: "煮る" }] };
  assert.equal(M.sundayPlan(a).steps[0].dish, "r1");
});

test("食べた・店に無かったの印は、チェックと別の鍵で残る", () => {
  let s = M.importBundle(M.emptyState(), bundle());
  const wk = "2026-11-16";
  s = M.toggleCheck(s, wk, M.eatKey("月", "朝", "r1"), true);
  s = M.toggleCheck(s, wk, M.noneKey("にんじん"), true);
  assert.equal(M.isDone(s, wk, M.eatKey("月", "朝", "r1")), true);
  assert.equal(M.isDone(s, wk, M.eatKey("火", "朝", "r1")), false);
  assert.deepEqual(M.missingItems(s, wk, M.currentWeek(s)), ["にんじん"]);
  assert.equal(M.isDone(s, wk, "buy:にんじん"), false); // 無かった印は「買った」にはしない
  s = M.clearChecks(s, wk, ["buy", "pantry", "none"]);
  assert.deepEqual(M.missingItems(s, wk, M.currentWeek(s)), []);
  assert.equal(M.isDone(s, wk, M.eatKey("月", "朝", "r1")), true); // 買い物を外しても、食べた印は残る
});

const cat = () => ({ format: "mealprep-catalog", version: 1, book: "本", dishes: [
  { id: "r1", name: "煮豚", kind: "作りおき", group: "肉", print_page: 40, kid_caution: false },
  { id: "r2", name: "麻婆なす", kind: "帰って10分", group: "野菜", print_page: 90, kid_caution: true },
  { id: "r3", name: "鮭の南蛮漬け", kind: "作りおき", group: "魚介", print_page: 60, kid_caution: false },
] });

test("品の一覧は種類・区分・取り分けで絞れる", () => {
  const d = cat().dishes;
  assert.deepEqual(M.filterDishes(d, { kind: "作りおき" }).map((x) => x.id), ["r1", "r3"]);
  assert.deepEqual(M.filterDishes(d, { group: "野菜" }).map((x) => x.id), ["r2"]);
  assert.deepEqual(M.filterDishes(d, { kidOk: true }).map((x) => x.id), ["r1", "r3"]);
  assert.equal(M.filterDishes(d, {}).length, 3);
});

test("品の一覧は家庭の区切りの下に入り、違うファイルは断る", () => {
  const s = M.importCatalog(M.emptyState(), cat());
  assert.equal(M.catalog(s).dishes.length, 3);
  assert.equal(M.catalog(M.emptyState()), null);
  assert.throws(() => M.importCatalog(M.emptyState(), bundle()));
  assert.throws(() => M.importCatalog(M.emptyState(), { format: "mealprep-catalog", dishes: [] }));
});

test("次に作る週は、次の月曜から", () => {
  assert.equal(M.nextMonday(new Date(2026, 10, 15)), "2026-11-16"); // 日曜
  assert.equal(M.nextMonday(new Date(2026, 10, 16)), "2026-11-23"); // 月曜なら次の月曜
  assert.equal(M.nextMonday(new Date(2026, 10, 21)), "2026-11-23"); // 土曜
  assert.equal(M.nextMonday(new Date(2026, 10, 28)), "2026-11-30");
});

test("次の月曜の週がもう入っていれば、その次の週を注文する", () => {
  let s = M.importBundle(M.emptyState(), bundle()); // 2026-11-16 の週が入っている
  assert.equal(M.nextPlanWeek(s, new Date(2026, 10, 15)), "2026-11-23");
  assert.equal(M.nextPlanWeek(M.emptyState(), new Date(2026, 10, 15)), "2026-11-16");
});

test("lio への注文は、選んだ品・おまかせ・取り分け・ひとことを文にする", () => {
  const s = M.importCatalog(M.emptyState(), cat());
  const r = M.buildRequest(s, ["r1", "r3", "無い番号"], { kidOk: true, note: " 金曜は外食 " }, new Date(2026, 10, 21));
  assert.deepEqual(r.data.picks, ["r1", "r3"]);
  assert.equal(r.data.week_start, "2026-11-23");
  assert.equal(r.data.fill_rest, true);
  assert.ok(r.text.includes("11/23〜11/27 の週"));
  assert.ok(r.text.includes("・煮豚（r1・P.40・作りおき）"));
  assert.ok(r.text.includes("取り分け注意の品: 除く"));
  assert.ok(r.text.includes("ひとこと: 金曜は外食"));
  const none = M.buildRequest(s, [], {}, new Date(2026, 10, 21));
  assert.ok(none.text.includes("指定なし（全部おまかせ）"));
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

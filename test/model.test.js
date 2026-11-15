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

test("表示する週は、今日を含む週。土日は次の月曜の週。無ければいちばん新しい週", () => {
  const ws = ["2026-11-09", "2026-11-16", "2026-11-23"];
  assert.equal(M.pickCurrentWeek(ws, new Date(2026, 10, 18)), "2026-11-16"); // 水曜
  assert.equal(M.pickCurrentWeek(ws, new Date(2026, 10, 15)), "2026-11-16"); // 日曜 → 明日からの週
  assert.equal(M.pickCurrentWeek(ws, new Date(2026, 10, 14)), "2026-11-16"); // 土曜 → 次の週
  assert.equal(M.pickCurrentWeek(ws, new Date(2026, 11, 20)), "2026-11-23"); // 当てはまる週が無い
  assert.equal(M.pickCurrentWeek([], new Date()), null);
});

test("サーバーから来た週は、新しくなったものだけ取り込み、チェックは残る", () => {
  let s = M.importBundle(M.emptyState(), bundle());
  s = M.toggleCheck(s, "2026-11-16", "buy:にんじん", true);
  const row = { week_start: "2026-11-16", updated_at: "t1", bundle: { ...bundle(), memo: "サーバー版", photo_ids: ["r1"] } };
  let r = M.mergeServerWeeks(s, [row], new Date(2026, 10, 18));
  assert.deepEqual(r.changed, ["2026-11-16"]);
  assert.equal(M.currentWeek(r.state).memo, "サーバー版");
  assert.equal(M.isDone(r.state, "2026-11-16", "buy:にんじん"), true);
  assert.deepEqual(M.photoIds(M.currentWeek(r.state)), ["r1"]);
  r = M.mergeServerWeeks(r.state, [row], new Date(2026, 10, 18)); // 同じものが来ても何もしない
  assert.deepEqual(r.changed, []);
  r = M.mergeServerWeeks(r.state, [{ ...row, updated_at: "t2" }], new Date(2026, 10, 18));
  assert.deepEqual(r.changed, ["2026-11-16"]);
});

test("サーバーから来た品の一覧も、新しくなったときだけ入れ替える", () => {
  let r = M.mergeServerCatalog(M.emptyState(), { updated_at: "c1", data: cat() });
  assert.equal(r.changed, true);
  assert.equal(M.catalog(r.state).dishes.length, 3);
  assert.equal(M.mergeServerCatalog(r.state, { updated_at: "c1", data: cat() }).changed, false);
  assert.equal(M.mergeServerCatalog(r.state, null).changed, false);
});

test("品ごとの詳しい手順は、入っていれば品の番号で引け、無い週は空", () => {
  assert.deepEqual(M.sundayPlan(bundle()).guide, {});
  const a = bundle();
  a.sunday = { steps: [{ id: "r1", at: "0:00", where: "コンロ①", do: "煮る" }],
    guide: { r1: { amounts: "分量は本の P.10", steps: [{ t: "下味", do: "塩をふる", why: "味がしみる" }, { t: "煮る", do: "40 分", wait_min: 40 }], after: "鍋のまま冷ます" } } };
  const g = M.sundayPlan(a).guide.r1;
  assert.equal(g.steps.length, 2);
  assert.equal(g.steps[1].wait_min, 40);
  assert.equal(g.after, "鍋のまま冷ます");
});

test("全体の流れは、場所ごとの帯になり、終わりは同じ場所の次の手順まで", () => {
  assert.equal(M.toMin("1:05"), 65);
  assert.equal(M.toMin("あとで"), null);
  const a = bundle();
  a.sunday = { steps: [
    { id: "r1", at: "0:00", where: "コンロ①", do: "煮る" },
    { at: "0:15", where: "まな板", title: "切る", do: "まとめて" },
    { at: "1:00", where: "コンロ①", title: "火を止める", do: "よける" },
    { at: "1:00", where: "コンロ①", title: "豚汁", do: "炒める" },
  ] };
  const t = M.timeline(M.sundayPlan(a).steps);
  assert.deepEqual(t.lanes.map((l) => l.place), ["コンロ①", "まな板"]);
  const stove = t.lanes[0].blocks;
  assert.deepEqual(stove.map((b) => [b.start, b.end]), [[0, 60], [60, 65], [65, 80]]); // 同じ時刻の 2 つは重ねずにずらす
  assert.equal(stove[0].dish, "r1");
  assert.deepEqual(t.lanes[1].blocks.map((b) => [b.start, b.end]), [[15, 30]]);
  assert.equal(t.total, 90); // 15 分きざみに切り上げ
  assert.deepEqual(M.timeline([]), { lanes: [], total: 0 });
});

test("買い物は売り場の歩く順（野菜が先）に並び、無かった品は残りに数えない", () => {
  let s = M.importBundle(M.emptyState(), bundle()); // にんじん（野菜）と鶏もも肉（肉）。ファイルの中では肉が後
  const rows = M.shoppingRows(M.currentWeek(s));
  assert.deepEqual(rows.filter((r) => !r.pantry).map((r) => r.name), ["にんじん", "鶏もも肉"]);
  const wk = "2026-11-16";
  assert.deepEqual(M.shopProgress(s, wk, M.currentWeek(s)), { total: 2, left: 2, missing: 0, ratio: 0 });
  s = M.toggleCheck(s, wk, M.noneKey("にんじん"), true);
  assert.deepEqual(M.shopProgress(s, wk, M.currentWeek(s)), { total: 2, left: 1, missing: 1, ratio: 0.5 });
  s = M.toggleCheck(s, wk, "buy:鶏もも肉", true);
  assert.equal(M.shopProgress(s, wk, M.currentWeek(s)).left, 0);
  s = M.toggleCheck(s, wk, "buy:にんじん", true); // 別の店で買えたら、無かった扱いではなくなる
  assert.equal(M.shopProgress(s, wk, M.currentWeek(s)).missing, 0);
});

test("手順が済むと、作る品のチェックが自動で付く", () => {
  const a = bundle();
  a.cook_sunday.push({ id: "r9", name: "ナムル", batches: 1 });
  a.sunday = { steps: [
    { id: "r1", at: "0:00", where: "コンロ①", do: "煮る" },
    { id: "r9", at: "0:10", where: "レンジ", do: "あえる" },
    { at: "0:30", where: "仕上げ", title: "容器へ", do: "詰める" },
  ] };
  const wk = "2026-11-16";
  let s = M.importBundle(M.emptyState(), a);
  const steps = M.sundayPlan(a).steps;
  s = M.autoCook(M.toggleCheck(s, wk, steps[0].key, true), wk, a);
  assert.equal(M.isDone(s, wk, "cook:r1"), true);  // その料理の手順が済んだ
  assert.equal(M.isDone(s, wk, "cook:r9"), false);
  s = M.toggleCheck(s, wk, steps[1].key, true);
  s = M.autoCook(M.toggleCheck(s, wk, steps[2].key, true), wk, a);
  assert.equal(M.isDone(s, wk, "cook:r9"), true);
  const plain = M.importBundle(M.emptyState(), bundle());
  assert.equal(M.autoCook(plain, wk, bundle()), plain); // 段取りが無い週は何も変えない
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

test("買い物を料理で絞る一覧は、出てくる順に料理名と品目の数を返す", () => {
  const s = M.importBundle(M.emptyState(), bundle());
  const w = M.currentWeek(s);
  const names = M.shopDishes(w).map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
  for (const r of M.shoppingRows(w).filter((x) => !x.pantry)) for (const d of r.dishes) assert.ok(names.includes(d));
  assert.equal(M.shopDishes(w).reduce((n, d) => n + d.count, 0), M.shoppingRows(w).reduce((n, r) => n + (r.dishes || []).length, 0));
});

test("注文には、1 日の型（夜 3 品・朝は汁物を回す）が必ず入る", () => {
  const r = M.buildRequest(M.emptyState(), [], {}, new Date(2026, 10, 21));
  assert.ok(r.text.includes("1 日の型: 夜は 汁物・主菜（肉か魚）・副菜 の 3 品"));
  assert.deepEqual(r.data.day_shape.dinner, ["汁物", "主菜（肉か魚）", "副菜"]);
});

test("今回ほしい分: 期間・品数・枠が注文に入り、枠を超えては選べない", () => {
  const dishes = [
    { id: "s1", name: "みそ汁", kind: "作りおき", group: "スープ", print_page: 1 },
    { id: "s2", name: "豚汁", kind: "作りおき", group: "スープ", print_page: 2 },
    { id: "m1", name: "煮豚", kind: "作りおき", group: "肉", print_page: 3 },
    { id: "v1", name: "ナムル", kind: "作りおき", group: "野菜", print_page: 4 },
  ];
  assert.deepEqual(M.slotCounts(dishes), { soup: 2, dish: 2 });
  const slots = { soup: 1, dish: 2 };
  assert.equal(M.canPick(dishes, new Set(), "s1", slots), true);
  assert.equal(M.canPick(dishes, new Set(["s1"]), "s2", slots), false); // 汁物の枠は 1
  assert.equal(M.canPick(dishes, new Set(["s1", "m1"]), "v1", slots), true);
  assert.equal(M.canPick(dishes, new Set(["m1", "v1"]), "s1", slots), true);
  assert.equal(M.mondayOf("2026-11-25"), "2026-11-23");
  assert.equal(M.daysBetween("2026-11-23", "2026-11-27"), 5);
  const r = M.buildRequest(M.emptyState(), [], { need: { from: "2026-11-25", to: "2026-11-27", bSoup: 0, bDish: 0, dSoup: 1, dDish: 1 } }, new Date(2026, 10, 21));
  assert.equal(r.data.week_start, "2026-11-23");
  assert.deepEqual(r.data.period, { from: "2026-11-25", to: "2026-11-27", days: 3 });
  assert.equal(r.data.meals.breakfast, 0);
  assert.equal(r.data.meals.dinner, 2);
  assert.deepEqual(r.data.meals.dinner_parts, { soup: 1, dish: 1 });
  assert.deepEqual(r.data.slots, { soup: 1, dish: 1 });
  assert.ok(r.text.includes("期間: 11/25〜11/27（3 日）"));
  assert.ok(r.text.includes("1 回に出す品数: 夜 2 品（汁物 1・おかず 1）・朝 0 品（なし）"));
  assert.ok(!r.text.includes("1 日の型")); // 基本の型（朝 1・夜 3）から変えたら、型の一文は添えない
});

test("今回ほしい分: 1 回に出す品数から、この期間に作る品の数が自動で出る", () => {
  // 基本: 月〜金の 5 日・夜は 汁物 1＋おかず 2・朝は夜の汁物を回す → 汁物 2 品・おかず 4 品
  assert.deepEqual(M.needSlots({ from: "2026-11-23", to: "2026-11-27" }), { days: 5, cookDays: 5, soup: 2, dish: 4, breakfast: 1, dinner: 3 });
  // 3 日なら、同じ品を 3 日続けて出せるので 汁物 1・おかず 2
  assert.deepEqual(M.needSlots({ from: "2026-11-25", to: "2026-11-27" }), { days: 3, cookDays: 3, soup: 1, dish: 2, breakfast: 1, dinner: 3 });
  // 7 日を選んでも、献立に入るのは月〜金の 5 日。朝にもおかず 1 品 → 汁物 2・おかず 6
  assert.deepEqual(M.needSlots({ from: "2026-11-23", to: "2026-11-29", bDish: 1 }), { days: 7, cookDays: 5, soup: 2, dish: 6, breakfast: 2, dinner: 3 });
  // 汁物なし
  assert.equal(M.needSlots({ from: "2026-11-23", to: "2026-11-27", bSoup: 0, dSoup: 0 }).soup, 0);
  const r = M.buildRequest(M.emptyState(), [], { need: { from: "2026-11-23", to: "2026-11-27" } }, new Date(2026, 10, 21));
  assert.deepEqual(r.data.slots, { soup: 2, dish: 4 });
  assert.ok(r.text.includes("1 回に出す品数: 夜 3 品（汁物 1・おかず 2）・朝 1 品（汁物 1）"));
  assert.ok(r.text.includes("1 日の型:"));
});

// ---------- アプリの中で献立と買い物を組む（planner.js） ----------
import * as P from "../src/js/planner.js";

function planState() {
  const ing = (rows) => rows.map(([n, a, x, y, u, p, s]) => [n, a, x, y, u, p || 0, s ?? 2]);
  const d = (id, name, group, extra = {}) => ({ id, name, kind: "作りおき", group, section: name, print_page: 1, fridge: "3〜4日", fridge_days: 4,
    freezer: "2週間", freezer_ok: true, time_min: null, kid_caution: false, servings_n: 4, unsure: false,
    ing: ing([["にんじん", "1/2本", 1, 2, "本"], ["塩", "少々", null, null, null, 1], [name + "の具", "200g", 200, 1, "g", 0, 0]]), ...extra });
  const dishes = [
    d("s1", "みそ汁", "スープ"), d("s2", "豚汁", "スープ"), d("s3", "トマトスープ", "スープ"),
    d("m1", "煮豚", "肉"), d("m2", "鶏の照り焼き", "肉"), d("f1", "鮭の南蛮", "魚介"), d("f2", "たらのトマト煮", "魚介"),
    d("v1", "にんじんナムル", "野菜"), d("v2", "白菜の塩煮", "野菜"), d("v3", "きのこマリネ", "野菜"), d("e1", "味つけ卵", "卵・豆製品"),
    d("k1", "辛いチキン", "肉", { kid_caution: true }), d("u1", "読めなかった品", "肉", { unsure: true }),
  ];
  return M.importCatalog(M.emptyState(), { format: "mealprep-catalog", version: 1, book: "本", dishes });
}
const NEED = { from: "2026-11-23", to: "2026-11-27" };
const rng0 = () => 0;

test("アプリの中で組む: 基本の型なら、汁物 2・おかず 4 で月〜金が埋まる", () => {
  const s = planState();
  assert.equal(P.canAutoPlan(s), true);
  const b = P.autoPlan(s, [], { need: NEED }, rng0, new Date(2026, 10, 21, 9, 0, 0));
  assert.deepEqual(M.validateBundle(b), []);
  assert.equal(b.week_start, "2026-11-23");
  assert.equal(b.draft, true);
  for (const day of M.DAYS) {
    assert.equal(b.days[day]["朝"].length, 1, day + " の朝は汁物 1 品");
    assert.equal(b.days[day]["夜"].length, 3, day + " の夜は 3 品");
    assert.equal(b.days[day]["朝"][0].id, b.days[day]["夜"][0].id, "朝は夜と同じ汁物");
  }
  // 月〜水と木・金で、品が入れ替わる
  assert.notEqual(b.days["月"]["夜"][0].id, b.days["木"]["夜"][0].id);
  assert.equal(b.days["月"]["夜"][1].id, b.days["水"]["夜"][1].id);
  assert.equal(b.cook_sunday.length, 6);
  // 子どもの取り分けに注意が要る品・読み取りに印がある品は、おまかせでは選ばない
  const ids = b.cook_sunday.map((c) => c.id);
  assert.ok(!ids.includes("k1") && !ids.includes("u1"));
  // 主菜は、かたまりごとに魚と肉が入れ替わる
  const cat = M.catalog(s).dishes;
  const groupOf = (id) => cat.find((x) => x.id === id).group;
  assert.equal(groupOf(b.days["月"]["夜"][1].id), "魚介");
  assert.equal(groupOf(b.days["木"]["夜"][1].id), "肉");
});

test("アプリの中で組む: 作る回数と買い物の量を、食べる回数から出す", () => {
  const b = P.autoPlan(planState(), [], { need: NEED }, rng0);
  const soupA = b.cook_sunday.find((c) => c.id === b.days["月"]["夜"][0].id);
  // 月〜水の朝と夜で 6 食 × 2.5 人 = 15 人分。4 人分の品なら 4 回分（1 人分までの不足は見逃す）
  assert.equal(soupA.batches, 4);
  const mainA = b.cook_sunday.find((c) => c.id === b.days["月"]["夜"][1].id);
  assert.equal(mainA.batches, 2); // 3 食 × 2.5 = 7.5 人分 → 2 回分
  const carrot = b.shopping.buy.find((x) => x.name === "にんじん");
  const total = b.cook_sunday.reduce((n, c) => n + c.batches, 0);
  assert.equal(carrot.amount, P.fmtFrac(total, 2) + "本"); // どの品も 1/2 本ずつ
  assert.equal(carrot.for.length, 6);
  assert.deepEqual(b.shopping.pantry, ["塩"]);
  assert.equal(b.sunday.materials.items.length, b.shopping.buy.length);
  assert.equal(P.fmtFrac(5, 2), "2と1/2");
  assert.equal(P.fmtFrac(4, 2), "2");
  assert.equal(P.fmtFrac(1, 3), "1/3");
});

test("アプリの中で組む: 選んだ品は必ず入り、前の週の品は後回しになる", () => {
  let s = planState();
  const first = P.autoPlan(s, ["m1", "s2"], { need: NEED }, rng0);
  const ids = first.cook_sunday.map((c) => c.id);
  assert.ok(ids.includes("m1") && ids.includes("s2"));
  assert.equal(first.days["月"]["夜"][0].id, "s2"); // 選んだ汁物は、最初のかたまりに入る
  // 次の週は、前の週に出した野菜のおかずを避ける
  s = M.importBundle(s, first);
  const next = P.autoPlan(s, [], { need: { from: "2026-11-30", to: "2026-12-04" } }, rng0);
  assert.equal(next.week_start, "2026-11-30");
  const veg = (b) => b.cook_sunday.map((c) => c.id).filter((id) => id.startsWith("v"));
  assert.ok(veg(next).some((id) => !veg(first).includes(id)), "前の週と違う野菜のおかずが入る");
  // 「足さない」なら、選んだ品だけ
  const only = P.autoPlan(planState(), ["m1"], { need: NEED, fillRest: false }, rng0);
  assert.deepEqual(only.cook_sunday.map((c) => c.id), ["m1"]);
});

test("アプリの中で組む: 日持ちを超える日は、冷凍の注意が付く", () => {
  const b = P.autoPlan(planState(), [], { need: NEED }, rng0);
  // 冷蔵 3〜4 日の品を木・金に出すと、金曜（日曜から 5 日後）が超える
  assert.ok(b.notes.some((n) => n.includes("金曜の分が冷蔵 3〜4日 を超えます")));
  assert.ok(b.notes[0].includes("アプリがその場で組んだ献立です"));
  // 期間が 3 日なら、かたまりは 1 つで、汁物 1・おかず 2
  const short = P.autoPlan(planState(), [], { need: { from: "2026-11-25", to: "2026-11-27" } }, rng0);
  assert.equal(short.cook_sunday.length, 3);
  assert.deepEqual(short.days["月"]["夜"], []);
  assert.equal(short.days["水"]["夜"].length, 3);
});

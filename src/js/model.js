// データの形と、画面に依らない計算。ここは Node でもそのまま動く（test/ から呼ぶ）。
// 設計メモ: projects/meal-prep/03_notes/2026-11-14-app-design.md の 6 章

export const DAYS = ["月", "火", "水", "木", "金"];
export const MEALS = ["朝", "夜"];
export const AISLE_ORDER = ["肉", "魚介", "野菜・きのこ・果物", "卵・乳製品・大豆", "缶詰・乾物・その他"];
export const AISLE_SHORT = {
  "肉": "肉", "魚介": "魚介", "野菜・きのこ・果物": "野菜",
  "卵・乳製品・大豆": "卵・乳・豆", "缶詰・乾物・その他": "そのほか",
};
export const FORMAT = "mealprep-week";
export const SCHEMA = 1;

// 最初は 1 家庭だけ。後で増やせるよう、どのデータも家庭の区切りの下に置く。
export function emptyState() {
  return { schema: SCHEMA, household: "home", households: { home: emptyHousehold() } };
}

function emptyHousehold() {
  return { current: null, weeks: {}, checks: {}, logs: {} };
}

export function home(state) {
  return state.households[state.household];
}

export function currentWeek(state) {
  const h = home(state);
  return h.current ? h.weeks[h.current] || null : null;
}

// 取り込む週のデータ（lio が書き出したもの）の点検。問題を日本語の文で返す。
export function validateBundle(b) {
  const errors = [];
  if (!b || typeof b !== "object" || Array.isArray(b)) return ["週のデータではありません（中身が読めません）"];
  if (b.format !== FORMAT) errors.push("作り置きアプリ用の週のデータではありません");
  if (b.version !== 1) errors.push("データの版が合いません（このアプリが読めるのは版 1）");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.week_start || "")) errors.push("週の開始日がありません");
  if (!b.days || typeof b.days !== "object") errors.push("献立がありません");
  if (!b.shopping || !Array.isArray(b.shopping.buy)) errors.push("買い物リストがありません");
  if (!Array.isArray(b.cook_sunday)) errors.push("日曜に作る品の一覧がありません");
  return errors;
}

export function importBundle(state, bundle) {
  const errors = validateBundle(bundle);
  if (errors.length) throw new Error(errors.join("／"));
  const next = structuredClone(state);
  const id = bundle.household || next.household;
  if (!next.households[id]) next.households[id] = emptyHousehold();
  next.household = id;
  const h = next.households[id];
  h.weeks[bundle.week_start] = bundle;
  h.current = bundle.week_start;
  // 写真は大きいので、いま取り込んだ週のぶんだけ持つ（端末の保存先の上限を超えないため）。
  for (const [k, w] of Object.entries(h.weeks)) if (k !== bundle.week_start) delete w.photos;
  return next;
}

export function photoOf(bundle, id) {
  const p = bundle && bundle.photos ? bundle.photos[id] : null;
  return typeof p === "string" && p.startsWith("data:image/") ? p : null;
}

// 端末の中に書き出すときの大きさ（文字数）。保存先の上限に近いかを見るために使う。
export function stateSize(state) {
  return JSON.stringify(state).length;
}

// 月〜金の日付。時差でずれないよう、文字から年月日を取り出して作る。
export function dayDates(weekStart) {
  const [y, m, d] = weekStart.split("-").map(Number);
  return DAYS.map((day, i) => {
    const dt = new Date(y, m - 1, d + i);
    return { day, month: dt.getMonth() + 1, date: dt.getDate(), iso: iso(dt) };
  });
}

export function iso(dt) {
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function todayDay(weekStart, now = new Date()) {
  const hit = dayDates(weekStart).find((x) => x.iso === iso(now));
  return hit ? hit.day : null;
}

export function weekSpan(weekStart) {
  const ds = dayDates(weekStart);
  return `${ds[0].month}/${ds[0].date}〜${ds[4].month}/${ds[4].date}`;
}

// チェックの鍵は「並び順」ではなく中身から作る。献立を取り込み直しても、
// 後で 2 人で同期しても、同じ品のチェックが同じ鍵になる。
export function shoppingRows(bundle) {
  const buy = bundle.shopping.buy.map((it) => ({
    key: "buy:" + it.name, name: it.name, amount: it.amount || "", aisle: it.aisle,
    sub: (it.for || []).join("・"), some: it.some || "", pantry: false,
  }));
  const pantry = (bundle.shopping.pantry || []).map((name) => ({
    key: "pantry:" + name, name, amount: "", aisle: "pantry", sub: "家にあるか確かめる", some: "", pantry: true,
  }));
  return buy.concat(pantry);
}

export function cookRows(bundle) {
  return bundle.cook_sunday.map((c) => ({
    key: "cook:" + c.id, name: c.name, batches: c.batches || 1,
    keep: [c.fridge ? "冷蔵 " + c.fridge : "", c.freezer_ok && c.freezer ? "冷凍 " + c.freezer : ""].filter(Boolean).join("・"),
    page: c.print_page,
  }));
}

// 古い取り込みファイルには手順に品の番号が無いので、料理名から引く
function dishIdByName(bundle, name) {
  const hit = (bundle.cook_sunday || []).find((c) => c.name === name);
  return hit ? hit.id : null;
}

// 日曜の段取り（手順・材料・下準備）。週のデータに入っていなければ空で返す。
export function sundayPlan(bundle) {
  const s = (bundle && bundle.sunday) || {};
  const mat = s.materials || {};
  return {
    has: !!(s.steps && s.steps.length),
    assume: s.assume || "",
    steps: (s.steps || []).map((x) => ({
      key: `step:${x.at}|${x.title || x.name || ""}`, at: x.at || "", where: x.where || "",
      title: x.title || x.name || "", page: x.print_page ?? null, text: x.do || "",
      dish: x.id || dishIdByName(bundle, x.title || x.name), // どの料理の手順か（料理をまたぐ手順は null）
    })),
    materials: (mat.items || []).map((x) => ({ key: "mat:" + x.name, name: x.name, amount: x.amount || "", sub: (x.for || []).join("・") })),
    pantry: mat.pantry || [],
    before: (s.before || []).map((t) => ({ key: "before:" + t, text: t })),
    cut: (s.cut || []).map((c) => ({ key: "cut:" + c.what, name: c.what, how: c.how || "", for: c.for || "" })),
  };
}

// レシピで使う場所の一覧（出てきた順）。色分けと絞り込みに使う。
export function places(steps) {
  return [...new Set(steps.map((x) => x.where).filter(Boolean))];
}

// いまやること＝まだ済んでいない最初の手順。全部済んでいれば null。
export function currentStep(state, week, steps) {
  return steps.find((x) => !isDone(state, week, x.key)) || null;
}

// 日曜に作った作りおきを、何曜まで食べられるか。「3〜4日」なら長いほうの 4 日＝木曜まで。
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export function keepUntil(weekStart, fridgeText, fridgeDays) {
  const text = String(fridgeText || "");
  const nums = text.match(/\d+/g);
  if (!fridgeDays && !nums) return null;
  // 本の索引が日数を持っていればそれを使う。無ければ文字から読む（「1週間」は 7 日）
  const days = fridgeDays || Math.max(...nums.map(Number)) * (text.includes("週") ? 7 : 1);
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1 + days); // 週の開始（月曜）の前の日曜から数える
  return { day: WEEKDAYS[dt.getDay()], days };
}

// 印の鍵。「食べた」は曜日・朝夜・品ごと、「店に無かった」は品名ごと。
export function eatKey(day, meal, id) {
  return `eat:${day}|${meal}|${id}`;
}

export function noneKey(name) {
  return "none:" + name;
}

export function missingItems(state, week, bundle) {
  return bundle.shopping.buy.map((it) => it.name).filter((n) => isDone(state, week, noneKey(n)));
}

export function isDone(state, week, key) {
  const c = home(state).checks[week];
  return !!(c && c[key] && c[key].done);
}

export function toggleCheck(state, week, key, done, by = "me", at = new Date().toISOString()) {
  const next = structuredClone(state);
  const h = home(next);
  if (!h.checks[week]) h.checks[week] = {};
  if (done) h.checks[week][key] = { done: true, by, at };
  else delete h.checks[week][key];
  return next;
}

export function clearChecks(state, week, prefixes) {
  const next = structuredClone(state);
  const c = home(next).checks[week] || {};
  for (const k of Object.keys(c)) if (prefixes.some((p) => k.startsWith(p + ":"))) delete c[k];
  return next;
}

export function progress(state, week, rows) {
  const total = rows.length;
  const left = rows.filter((r) => !isDone(state, week, r.key)).length;
  return { total, left, ratio: total ? (total - left) / total : 0 };
}

// 週ごとの記録（日曜の調理時間・助かったこと・要らなかったこと）
export function getLog(state, week) {
  return home(state).logs[week] || { cook_minutes: "", good: "", bad: "" };
}

export function setLog(state, week, patch, at = new Date().toISOString()) {
  const next = structuredClone(state);
  const h = home(next);
  h.logs[week] = { ...getLog(next, week), ...patch, updated_at: at };
  return next;
}

// 書き出し（バックアップ）と読み戻し
export function toBackup(state, at = new Date().toISOString()) {
  return { format: "mealprep-backup", version: 1, exported_at: at, state };
}

export function fromBackup(obj) {
  if (!obj || obj.format !== "mealprep-backup" || !obj.state || !obj.state.households) {
    throw new Error("このアプリの書き出しファイルではありません");
  }
  return obj.state;
}

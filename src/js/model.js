// データの形と、画面に依らない計算。ここは Node でもそのまま動く（test/ から呼ぶ）。
// 設計メモ: projects/meal-prep/03_notes/2026-11-14-app-design.md の 6 章

export const DAYS = ["月", "火", "水", "木", "金"];
export const MEALS = ["朝", "夜"];
// 売り場の順。多くの店は入口が野菜売り場なので、歩く順に合わせて野菜を先にする。
export const AISLE_ORDER = ["野菜・きのこ・果物", "肉", "魚介", "卵・乳製品・大豆", "缶詰・乾物・その他"];
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

// ---------- サーバーから受け取った週を取り込む ----------

// 表示する週を選ぶ。今日を含む週（土日は次の月曜の週）があればそれ、無ければいちばん新しい週。
export function pickCurrentWeek(weekStarts, now = new Date()) {
  if (!weekStarts.length) return null;
  const sorted = [...weekStarts].sort();
  const dow = now.getDay(); // 0=日 … 6=土
  const shift = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  const target = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift));
  return sorted.includes(target) ? target : sorted[sorted.length - 1];
}

// rows は [{week_start, updated_at, bundle}]。前に受け取ったものと同じなら何もしない。
export function mergeServerWeeks(state, rows, now = new Date()) {
  let next = state;
  const changed = [];
  for (const row of [...rows].sort((a, b) => (a.week_start < b.week_start ? -1 : 1))) {
    const have = home(next).weeks[row.week_start];
    if (have && have.server_updated_at === row.updated_at) continue;
    next = importBundle(next, { ...row.bundle, household: next.household, server_updated_at: row.updated_at });
    changed.push(row.week_start);
  }
  if (changed.length) {
    next = structuredClone(next);
    home(next).current = pickCurrentWeek(Object.keys(home(next).weeks), now);
  }
  return { state: next, changed };
}

export function mergeServerCatalog(state, row) {
  const have = catalog(state);
  if (!row || (have && have.server_updated_at === row.updated_at)) return { state, changed: false };
  const next = importCatalog(state, row.data);
  home(next).catalog.server_updated_at = row.updated_at;
  return { state: next, changed: true };
}

// その週で写真がありうる品の番号（サーバーから来た週は photo_ids、ファイルから入れた週は中の写真）
export function photoIds(bundle) {
  return bundle.photo_ids && bundle.photo_ids.length ? bundle.photo_ids : Object.keys(bundle.photos || {});
}

export function photoOf(bundle, id) {
  const p = bundle && bundle.photos ? bundle.photos[id] : null;
  return typeof p === "string" && p.startsWith("data:image/") ? p : null;
}

// 端末の中に書き出すときの大きさ（文字数）。保存先の上限に近いかを見るために使う。
export function stateSize(state) {
  return JSON.stringify(state).length;
}

// ---------- カテゴリから選ぶ（品の一覧と、lio への注文） ----------

export const CATALOG_FORMAT = "mealprep-catalog";
export const KINDS = ["作りおき", "帰って10分"];
export const GROUPS = ["肉", "魚介", "野菜", "卵・豆製品", "ごはん・めん", "スープ"];

export function importCatalog(state, cat) {
  if (!cat || cat.format !== CATALOG_FORMAT || !Array.isArray(cat.dishes) || !cat.dishes.length) {
    throw new Error("品の一覧のファイルではありません");
  }
  const next = structuredClone(state);
  home(next).catalog = { book: cat.book || "", exported_at: cat.exported_at || "", dishes: cat.dishes };
  return next;
}

export function catalog(state) {
  return home(state).catalog || null;
}

// 種類・区分・取り分けで絞る。opts の値が無い項目は絞らない。
export function filterDishes(dishes, opts = {}) {
  return dishes.filter((d) =>
    (!opts.kind || d.kind === opts.kind) &&
    (!opts.group || d.group === opts.group) &&
    (!opts.kidOk || !d.kid_caution));
}

// 次に献立を作る週の月曜。今日が月曜でも「次の」月曜にする（今週ぶんはもう作ってある前提）。
export function nextMonday(now = new Date()) {
  const add = ((8 - now.getDay()) % 7) || 7;
  return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + add));
}

// 注文する週。次の月曜の週がもう取り込んであれば、その次の週にする。
export function nextPlanWeek(state, now = new Date()) {
  let week = nextMonday(now);
  const weeks = home(state).weeks || {};
  for (let i = 0; i < 8 && weeks[week]; i++) {
    const [y, m, d] = week.split("-").map(Number);
    week = iso(new Date(y, m - 1, d + 7));
  }
  return week;
}

// lio に渡す注文。チャットに貼れる文と、機械が読める中身の両方を作る。
// 1 日の献立の型（2026-11-15 に家で決めた。5 品は多いので 3 品に）。注文に必ず添える。
export const DAY_SHAPE = {
  dinner: ["汁物", "主菜（肉か魚）", "副菜"], breakfast: "夜と同じ汁物を回す（朝のための品は足さない）",
  text: "夜は 汁物・主菜（肉か魚）・副菜 の 3 品。朝は夜と同じ汁物を回す",
};

// 「今回ほしい分」の初めの値。1 回に出す品数を、朝・夜それぞれ 汁物・おかず で決める。
// 夜は 汁物 1・おかず 2（主菜と副菜）、朝は 汁物 1（夜と同じ汁物を回す）。
export const NEED_DEFAULT = { from: "", to: "", bSoup: 1, bDish: 0, dSoup: 1, dDish: 2 };
export const NEED_MAX = { bSoup: 2, bDish: 3, dSoup: 2, dDish: 4 };
export const KEEP_DAYS = 3; // 同じ品を続けて出す日数の上限。作る品の数を出すのに使う

// この期間に作る品の数。汁物は朝も夜と同じものを回すので、朝と夜の多いほうで数える。
export function needSlots(need) {
  const n = { ...NEED_DEFAULT, ...need };
  const days = n.from && n.to && n.to >= n.from ? daysBetween(n.from, n.to) : 5;
  const kinds = (perDay) => Math.ceil((days * perDay) / KEEP_DAYS);
  return { days, soup: kinds(Math.max(n.bSoup, n.dSoup)), dish: kinds(n.bDish + n.dDish), breakfast: n.bSoup + n.bDish, dinner: n.dSoup + n.dDish };
}

// 品がどちらの枠に入るか。本の区分が「スープ」なら汁物、ほかは全部おかず。
export function slotOf(d) {
  return d && d.group === "スープ" ? "soup" : "dish";
}

export function slotCounts(dishes) {
  const n = { soup: 0, dish: 0 };
  for (const d of dishes) n[slotOf(d)]++;
  return n;
}

// 枠が残っていれば true。枠は「今回ほしい分」から出した 汁物・おかず の数。
export function canPick(dishes, pickedIds, id, slots) {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const d = byId.get(id);
  if (!d) return false;
  const used = slotCounts([...pickedIds].map((x) => byId.get(x)).filter(Boolean));
  const slot = slotOf(d);
  return used[slot] < slots[slot];
}

function parts(isoDate) { return isoDate.split("-").map(Number); }
export function addDays(isoDate, n) { const [y, m, d] = parts(isoDate); return iso(new Date(y, m - 1, d + n)); }
export function daysBetween(from, to) {
  const [y1, m1, d1] = parts(from), [y2, m2, d2] = parts(to);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1;
}
export function mondayOf(isoDate) {
  const [y, m, d] = parts(isoDate);
  const dow = new Date(y, m - 1, d).getDay();
  return addDays(isoDate, -((dow + 6) % 7));
}
function md(isoDate) { const [, m, d] = parts(isoDate); return `${m}/${d}`; }

export function buildRequest(state, picks, opts = {}, now = new Date()) {
  const cat = catalog(state);
  const byId = new Map((cat ? cat.dishes : []).map((d) => [d.id, d]));
  const chosen = picks.map((id) => byId.get(id)).filter(Boolean);
  const need = { ...NEED_DEFAULT, ...(opts.need || {}) };
  const week = opts.week_start || (need.from ? mondayOf(need.from) : nextPlanWeek(state, now));
  const from = need.from || week;
  const to = need.to && need.to >= from ? need.to : addDays(from, need.from ? 0 : 4);
  const used = slotCounts(chosen);
  const slots = needSlots({ ...need, from, to });
  const data = {
    format: "mealprep-request", version: 1, household: state.household, week_start: week,
    picks: chosen.map((d) => d.id), fill_rest: opts.fillRest !== false, kid_ok_only: !!opts.kidOk, note: (opts.note || "").trim(),
    period: { from, to, days: daysBetween(from, to) },
    meals: { breakfast: slots.breakfast, dinner: slots.dinner, breakfast_parts: { soup: need.bSoup, dish: need.bDish }, dinner_parts: { soup: need.dSoup, dish: need.dDish } },
    slots: { soup: slots.soup, dish: slots.dish },
    day_shape: DAY_SHAPE,
  };
  const basic = ["bSoup", "bDish", "dSoup", "dDish"].every((k) => need[k] === NEED_DEFAULT[k]);
  const part = (s, d) => [s ? `汁物 ${s}` : "", d ? `おかず ${d}` : ""].filter(Boolean).join("・") || "なし";
  const lines = [
    `【献立の注文】${weekSpan(week)} の週`,
    `期間: ${md(from)}〜${md(to)}（${data.period.days} 日）`,
    `1 回に出す品数: 夜 ${slots.dinner} 品（${part(need.dSoup, need.dDish)}）・朝 ${slots.breakfast} 品（${part(need.bSoup, need.bDish)}）`,
    `この期間に作る品の数: 汁物 ${slots.soup} 品・おかず ${slots.dish} 品（選んだのは 汁物 ${used.soup}・おかず ${used.dish}）`,
    chosen.length ? "作りたい品:" : "作りたい品: 指定なし（全部おまかせ）",
    ...chosen.map((d) => `・${d.name}（${d.id}・P.${d.print_page}・${d.kind}）`),
    `足りない分: ${data.fill_rest ? "おまかせ" : "足さない"}`,
    `取り分け注意の品: ${data.kid_ok_only ? "除く" : "入れてよい"}`,
  ];
  if (basic) lines.push(`1 日の型: ${DAY_SHAPE.text}`);
  if (data.note) lines.push(`ひとこと: ${data.note}`);
  return { data, text: lines.join("\n") };
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
    sub: (it.for || []).join("・"), dishes: it.for || [], some: it.some || "", pantry: false,
  }));
  const pantry = (bundle.shopping.pantry || []).map((name) => ({
    key: "pantry:" + name, name, amount: "", aisle: "pantry", sub: "家にあるか確かめる", some: "", pantry: true,
  }));
  const rank = (a) => { const i = AISLE_ORDER.indexOf(a); return i < 0 ? AISLE_ORDER.length : i; };
  buy.sort((a, b) => rank(a.aisle) - rank(b.aisle)); // 同じ売り場の中の順は変えない
  return buy.concat(pantry);
}

// 買い物を料理で絞るための一覧。買うものに出てくる順に、料理名と品目の数を返す。
export function shopDishes(bundle) {
  const out = new Map();
  for (const it of bundle.shopping.buy) for (const d of it.for || []) out.set(d, (out.get(d) || 0) + 1);
  return [...out].map(([name, count]) => ({ name, count }));
}

// 買い物の進み具合。「無かった」品は、残りには数えない（その店ではもう探さないので）。
export function shopProgress(state, week, bundle) {
  const rows = shoppingRows(bundle).filter((r) => !r.pantry);
  const missing = rows.filter((r) => !isDone(state, week, r.key) && isDone(state, week, noneKey(r.name))).length;
  const left = rows.filter((r) => !isDone(state, week, r.key) && !isDone(state, week, noneKey(r.name))).length;
  return { total: rows.length, left, missing, ratio: rows.length ? (rows.length - left) / rows.length : 0 };
}

// 手順のチェックから、「作る品」のチェックを自動で付ける。
// ある料理の手順が全部済んだらその料理を、手順が全部済んだら全部の料理を「作り終えた」にする。外すことはしない。
export function autoCook(state, week, bundle) {
  const steps = sundayPlan(bundle).steps;
  if (!steps.length) return state;
  const done = (x) => isDone(state, week, x.key);
  const all = steps.every(done);
  let next = state;
  for (const c of bundle.cook_sunday) {
    const mine = steps.filter((x) => x.dish === c.id);
    if ((all || (mine.length && mine.every(done))) && !isDone(next, week, "cook:" + c.id)) {
      next = toggleCheck(next, week, "cook:" + c.id, true, "auto");
    }
  }
  return next;
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
    guide: s.guide || {},
    cut: (s.cut || []).map((c) => ({ key: "cut:" + c.what, name: c.what, how: c.how || "", for: c.for || "" })),
  };
}

// 「1:05」→ 65 分。読めなければ null。
export function toMin(at) {
  const m = /^(\d+):(\d{2})$/.exec(at || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// 全体の流れ（場所ごとの帯）。手順は始まる時刻しか持たないので、終わりは「同じ場所の次の手順が始まるまで」とみなす。
// 同じ場所で次が無い手順は 15 分、同じ時刻に重なる手順は 5 分ずつずらして並べる。あくまで目安。
export function timeline(steps) {
  const items = steps.map((x) => ({ ...x, start: toMin(x.at) })).filter((x) => x.start !== null && x.where);
  if (!items.length) return { lanes: [], total: 0 };
  const lanes = places(items).map((place) => {
    const mine = items.filter((x) => x.where === place).sort((a, b) => a.start - b.start);
    let prevEnd = 0;
    const blocks = mine.map((x, i) => {
      const start = Math.max(x.start, prevEnd);
      const next = i + 1 < mine.length ? mine[i + 1].start : null;
      const end = Math.max(start + 5, next !== null && next > start ? next : start + (next === null ? 15 : 5));
      prevEnd = end;
      return { key: x.key, title: x.title, dish: x.dish, at: x.at, start, end };
    });
    return { place, blocks };
  });
  const total = Math.ceil(Math.max(...lanes.flatMap((l) => l.blocks.map((b) => b.end))) / 15) * 15;
  return { lanes, total };
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

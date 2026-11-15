// アプリの中で、献立と買い物をその場で組む（AI なし。決まりで選ぶ）。
// 「献立を頼む」を押した直後に出す下書き。冷蔵庫の中身の反映と日曜の段取りは、あとから Mac 側が足して届ける。
// 画面には触らない。乱数は外から渡せる（テストで同じ結果にするため）。
import { DAYS, FORMAT, KEEP_DAYS, NEED_DEFAULT, addDays, catalog, home, mondayOf, slotOf } from "./model.js";

export const PEOPLE = 2.5; // 大人 2 人＋子ども 1 人
// 買い物リストの並び（Mac 側の道具と同じ順）。品の一覧の材料は、この番号で売り場を持つ
const AISLES = ["肉", "魚介", "野菜・きのこ・果物", "卵・乳製品・大豆", "缶詰・乾物・その他"];

// 品の一覧に材料が入っていれば、アプリの中で組める
export function canAutoPlan(state) {
  const c = catalog(state);
  return !!(c && c.dishes.some((d) => Array.isArray(d.ing) && d.ing.length));
}

function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }
// 分数を「2と1/2」の形にする
export function fmtFrac(n, d) {
  const g = gcd(n, d) || 1;
  n /= g; d /= g;
  if (d === 1) return String(n);
  const whole = Math.floor(n / d), rest = n % d;
  return whole ? `${whole}と${rest}/${d}` : `${rest}/${d}`;
}

// 作る品（と何回分か）から、買うものと、残りを確かめる調味料を集める。
// uses は [{ dish, batches }]。材料の 1 行は [名前, 分量の文字, 分子, 分母, 単位, 調味料なら 1, 売り場の番号]
export function shoppingFor(uses, aisles = AISLES) {
  const items = new Map(), pantry = [];
  for (const { dish, batches } of uses) {
    for (const [name, amount, n, d, unit, isPantry, aisle] of dish.ing || []) {
      if (isPantry) { if (!pantry.includes(name)) pantry.push(name); continue; }
      if (!items.has(name)) items.set(name, { name, sum: new Map(), raw: [], for: [], aisle: aisles[aisle] || aisles[2] });
      const it = items.get(name);
      if (n != null && d) {
        const [pn, pd] = it.sum.get(unit) || [0, 1];
        it.sum.set(unit, [pn * d + n * batches * pd, pd * d]);
      } else {
        it.raw.push((amount || "分量不明") + (batches > 1 ? `×${batches}` : ""));
      }
      if (!it.for.includes(dish.name)) it.for.push(dish.name);
    }
  }
  const buy = [...items.values()].map((it) => {
    const parts = [...it.sum.entries()].map(([u, [n, d]]) => (u === "大さじ" || u === "小さじ" ? `${u}${fmtFrac(n, d)}` : `${fmtFrac(n, d)}${u}`));
    return { name: it.name, amount: [...parts, ...it.raw].join("＋"), aisle: it.aisle, for: it.for };
  });
  buy.sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle));
  return { buy, pantry };
}

// 献立に入る日（月〜金のうち、期間に入っている日）。n は日曜から数えた日数（月=1）
export function planDays(need) {
  const n = { ...NEED_DEFAULT, ...need };
  const week = mondayOf(n.from);
  const out = [];
  DAYS.forEach((day, i) => {
    const date = addDays(week, i);
    if (date >= n.from && date <= n.to) out.push({ day, n: i + 1, date });
  });
  return { week, days: out };
}

// 日を、同じ品を続けて出すかたまりに分ける（5 日なら 3 日＋2 日）
function chunksOf(days) {
  const k = Math.ceil(days.length / KEEP_DAYS);
  const out = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const size = Math.ceil((days.length - at) / (k - i));
    out.push(days.slice(at, at + size));
    at += size;
  }
  return out;
}

function dishEntry(d) {
  return { id: d.id, name: d.name, kind: d.kind, print_page: d.print_page, fridge: d.fridge, fridge_days: d.fridge_days ?? null,
    freezer: d.freezer ?? null, freezer_ok: !!d.freezer_ok, time_min: d.time_min ?? null, kid_caution: !!d.kid_caution };
}

// 献立と買い物を組んで、週のデータ（下書き）を返す。picks は選んだ品の番号。
// opts: need（今回ほしい分）・fillRest（空いた枠をおまかせで埋めるか。初めは埋める）
export function autoPlan(state, picks = [], opts = {}, rng = Math.random, now = new Date()) {
  const cat = catalog(state);
  if (!cat) throw new Error("品の一覧がまだ届いていません");
  const need = { ...NEED_DEFAULT, ...(opts.need || {}) };
  if (!need.from || !need.to) throw new Error("期間が決まっていません");
  const { week, days } = planDays(need);
  if (!days.length) throw new Error("期間に月〜金の日が入っていません");
  const chunks = chunksOf(days);
  const byId = new Map(cat.dishes.map((d) => [d.id, d]));
  const picked = picks.map((id) => byId.get(id)).filter(Boolean);
  const fill = opts.fillRest !== false;

  // 前の 2 週に出した品は、なるべく避ける
  const recent = new Set();
  const weeks = home(state).weeks || {};
  for (const k of Object.keys(weeks).filter((k) => k < week).sort().slice(-2)) {
    for (const c of weeks[k].cook_sunday || []) recent.add(c.id);
  }
  // おまかせで選ぶのは、作りおき・子どもも食べられる・読み取りに印が無い品だけ
  const pool = cat.dishes.filter((d) => d.kind === "作りおき" && !d.kid_caution && !d.unsure && d.ing && d.ing.length);
  const used = new Set(picked.map((d) => d.id));
  const sections = new Set(picked.map((d) => d.section));
  const keeps = (d, chunk) => d.fridge_days == null || chunk[chunk.length - 1].n <= d.fridge_days;
  const choose = (chunk, ...tests) => {
    if (!fill) return null;
    for (const test of tests) {
      const c = pool.filter((d) => !used.has(d.id) && test(d) && (keeps(d, chunk) || d.freezer_ok))
        .map((d) => ({ d, score: (recent.has(d.id) ? 4 : 0) + (keeps(d, chunk) ? 0 : 2) + (sections.has(d.section) ? 1 : 0) + rng() }))
        .sort((a, b) => a.score - b.score);
      if (c.length) { used.add(c[0].d.id); sections.add(c[0].d.section); return c[0].d; }
    }
    return null;
  };
  const isSoup = (d) => slotOf(d) === "soup";
  const isMain = (d) => !isSoup(d) && (d.group === "肉" || d.group === "魚介");
  const isSide = (d) => !isSoup(d) && !isMain(d);
  const group = (g) => (d) => !isSoup(d) && d.group === g;

  // 枠を作る。汁物は朝と夜の多いほうの数、おかずは夜の数＋朝の数を、かたまりごとに持つ
  const soupLanes = Math.max(need.bSoup, need.dSoup);
  const slots = []; // { chunk, ci, type: soup|main|side|morning, lane, dish }
  chunks.forEach((chunk, ci) => {
    for (let l = 0; l < soupLanes; l++) slots.push({ chunk, ci, type: "soup", lane: l, dish: null });
    for (let l = 0; l < need.dDish; l++) slots.push({ chunk, ci, type: l === 0 ? "main" : "side", lane: l, dish: null });
    for (let l = 0; l < need.bDish; l++) slots.push({ chunk, ci, type: "morning", lane: l, dish: null });
  });
  // 選んだ品を先に入れる。主菜は主菜の枠、ほかは副菜の枠から。合う枠が無ければ、空いているおかずの枠へ
  const put = (d, types) => {
    for (const t of types) {
      const s = slots.find((x) => x.type === t && !x.dish);
      if (s) { s.dish = d; return true; }
    }
    return false;
  };
  const leftover = [];
  for (const d of picked) {
    const ok = isSoup(d) ? put(d, ["soup"]) : isMain(d) ? put(d, ["main", "side", "morning"]) : put(d, ["side", "morning", "main"]);
    if (!ok) leftover.push(d);
  }
  // 空いた枠を、おまかせで埋める。主菜は、かたまりごとに肉と魚を入れ替える
  for (const s of slots) {
    if (s.dish) continue;
    if (s.type === "soup") s.dish = choose(s.chunk, isSoup);
    else if (s.type === "main") s.dish = choose(s.chunk, group(s.ci % 2 === 0 ? "魚介" : "肉"), isMain, (d) => !isSoup(d));
    else if (s.type === "side") s.dish = choose(s.chunk, group("野菜"), isSide, (d) => !isSoup(d));
    else s.dish = choose(s.chunk, group("卵・豆製品"), isSide, (d) => !isSoup(d));
  }

  // 日ごとの献立に並べる
  const plan = Object.fromEntries(DAYS.map((d) => [d, { 朝: [], 夜: [] }]));
  const uses = new Map(); // 品の番号 → 何食に出るか
  const serve = (day, meal, d) => { plan[day][meal].push(dishEntry(d)); uses.set(d.id, (uses.get(d.id) || 0) + 1); };
  for (const s of slots) {
    if (!s.dish) continue;
    for (const { day } of s.chunk) {
      if (s.type === "soup") {
        if (s.lane < need.bSoup) serve(day, "朝", s.dish);
        if (s.lane < need.dSoup) serve(day, "夜", s.dish);
      } else if (s.type === "morning") serve(day, "朝", s.dish);
      else serve(day, "夜", s.dish);
    }
  }
  // 汁物を先、おかずを後に並べ直す
  for (const d of DAYS) for (const m of ["朝", "夜"]) plan[d][m].sort((a, b) => (isSoup(byId.get(a.id)) ? 0 : 1) - (isSoup(byId.get(b.id)) ? 0 : 1));

  // 何回分作るか。1 人分までの不足は見逃す（子どもは半人前より少ないことが多いため。Mac 側の点検と同じ）
  const made = [...uses.keys()].map((id) => {
    const d = byId.get(id);
    const batches = d.servings_n ? Math.max(1, Math.ceil((uses.get(id) * PEOPLE - 1) / d.servings_n)) : 1;
    return { dish: d, batches };
  });
  const cook = made.filter((x) => x.dish.kind === "作りおき").map((x) => ({ ...dishEntry(x.dish), batches: x.batches }));
  const shop = shoppingFor(made, cat.aisles || AISLES);
  const sunday = shoppingFor(made.filter((x) => x.dish.kind === "作りおき"), cat.aisles || AISLES);

  // 気をつけること
  const notes = ["アプリがその場で組んだ献立です。冷蔵庫にあるものは、まだ引いていません。日曜の段取りと詳しい手順は、あとから届きます。"];
  for (const s of slots) {
    const d = s.dish;
    if (!d || d.kind !== "作りおき" || d.fridge_days == null) continue;
    const over = s.chunk.filter((x) => x.n > d.fridge_days).map((x) => x.day);
    if (!over.length) continue;
    notes.push(d.freezer_ok ? `「${d.name}」は ${over.join("・")}曜の分が冷蔵 ${d.fridge} を超えます。日曜に冷凍して、前の夜に冷蔵庫へ移します。`
      : `「${d.name}」は冷蔵 ${d.fridge} で、冷凍もできません。${over.join("・")}曜まではもちません。`);
  }
  for (const x of made) {
    if (x.batches >= 3) notes.push(`「${x.dish.name}」は ${x.batches} 回分作ります（大きい鍋が要ります）。`);
    if (x.dish.kid_caution) notes.push(`「${x.dish.name}」は、子どもの取り分けに注意します。`);
    if (x.dish.unsure) notes.push(`「${x.dish.name}」は、本の P.${x.dish.print_page} で分量を確かめてください（読み取りに自信がない所があります）。`);
  }
  const empty = slots.filter((s) => !s.dish).length;
  if (empty) notes.push(`空いている枠が ${empty} つあります（合う品が見つからなかったか、「足さない」にしているため）。`);
  if (leftover.length) notes.push(`枠に入りきらなかった品: ${leftover.map((d) => d.name).join("・")}`);
  const span = Math.round((new Date(need.to) - new Date(need.from)) / 86400000) + 1;
  if (span > days.length) notes.push("土曜・日曜の分は、まだ組めません（献立に入るのは月〜金です）。");

  const old = weeks[week];
  const bundle = {
    format: FORMAT, version: 1, household: state.household, week_start: week,
    memo: "アプリが組んだ献立（段取りは、あとから届きます）", people: PEOPLE, book: cat.book || "",
    days: plan, cook_sunday: cook,
    shopping: { buy: shop.buy, pantry: shop.pantry, skip: [] },
    notes, draft: true, photo_ids: [...uses.keys()],
    sunday: { assume: "", before: [], cut: [], steps: [], materials: { items: sunday.buy.map(({ name, amount, for: f }) => ({ name, amount, for: f })), pantry: sunday.pantry }, guide: {} },
    exported_at: new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19),
  };
  // もう届いている週を組み直すとき: サーバーの版の印を引き継ぐ（次の受け取りで、古い版に戻されないように）
  if (old && old.server_updated_at) bundle.server_updated_at = old.server_updated_at;
  return bundle;
}

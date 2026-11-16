// 画面。計算は model.js、保存は store.js。
import * as M from "./model.js";
import { load, save, pref } from "./store.js";
import * as C from "./cloud.js";
import * as P from "./planner.js";

export const APP_VERSION = "0.12.4"; // service-worker.js の CACHE と同じ番号にする

let state = load();
const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function commit(next) {
  if (!save(next)) {
    toast("端末に保存できませんでした（空きが足りません）");
    return false;
  }
  state = next;
  return true;
}

// 開き直すと消えるものがあるか（新しい版へ切り替えてよいかの見きわめ）
let typed = false; // 文字の欄に何か打ったか（メモ・ログイン・貼り付けなど）
document.addEventListener("input", (e) => { if (e.target.matches("textarea, input[type=email], input[type=password], input[inputmode=numeric]")) typed = true; });
function busy() {
  return typed || pick.ids.size > 0 || needDecided || !!document.querySelector(".shot.busy");
}

// 知らせを数秒出す。undo を渡すと「元に戻す」を付け、少し長めに出す
function toast(msg, undo) {
  const t = $("#toast");
  t.textContent = msg;
  if (undo) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toastbtn";
    b.textContent = "元に戻す";
    b.addEventListener("click", () => { undo(); t.classList.remove("on", "act"); });
    t.append(b);
  }
  t.classList.toggle("act", !!undo);
  t.classList.add("on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("on", "act"), undo ? 6000 : 2600);
}

// キャラクターの絵: 読めたら顔を出し、読めなければ外す（画面のファイルに動きを直書きしないため、ここで付ける）
function mascot(img, onOk) {
  const done = () => { if (img.naturalWidth) { if (onOk) onOk(); } else img.remove(); };
  if (img.complete) done();
  else { img.addEventListener("load", done); img.addEventListener("error", () => img.remove()); }
}

// ---------- タブ ----------
function showTab(name) {
  $$(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + name));
  $$("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  pref("tab", name);
  window.scrollTo(0, 0);
  keepAwake(name === "cook");
  if (name === "plan") { renderRequest(); loadLastRequest(); }
}

// ---------- 献立 ----------
let dayFilter = "all";

// 献立のカード。押すと「食べた」の印が付く。作りおきは、日曜に作り終えたら「〇曜まで」が出る。
function dishCard(d, w, day, meal) {
  const src = M.photoOf(w, d.id);
  // 取り込みファイルに写真が入っていればそれを出す。サーバーから来た週は、端末の写しからあとで入れる。
  const later = !src && M.photoIds(w).includes(d.id);
  const pic = src ? `<img class="pic" src="${esc(src)}" alt="" loading="lazy">`
    : later ? `<img class="pic" data-dish="${esc(d.id)}" alt="" hidden>` : "";
  const prep = d.kind === "作りおき";
  const until = prep ? M.keepUntil(w.week_start, d.fridge, d.fridge_days) : null;
  const tag = d.home ? "家にある" : prep ? "作りおき" : d.time_min ? `当日 ${esc(d.time_min)} 分` : "当日";
  const meta = d.home ? "" : [
    d.print_page != null ? `<span class="pg">P.${esc(d.print_page)}</span>` : "",
    prep && d.fridge ? `<span class="keepfor">冷蔵 ${esc(d.fridge)}</span>` : "",
    until ? `<span class="until" hidden>${esc(until.day)}曜まで</span>` : "",
    d.kid_caution ? `<span class="kid">取り分け注意</span>` : "",
  ].join("");
  return `<article class="card${src ? " haspic" : ""}" role="button" tabindex="0" data-eat="${esc(M.eatKey(day, meal, d.id))}" data-cook="${esc("cook:" + d.id)}">${pic}
    <div class="tag ${d.home ? "home" : prep ? "prep" : "quick"}"><i></i>${tag}<span class="eaten">食べた</span></div><h4>${esc(d.name)}</h4><div class="meta">${meta}</div></article>`;
}

function updateMenuMarks(wk) {
  $$("#panels .card").forEach((c) => {
    c.classList.toggle("ate", M.isDone(state, wk, c.dataset.eat));
    const made = M.isDone(state, wk, c.dataset.cook);
    const until = $(".until", c);
    if (until) {
      until.hidden = !made;
      const keep = $(".keepfor", c);
      if (keep) keep.hidden = made;
    }
  });
}

function renderMenu(w) {
  const dates = M.dayDates(w.week_start);
  $("#daypills").innerHTML =
    `<button class="pill" data-day="all">すべて</button>` +
    dates.map((d) => `<button class="pill" data-day="${d.day}">${d.day}<small>${d.date}</small></button>`).join("");
  $("#panels").innerHTML = dates.map((d) => {
    const meals = (w.days || {})[d.day] || {};
    const body = M.MEALS.map((m) =>
      `<div class="mealhead">${m}</div><div class="grid">${(meals[m] || []).map((x) => dishCard(x, w, d.day, m)).join("")}</div>`).join("");
    return `<section class="day" data-day="${d.day}"><h3>${d.day}曜 <small>${d.month}/${d.date}</small></h3>${body}</section>`;
  }).join("");
  $$("#panels .card").forEach((c) => {
    const flip = () => {
      const wk = M.home(state).current;
      commit(M.toggleCheck(state, wk, c.dataset.eat, !M.isDone(state, wk, c.dataset.eat)));
      updateMenuMarks(wk);
    };
    c.addEventListener("click", flip);
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
  });
  $$("#daypills .pill").forEach((p) => p.addEventListener("click", () => setDay(p.dataset.day)));
  setDay(M.todayDay(w.week_start) || pref("day") || "all");
  hydratePhotos();
}

// 端末に写しがある料理の写真を、献立カードに入れる
async function hydratePhotos() {
  const urls = new Map();
  for (const img of $$("#panels img[data-dish]")) {
    const id = img.dataset.dish;
    if (!urls.has(id)) urls.set(id, await C.cachedPhotoUrl(id).catch(() => null));
    if (!urls.get(id)) continue;
    img.src = urls.get(id);
    img.hidden = false;
    img.closest(".card").classList.add("haspic");
  }
}

// ログイン中なら、新しい週の献立・品の一覧・料理の写真を受け取る。電波が無ければ、端末の写しのまま動く。
let syncing = false;
async function syncFromServer() {
  if (syncing || !cloudUser || !cloudUser.household) return;
  syncing = true;
  try {
    const { session, household } = cloudUser;
    const w = M.mergeServerWeeks(state, await C.fetchWeeks(session, household));
    const c = M.mergeServerCatalog(w.state, await C.fetchCatalog(session, household));
    if ((w.changed.length || c.changed) && commit(c.state)) {
      renderAll();
      if (!$("#pickbox").hidden) renderPlan();
      if (w.changed.length) toast("新しい献立を受け取りました");
      loadLastRequest();
    }
    // 届いたのに読めないものがあれば知らせる（アプリが古いと、新しい形のデータを読めない）
    if (w.skipped.length || c.skipped) {
      toast(`${w.skipped.length ? w.skipped.map((k) => M.weekSpan(k)).join("・") + " の献立" : "品の一覧"}を読めませんでした。アプリを開き直して、新しい版にしてください`);
    }
    const cur = M.currentWeek(state);
    if (cur) await C.cachePhotos(session, household, M.photoIds(cur), hydratePhotos);
  } catch (e) { /* 受け取れなくても、いま端末にあるぶんで動く */ }
  syncing = false;
}

function setDay(d) {
  dayFilter = d;
  pref("day", d);
  $$("#daypills .pill").forEach((p) => p.classList.toggle("on", p.dataset.day === d));
  $$(".day").forEach((s) => { s.hidden = !(d === "all" || s.dataset.day === d); });
}

// ---------- 買い物・日曜（チェックの行） ----------
let aisle = "all";
let shopDish = "all"; // 買い物の絞り込み: 料理

function rowHtml(r, right) {
  const some = r.some ? `<em>家に ${esc(r.some)} あり</em>` : "";
  return `<label class="row" data-key="${esc(r.key)}" data-aisle="${esc(r.aisle || "")}" data-dishes="${esc((r.dishes || []).join("|"))}">
    <input type="checkbox"><span class="box"></span>
    <span class="body"><b>${esc(r.name)}${r.batches > 1 ? `<span class="x">×${r.batches}</span>` : ""}</b><small>${esc(r.sub || r.keep || "")}${some}</small></span>
    ${right}</label>`;
}

function renderShop(w) {
  const rows = M.shoppingRows(w);
  const aisles = M.AISLE_ORDER.filter((a) => rows.some((r) => r.aisle === a));
  $("#shoppills").innerHTML =
    `<button class="pill" data-aisle="all">すべて</button>` +
    aisles.map((a) => `<button class="pill" data-aisle="${esc(a)}">${esc(M.AISLE_SHORT[a])}</button>`).join("") +
    `<button class="pill" data-aisle="pantry">調味料</button>`;
  $("#shoplist").innerHTML = rows.map((r) => rowHtml(r,
    (r.amount ? `<span class="amt">${esc(r.amount)}</span>` : "") +
    (r.pantry ? "" : `<button type="button" class="nonebtn" data-none="${esc(M.noneKey(r.name))}">無かった</button>`))).join("");
  $$("#shoplist .nonebtn").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wk = M.home(state).current;
    commit(M.toggleCheck(state, wk, b.dataset.none, !M.isDone(state, wk, b.dataset.none)));
    refreshChecks();
  }));
  $("#skiplist").innerHTML = (w.shopping.skip || []).map((s) => `<li><b>${esc(s.name)}</b><span>${esc(s.where || "")}</span></li>`).join("") || "<li><span>なし</span></li>";
  $$("#shoppills .pill").forEach((p) => p.addEventListener("click", () => { aisle = p.dataset.aisle; refreshChecks(); }));
  const dishes = M.shopDishes(w);
  if (!dishes.some((d) => d.name === shopDish)) shopDish = "all";
  $("#shopdish").innerHTML = `<option value="all">すべての料理</option>` +
    dishes.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}（${d.count}）</option>`).join("");
  $("#shopdish").value = shopDish;
  $("#shopdish").onchange = (e) => { shopDish = e.target.value; if (shopDish !== "all" && aisle === "pantry") aisle = "all"; refreshChecks(); };
}

function checkRow(key, cls, body, right = "") {
  return `<label class="row ${cls}" data-key="${esc(key)}"><input type="checkbox"><span class="box"></span><span class="body">${body}</span>${right}</label>`;
}

let stepPlace = "all"; // レシピの絞り込み: 場所
let stepDish = null;   // レシピの絞り込み: 料理（作る品の「手順を見る」から）

function renderCook(w) {
  const s = M.sundayPlan(w);
  const places = M.places(s.steps);
  const hasSteps = (id) => s.steps.some((x) => x.dish === id);
  $("#cooklist").innerHTML = M.cookRows(w).map((r) => {
    const id = r.key.slice(5);
    return rowHtml(r, (r.page != null ? `<span class="amt pg">P.${esc(r.page)}</span>` : "") +
      (hasSteps(id) ? `<button type="button" class="nonebtn" data-steps="${esc(id)}">手順を見る</button>` : ""));
  }).join("");
  $$("#cooklist [data-steps]").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    stepDish = b.dataset.steps;
    stepPlace = "all";
    setSun("steps");
    refreshChecks();
  }));
  $("#assume").textContent = s.assume;
  renderTimeline(s);
  // 料理で絞る: 「すべて」は時刻の順、品を選ぶとその品の詳しい手順と、時刻の順での出番
  $("#dishpills").innerHTML = `<button class="pill" data-dish="">すべて</button>` +
    M.cookRows(w).map((r) => `<button class="pill" data-dish="${esc(r.key.slice(5))}">${esc(r.name)}</button>`).join("");
  $$("#dishpills .pill").forEach((p) => p.addEventListener("click", () => { stepDish = p.dataset.dish || null; stepPlace = "all"; refreshChecks(); }));
  $("#placepills").innerHTML = `<button class="pill" data-place="all">すべて</button>` +
    places.map((p, i) => `<button class="pill pl${i % 6}" data-place="${esc(p)}"><i class="dot"></i>${esc(p)}</button>`).join("");
  $$("#placepills [data-place]").forEach((p) => p.addEventListener("click", () => { stepPlace = p.dataset.place; refreshChecks(); }));
  $("#steplist").innerHTML = s.steps.map((x) => checkRow(x.key, `step pl${places.indexOf(x.where) % 6}" data-place="${esc(x.where)}" data-dish="${esc(x.dish || "")}`,
    `<span class="when"><i>${esc(x.at)}</i>${esc(x.where)}</span><b>${esc(x.title)} ${x.page != null ? `<span class="pg">P.${esc(x.page)}</span>` : ""}</b><small class="wr">${esc(x.text)}</small>`,
    x.dish && s.guide[x.dish] ? `<button type="button" class="nonebtn" data-guide="${esc(x.dish)}">くわしく</button>` : "")).join("");
  $$("#steplist [data-guide]").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openGuide(b.dataset.guide);
  }));
  $("#matlist").innerHTML = s.materials.map((x) => checkRow(x.key, "",
    `<b>${esc(x.name)}</b><small>${esc(x.sub)}</small>`, `<span class="amt">${esc(x.amount)}</span>`)).join("");
  $("#matpantry").innerHTML = s.pantry.map((p) => `<span>${esc(p)}</span>`).join("");
  $("#beforelist").innerHTML = s.before.map((x) => checkRow(x.key, "", `<b class="wr">${esc(x.text)}</b>`)).join("");
  $("#cutlist").innerHTML = s.cut.map((x) => checkRow(x.key, "",
    `<b>${esc(x.name)}</b><small class="wr">${esc(x.how)}</small>`, `<span class="amt for">${esc(x.for)}</span>`)).join("");
  $$("#sunpills .pill").forEach((p) => { p.onclick = () => setSun(p.dataset.sun); });
  setSun(s.has ? pref("sun") || "dish" : "dish");
}

// 全体の流れ: 場所ごとの帯を横に並べ、どの場所でいつ何が動いているかを 1 枚で見せる。帯を押すとその料理の手順へ。
const TL_PX = 4;      // 1 分あたりの幅
const TL_LABEL = 70;  // 左の場所の名前の幅
function renderTimeline(s) {
  const t = M.timeline(s.steps);
  const box = $("#timeline");
  box.hidden = !t.lanes.length;
  if (!t.lanes.length) return;
  const places = M.places(s.steps);
  const ticks = [];
  for (let m = 0; m <= t.total; m += 15) ticks.push(`<span style="left:${TL_LABEL + m * TL_PX}px">${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}</span>`);
  const lanes = t.lanes.map((l) => `<div class="tllane pl${places.indexOf(l.place) % 6}"><span class="tlplace">${esc(l.place)}</span>${l.blocks.map((b) =>
    `<button type="button" class="tlb" data-key="${esc(b.key)}" data-dish="${esc(b.dish || "")}" style="left:${TL_LABEL + b.start * TL_PX}px;width:${(b.end - b.start) * TL_PX - 3}px">${esc(b.title)}</button>`).join("")}</div>`).join("");
  box.innerHTML = `<div class="tlhead"><b>全体の流れ</b><span>横に動かせます・帯を押すとその料理の手順へ</span></div>
    <div class="tlscroll"><div class="tlgrid" style="width:${TL_LABEL + t.total * TL_PX + 16}px"><div class="tlaxis">${ticks.join("")}</div>${lanes}</div></div>`;
  $$(".tlb", box).forEach((b) => b.addEventListener("click", () => {
    stepDish = b.dataset.dish || null;
    stepPlace = "all";
    refreshChecks();
    if (!stepDish) { const row = $$("#steplist .row").find((r) => r.dataset.key === b.dataset.key); if (row) row.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }));
}

// 短い一言（「肉に下味」など）で分からないときに、その料理のくわしい手順へ移る
function openGuide(dish) {
  stepDish = dish;
  stepPlace = "all";
  setSun("steps");
  refreshChecks();
  const box = $("#dishpills");
  if (box) box.scrollIntoView({ block: "start", behavior: "smooth" });
}

// 選んだ品の詳しい手順（下味とは何をするのか、煮たあとどうなるのか、まで）。待つ手順にはタイマー。
let guideFor = null;
function renderGuide(w, s) {
  const box = $("#dishguide");
  const g = stepDish ? s.guide[stepDish] : null;
  box.hidden = !stepDish;
  if (!stepDish) { guideFor = null; return; }
  if (guideFor === w.week_start + stepDish) { tickTimers(); return; } // 同じ品なら作り直さない（タイマーの表示を保つ）
  guideFor = w.week_start + stepDish;
  const dish = M.cookRows(w).find((r) => r.key === "cook:" + stepDish);
  if (!g) {
    box.innerHTML = `<div class="guide"><h3>${esc(dish.name)}</h3><p class="where">この品の詳しい手順は、まだ入っていません。本の P.${esc(dish.page)} を開いてください。</p></div>`;
    return;
  }
  const steps = (g.steps || []).map((x, i) => `<div class="gstep"><span class="num">${i + 1}</span><div>
      <b>${esc(x.t)}</b><p>${esc(x.do)}</p>${x.why ? `<p class="why">${esc(x.why)}</p>` : ""}
      ${x.wait_min ? `<button type="button" class="timer" data-timer="${esc(`${w.week_start}|${stepDish}|${i}`)}" data-min="${esc(x.wait_min)}">${esc(x.wait_min)} 分のタイマーを始める</button>` : ""}
    </div></div>`).join("");
  box.innerHTML = `<div class="guide"><h3>${esc(dish.name)}${dish.batches > 1 ? ` ×${dish.batches}` : ""}</h3>
    <p class="where">${esc(g.amounts || (dish.page != null ? `分量は本の P.${dish.page}` : ""))}</p>${steps}
    ${g.after ? `<div class="after"><b>できあがったら</b>${esc(g.after)}</div>` : ""}</div>`;
  $$(".timer", box).forEach((b) => b.addEventListener("click", () => {
    const t = timers();
    if (t[b.dataset.timer]) delete t[b.dataset.timer]; // 動いている・終わったタイマーをもう一度押すと止める
    else t[b.dataset.timer] = Date.now() + Number(b.dataset.min) * 60000;
    pref("timers", JSON.stringify(t));
    tickTimers();
  }));
  tickTimers();
}

// タイマーは自分で押したときだけ動く。終わる時刻を端末に覚えさせるので、アプリを閉じても続きから数える。
function timers() {
  try { return JSON.parse(pref("timers") || "{}"); } catch (e) { return {}; }
}

function tickTimers() {
  const t = timers();
  $$(".timer").forEach((b) => {
    const end = t[b.dataset.timer];
    const left = end ? Math.ceil((end - Date.now()) / 1000) : null;
    b.classList.toggle("run", left !== null && left > 0);
    b.classList.toggle("end", left !== null && left <= 0);
    b.textContent = left === null ? `${b.dataset.min} 分のタイマーを始める`
      : left > 0 ? `あと ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}（押すと止める）`
      : "時間です。次へ進みましょう（押すと消える）";
  });
  // 動いているタイマーは、料理タブのいちばん上にも出す（くわしい手順を閉じても見失わないように）
  const w = M.currentWeek(state);
  const strip = $("#timerstrip");
  const items = w ? Object.entries(t).filter(([k]) => k.startsWith(w.week_start + "|")) : [];
  strip.hidden = !items.length;
  const keys = items.map(([k]) => k).join(",");
  if (strip.dataset.keys !== keys) { // 中身が変わったときだけ作り直す（押している途中で消えないように）
    strip.dataset.keys = keys;
    strip.innerHTML = items.map(([k]) => `<button type="button" class="tchip" data-key="${esc(k)}" data-dish="${esc(k.split("|")[1])}"></button>`).join("");
  }
  $$(".tchip", strip).forEach((chip) => {
    const [, dish, i] = chip.dataset.key.split("|");
    const cook = w.cook_sunday.find((c) => c.id === dish);
    const g = ((w.sunday || {}).guide || {})[dish];
    const left = Math.ceil((t[chip.dataset.key] - Date.now()) / 1000);
    chip.classList.toggle("end", left <= 0);
    chip.textContent = `${cook ? cook.name : ""}・${g && g.steps[i] ? g.steps[i].t : ""}　${left > 0 ? `あと ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "時間です"}`;
  });
}
setInterval(tickTimers, 1000);

// 料理タブを開いているあいだは、画面が消えないようにする（手が濡れていても見続けられるように）。使えない端末では何もしない。
let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && "wakeLock" in navigator) {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => { wake = null; });
    } else if (!on && wake) {
      await wake.release();
      wake = null;
    }
  } catch (e) { /* 断られても、いつもどおり動く */ }
}

function setSun(name) {
  const w = M.currentWeek(state);
  const has = w ? M.sundayPlan(w).has : false;
  pref("sun", name);
  $$("#sunpills .pill").forEach((p) => p.classList.toggle("on", p.dataset.sun === name));
  $$(".sun").forEach((s) => { s.hidden = s.dataset.sun !== name; });
  $("#sunempty").hidden = has || name === "dish";
}

function bindRows() {
  $$(".row").forEach((row) => {
    const box = $("input", row);
    box.addEventListener("change", () => {
      const wk = M.home(state).current;
      let next = M.toggleCheck(state, wk, row.dataset.key, box.checked);
      // 手順を済ませたら、その料理の「作る品」も済みにする（進み具合が食い違わないように）
      if (box.checked && row.dataset.key.startsWith("step:")) next = M.autoCook(next, wk, M.currentWeek(next));
      commit(next);
      refreshChecks();
    });
  });
}

function refreshChecks() {
  const w = M.currentWeek(state);
  if (!w) return;
  const wk = w.week_start;
  $$(".row").forEach((row) => {
    const done = M.isDone(state, wk, row.dataset.key);
    $("input", row).checked = done;
    row.classList.toggle("done", done);
  });
  // 買い物
  $$("#shoppills .pill").forEach((p) => p.classList.toggle("on", p.dataset.aisle === aisle));
  let shown = 0;
  $$("#shoplist .row").forEach((row) => {
    const pantry = row.dataset.aisle === "pantry";
    const inAisle = aisle === "all" ? !pantry : row.dataset.aisle === aisle;
    const inDish = shopDish === "all" || pantry || row.dataset.dishes.split("|").includes(shopDish);
    const ok = inAisle && inDish;
    row.hidden = !ok;
    if (ok && !row.classList.contains("done")) shown++;
  });
  $("#shopdish").classList.toggle("on", shopDish !== "all");
  $("#shopempty").textContent = shopDish === "all" ? "この売り場は全部かごに入りました" : "この料理の分は、ここでは買うものがありません";
  $("#shopempty").hidden = shown > 0;
  const buy = M.shopProgress(state, wk, w);
  const none = buy.missing ? `・無かった ${buy.missing}` : "";
  $("#shopleft").textContent = buy.left;
  $("#shoptext").textContent = buy.left ? `品目 残り（全 ${buy.total}${none}）`
    : buy.missing ? `品目 残りなし（無かった ${buy.missing} 品目は「メモ」に出ます）` : "品目 すべてかごに入りました";
  $("#shopbar").style.width = buy.ratio * 100 + "%";
  $("#tshop").textContent = buy.left ? buy.left : "✓";
  cheer($("#v-shop .prog"), buy.left === 0);
  // 買い物: 店に無かった印
  $$("#shoplist .nonebtn").forEach((b) => {
    const none = M.isDone(state, wk, b.dataset.none);
    b.closest(".row").classList.toggle("missing", none);
    b.textContent = none ? "無かった ✓" : "無かった";
  });
  const missing = M.missingItems(state, wk, w);
  $("#missingbox").hidden = !missing.length;
  $("#missing").innerHTML = missing.map((n) => `<li>${esc(n)}</li>`).join("");
  // 献立: 食べた・〇曜まで
  updateMenuMarks(wk);
  // 日曜のレシピ: いまやること・絞り込み
  const s = M.sundayPlan(w);
  const now = M.currentStep(state, wk, s.steps);
  const left = s.steps.filter((x) => !M.isDone(state, wk, x.key)).length;
  $("#nowbox").hidden = !s.has;
  $("#nowbox").classList.toggle("alldone", s.has && !now);
  $("#nowhead").textContent = now ? `いま ${now.at} の工程・残り ${left} 手順` : "手順は全部終わりました";
  $("#nowbody").innerHTML = now
    ? `<span class="when"><i>${esc(now.at)}</i>${esc(now.where)}</span><b>${esc(now.title)} ${now.page != null ? `<span class="pg">P.${esc(now.page)}</span>` : ""}</b><p>${esc(now.text)}</p>`
    : "";
  $("#nowdone").hidden = !now;
  const nowGuide = now && now.dish && s.guide[now.dish] ? now.dish : "";
  $("#nowguide").hidden = !nowGuide;
  $("#nowguide").dataset.dish = nowGuide;
  $("#nowdone").dataset.key = now ? now.key : "";
  $$("#placepills [data-place]").forEach((p) => p.classList.toggle("on", p.dataset.place === stepPlace));
  if (stepDish && !M.cookRows(w).some((r) => r.key === "cook:" + stepDish)) stepDish = null; // 週が替わって無くなった品
  $$("#dishpills .pill").forEach((p) => p.classList.toggle("on", (p.dataset.dish || null) === stepDish));
  $("#placepills").hidden = !!stepDish;
  $("#nowbox").hidden = !s.has || !!stepDish;
  $("#assume").hidden = !!stepDish;
  $("#stephead").hidden = !stepDish;
  renderGuide(w, s);
  $$("#timeline .tlb").forEach((b) => {
    b.classList.toggle("done", M.isDone(state, wk, b.dataset.key));
    b.classList.toggle("current", !!now && b.dataset.key === now.key);
    b.classList.toggle("dim", !!stepDish && b.dataset.dish !== stepDish);
  });
  // いまの手順（料理を選んでいるときは、その料理の最初の帯）が見える位置まで、横に寄せる
  const focus = stepDish ? $$("#timeline .tlb").find((b) => b.dataset.dish === stepDish) : $("#timeline .tlb.current");
  const scroller = $("#timeline .tlscroll");
  const focusKey = focus ? (stepDish || "") + focus.dataset.key : "";
  if (scroller && focus && scroller.dataset.focus !== focusKey) {
    scroller.dataset.focus = focusKey;
    scroller.scrollTo({ left: Math.max(0, focus.offsetLeft - TL_LABEL - 12), behavior: "smooth" });
  }
  $$("#steplist .row").forEach((row) => {
    row.hidden = !((stepPlace === "all" || row.dataset.place === stepPlace) && (!stepDish || row.dataset.dish === stepDish));
    row.classList.toggle("current", !!now && row.dataset.key === now.key);
  });
  // 日曜
  const cook = M.progress(state, wk, M.cookRows(w));
  $("#cookleft").textContent = cook.left;
  $("#cooktext").textContent = cook.left ? `品 残り（全 ${cook.total}）` : "品 すべて作りました";
  $("#cookbar").style.width = cook.ratio * 100 + "%";
  $("#tcook").textContent = cook.left ? cook.left : "✓";
  cheer($("#v-cook .prog"), cook.left === 0);
}

// ---------- メモと記録 ----------
function renderNote(w) {
  $("#notes").innerHTML = (w.notes || []).map((n) => `<li>${esc(n)}</li>`).join("") || "<li>なし</li>";
  const log = M.getLog(state, w.week_start);
  $("#log-min").value = log.cook_minutes;
  $("#log-good").value = log.good;
  $("#log-bad").value = log.bad;
  $("#logsaved").textContent = log.updated_at ? "保存済み" : "";
}

function saveLog() {
  const w = M.currentWeek(state);
  if (!w) return;
  commit(M.setLog(state, w.week_start, {
    cook_minutes: $("#log-min").value.trim(), good: $("#log-good").value.trim(), bad: $("#log-bad").value.trim(),
  }));
  $("#logsaved").textContent = "保存済み";
}

// ---------- 設定（取り込み・書き出し） ----------
function renderSettings() {
  const h = M.home(state);
  const weeks = Object.keys(h.weeks).sort().reverse();
  $("#weeksel").innerHTML = weeks.map((k) => `<option value="${esc(k)}"${k === h.current ? " selected" : ""}>${M.weekSpan(k)} の週</option>`).join("");
  $("#weekbox").hidden = weeks.length < 2;
  // 献立タブの先頭にも、週の切り替えを出す（持っている週が 2 つ以上のとき。新しい 3 週まで）
  const bar = $("#weekbar");
  bar.hidden = weeks.length < 2;
  bar.innerHTML = `<span>週</span>` + weeks.slice(0, 3).reverse().map((k) => `<button type="button" class="pill${k === h.current ? " on" : ""}" data-week="${k}">${esc(M.weekSpan(k))}</button>`).join("");
  $("#version").textContent = APP_VERSION;
}

// 表示する週を切り替える。チェックの印は週ごとに別々に残る。
function switchWeek(k) {
  if (!M.home(state).weeks[k] || M.home(state).current === k) return;
  const next = structuredClone(state);
  M.home(next).current = k;
  commit(next);
  renderAll();
  renderRequest();
  // 切り替えた先の週の写真が端末に無ければ、ここで取り込む（開き直さなくても出るように）
  const cur = M.currentWeek(state);
  if (cur && cloudUser && cloudUser.household) {
    C.cachePhotos(cloudUser.session, cloudUser.household, M.photoIds(cur), hydratePhotos).catch(() => {});
  }
}

function takeIn(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { toast("読めませんでした（ファイルの中身が壊れています）"); return; }
  try {
    if (obj && obj.format === M.CATALOG_FORMAT) {
      if (!commit(M.importCatalog(state, obj))) return;
      toast(`品の一覧を取り込みました（${obj.dishes.length} 品）`);
      $("#paste").value = "";
      renderPlan();
      $("#pickbox").hidden = false;
      showTab("plan");
      return;
    }
    if (obj && obj.format === "mealprep-backup") {
      commit(M.fromBackup(obj));
      toast("書き出しファイルから戻しました");
    } else {
      let next = M.importBundle(state, obj);
      let ok = commit(next);
      if (!ok && obj.photos) {
        // 写真つきで入りきらないときは、写真を外して献立だけ入れる
        next = M.importBundle(state, { ...obj, photos: {} });
        ok = commit(next);
        if (ok) { toast("写真が大きすぎたので、献立だけ取り込みました"); $("#paste").value = ""; renderAll(); showTab("menu"); }
        return;
      }
      if (!ok) return;
      toast(`${M.weekSpan(obj.week_start)} の週を取り込みました`);
    }
  } catch (e) { toast(e.message); return; }
  $("#paste").value = "";
  renderAll();
  showTab("menu");
}

function download() {
  const blob = new Blob([JSON.stringify(M.toBackup(state), null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mealprep-backup-${M.iso(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 献立を作る（入口 2 つと、カテゴリから選ぶ） ----------
const pick = { kind: M.KINDS[0], group: "", kidOk: false, ids: new Set() };

// 「今回ほしい分」。1 回に出す品数は端末に覚えておく。期間は、開くたびに次の週（月〜金）から始める。
const NEED_KEYS = ["bSoup", "bDish", "dSoup", "dDish"];
const need = (() => {
  let saved = {};
  try { saved = JSON.parse(pref("need") || "{}") || {}; } catch (e) { saved = {}; }
  const n = { ...M.NEED_DEFAULT };
  for (const k of NEED_KEYS) if (Number.isInteger(saved[k])) n[k] = Math.max(0, Math.min(M.NEED_MAX[k], saved[k]));
  return n;
})();
let needDecided = false; // 「これで決める」を押すまでは、枠ができない
let needAuto = true;     // 期間を手で変えるまでは、次の週（月〜金）に合わせ続ける

function pickedDishes() {
  const cat = M.catalog(state);
  return cat ? [...pick.ids].map((id) => cat.dishes.find((d) => d.id === id)).filter(Boolean) : [];
}

const mdText = (isoDate) => { const [, m, d] = isoDate.split("-").map(Number); return `${m}/${d}`; };
const partText = (s, d) => [s ? `汁物 ${s}` : "", d ? `おかず ${d}` : ""].filter(Boolean).join("・");

function renderNeeds() {
  // 週のデータがあとから届くと「次の週」が変わる。手で変えておらず、まだ決めていなければ、置き直す。
  if (!need.from || (needAuto && !needDecided && need.from !== M.nextPlanWeek(state))) { need.from = M.nextPlanWeek(state); need.to = M.addDays(need.from, 4); }
  const slots = M.needSlots(need);
  $("#need-edit").hidden = needDecided;
  $("#need-done").hidden = !needDecided;
  $("#need-from").value = need.from;
  $("#need-to").value = need.to;
  $("#need-to").min = need.from;
  $("#need-days").textContent = slots.cookDays === slots.days ? `${slots.days} 日ぶんの献立を作ります`
    : slots.cookDays ? `献立に入るのは、月〜金の ${slots.cookDays} 日ぶんです（土日はまだ組めません）` : "月〜金の日が入っていません。期間を選び直してください";
  $$("#needs .step").forEach((s) => { $("output", s).textContent = need[s.dataset.need]; });
  $("#need-dinner").textContent = `計 ${slots.dinner} 品`;
  $("#need-breakfast").textContent = `計 ${slots.breakfast} 品`;
  $("#need-auto").textContent = `汁物 ${slots.soup} 品・おかず ${slots.dish} 品`;
  $("#need-sum").textContent = [
    `期間　${mdText(need.from)}〜${mdText(need.to)}（${slots.days} 日）`,
    `夜　${slots.dinner} 品${slots.dinner ? `（${partText(need.dSoup, need.dDish)}）` : ""}`,
    `朝　${slots.breakfast} 品${slots.breakfast ? `（${partText(need.bSoup, need.bDish)}）` : ""}`,
    `作る品　汁物 ${slots.soup} 品・おかず ${slots.dish} 品`,
  ].join("\n");
}

function bindNeeds() {
  const changed = () => { renderNeeds(); renderRequest(); };
  $("#need-from").addEventListener("change", (e) => {
    if (!e.target.value) return renderNeeds();
    needAuto = false;
    const span = M.daysBetween(need.from, need.to);
    need.from = e.target.value;
    need.to = M.addDays(need.from, Math.max(0, span - 1));
    changed();
  });
  $("#need-to").addEventListener("change", (e) => {
    if (e.target.value && e.target.value >= need.from) { need.to = e.target.value; needAuto = false; }
    changed();
  });
  $$("#needs .step button").forEach((b) => b.addEventListener("click", () => {
    const key = b.closest(".step").dataset.need;
    const next = need[key] + Number(b.dataset.d);
    if (next < 0 || next > M.NEED_MAX[key]) return;
    need[key] = next;
    pref("need", JSON.stringify(Object.fromEntries(NEED_KEYS.map((k) => [k, need[k]]))));
    changed();
  }));
  $("#need-ok").addEventListener("click", () => {
    const slots = M.needSlots(need), used = M.slotCounts(pickedDishes());
    if (!slots.soup && !slots.dish) { toast("品数が 0 です。夜か朝の品数を足してください"); return; }
    if (used.soup > slots.soup || used.dish > slots.dish) { toast("選んである品が、枠より多くなります。先に下の「選び直す」で外してください"); return; }
    needDecided = true;
    renderRequest();
    if (!$("#pickbox").hidden) renderPlan();
    $("#needs").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  $("#need-change").addEventListener("click", () => { needDecided = false; renderRequest(); });
}

function renderPlan() {
  const cat = M.catalog(state);
  $("#pick-nocat").hidden = !!cat;
  $("#pick-main").hidden = !cat;
  if (!cat) return;
  const pill = (attr, value, label, on) => `<button class="pill${on ? " on" : ""}" data-${attr}="${esc(value)}">${esc(label)}</button>`;
  $("#kindpills").innerHTML = M.KINDS.map((k) => pill("kind", k, k, pick.kind === k)).join("");
  $("#grouppills").innerHTML = pill("group", "", "すべて", !pick.group) + M.GROUPS.map((g) => pill("group", g, g, pick.group === g)).join("");
  $$("#kindpills .pill").forEach((p) => p.addEventListener("click", () => { pick.kind = p.dataset.kind; renderPlan(); }));
  $$("#grouppills .pill").forEach((p) => p.addEventListener("click", () => { pick.group = p.dataset.group; renderPlan(); }));
  $("#kidok").checked = pick.kidOk;
  const shown = M.filterDishes(cat.dishes, { kind: pick.kind, group: pick.group, kidOk: pick.kidOk });
  $("#pickcount").textContent = pickCountText(shown.length);
  $("#picklist").innerHTML = shown.map((d) => {
    const keep = d.kind === "作りおき" ? (d.fridge ? `冷蔵 ${d.fridge}` : "") + (d.freezer_ok ? "・冷凍できる" : "") : d.time_min ? `当日 ${d.time_min} 分` : "当日";
    return `<label class="row${pick.ids.has(d.id) ? " picked" : ""}" data-pick="${esc(d.id)}"><input type="checkbox"${pick.ids.has(d.id) ? " checked" : ""}><span class="box"></span>
      <span class="thumb"><img data-thumb="${esc(d.id)}" alt="" hidden></span>
      <span class="body"><b>${esc(d.name)}</b><small>${esc([d.section, keep].filter(Boolean).join("・"))}${d.kid_caution ? `<em>取り分け注意</em>` : ""}</small></span>
      <span class="amt pg">P.${esc(d.print_page)}</span></label>`;
  }).join("");
  $$("#picklist .row").forEach((row) => $("input", row).addEventListener("change", (e) => {
    const id = row.dataset.pick;
    if (e.target.checked && !needDecided) {
      e.target.checked = false;
      toast("先に、上の「今回ほしい分」で「これで決める」を押してください");
      return;
    }
    const slots = M.needSlots(need);
    if (e.target.checked && !M.canPick(cat.dishes, pick.ids, id, slots)) {
      e.target.checked = false;
      const soup = M.slotOf(cat.dishes.find((d) => d.id === id)) === "soup";
      toast(`${soup ? "汁物" : "おかず"}の枠は ${soup ? slots.soup : slots.dish} 品で、もう埋まっています`);
      return;
    }
    if (e.target.checked) pick.ids.add(id); else pick.ids.delete(id);
    row.classList.toggle("picked", e.target.checked);
    $("#pickcount").textContent = pickCountText(shown.length);
    renderRequest();
  }));
  renderRequest();
  hydrateThumbs();
}

function pickCountText(shown) {
  const used = M.slotCounts(pickedDishes()), slots = M.needSlots(need);
  return `${shown} 品を表示中・汁物 ${used.soup}/${slots.soup}・おかず ${used.dish}/${slots.dish} を選択中`;
}

// 品の一覧の小さな写真。サーバーに写真がある品だけ出る（無い品は、生成りの四角のまま）。
let photoAvail = null; // サーバーに写真がある品の番号
async function hydrateThumbs() {
  const imgs = $$("#picklist img[data-thumb]");
  if (!imgs.length) return;
  const show = async () => {
    for (const img of imgs) {
      if (!img.hidden || !img.isConnected) continue;
      const url = await C.cachedPhotoUrl(img.dataset.thumb).catch(() => null);
      if (url) { img.src = url; img.hidden = false; }
    }
  };
  await show(); // 端末にもう写しがあるぶんを先に出す
  if (!cloudUser || !cloudUser.household) return;
  try {
    if (!photoAvail) photoAvail = new Set(await C.listPhotoIds(cloudUser.session, cloudUser.household));
    const want = imgs.map((i) => i.dataset.thumb).filter((id) => photoAvail.has(id));
    await C.cachePhotos(cloudUser.session, cloudUser.household, want, show);
  } catch (e) { /* 写真が取れなくても、一覧は使える */ }
}

function currentRequest() {
  return M.buildRequest(state, [...pick.ids], { kidOk: pick.kidOk, fillRest: $("#fillrest").checked, note: $("#picknote").value, need });
}

let photosToday = 0;   // 今日送った冷蔵庫の写真の枚数（冷蔵庫タブで数えたもの）
let lastRequest = null; // サーバーにある、いちばん新しい注文

function renderRequest() {
  renderNeeds();
  const r = currentRequest();
  $("#pickweek").textContent = "いつの分を、1 回に何品ほしいかを決めてから、下で選びます。";
  const slots = M.needSlots(need);
  const picked = pickedDishes();
  const slotHtml = (key, label) => {
    const mine = picked.filter((d) => M.slotOf(d) === key);
    const cells = [];
    for (let i = 0; i < slots[key]; i++) cells.push(mine[i] ? `<span class="slot on">${esc(mine[i].name)}</span>` : `<span class="slot${needDecided ? "" : " wait"}">${label} ${i + 1}</span>`);
    return cells.join("");
  };
  $("#slots").innerHTML = slotHtml("soup", "汁物") + slotHtml("dish", "おかず");
  $("#reqtext").textContent = r.text;
  $("#reqshare").hidden = !navigator.share;
  const cat = M.catalog(state);
  const names = cat ? [...pick.ids].map((id) => (cat.dishes.find((d) => d.id === id) || {}).name).filter(Boolean) : [];
  const open = slots.soup + slots.dish - names.length;
  $("#pickedsum").textContent = !needDecided ? "まだ仮の枠です。上の「今回ほしい分」で「これで決める」を押すと、ここに料理を当てはめられます。"
    : !names.length ? "まだ選んでいません。空いている枠は、おまかせになります。"
    : open > 0 ? `${names.length} 品を選びました。空いている ${open} 枠は、おまかせになります。` : "枠がすべて埋まりました。";
  $("#pickclear").hidden = !names.length;
  $("#reqphotos").textContent = photosToday
    ? `今日は冷蔵庫の写真を ${photosToday} 枚送っています。この写真を使って組みます。`
    : "冷蔵庫の写真を送っておくと、家にある物を使い切る献立になります。";
  $("#reqsend").disabled = !cloudUser;
  if (!cloudUser) $("#reqmsg").textContent = "頼むには、この画面の上でログインします";
  const box = $("#reqstatus");
  box.hidden = !lastRequest;
  if (lastRequest) {
    const when = new Date(lastRequest.created_at);
    const at = `${when.getMonth() + 1}/${when.getDate()} ${when.getHours()}:${String(when.getMinutes()).padStart(2, "0")}`;
    const h = M.home(state);
    const mine = h.weeks[lastRequest.week_start];
    const arrived = mine && (lastRequest.status === "done" || mine.draft);
    const see = !arrived ? "" : h.current === lastRequest.week_start
      ? `<p class="hint">いま、この週を表示しています。</p>`
      : `<div class="formfoot"><button type="button" class="btn" data-seeweek="${esc(lastRequest.week_start)}">この週を見る</button><span>いまは ${esc(M.weekSpan(h.current))} の週を表示中</span></div>`;
    const label = { new: mine && mine.draft ? (M.sundayPlan(mine).has ? "献立・買い物・レシピは、もう出ています" : "献立と買い物は、もう出ています。日曜の段取りと詳しい手順は、あとから届きます") : "頼みました。献立はこれから組むので、すぐには変わりません。できあがると、献立・買い物・料理が入れ替わります",
      working: mine && mine.draft ? (M.sundayPlan(mine).has ? "献立・買い物・レシピは、もう出ています。いま、冷蔵庫の写真を反映しています" : "献立と買い物は、もう出ています。いま、日曜の段取りを足しています") : "いま組んでいます。できあがると、献立・買い物・料理が入れ替わります", done: "届きました",
      failed: "組めませんでした", cancelled: "取り消されました" }[lastRequest.status] || lastRequest.status;
    box.innerHTML = `<p class="hint"><b>${esc(M.weekSpan(lastRequest.week_start))} の週の注文（${esc(at)}）</b><br>${esc(label)}${lastRequest.status_note ? `：${esc(lastRequest.status_note)}` : ""}</p>${see}`;
  }
}

// 注文に添えてある下書き（頼んだ端末がその場で組んだ献立）を、この端末にも入れる。表示中の週は変えない。
function takeDraft(req) {
  if (!req || !req.draft || !["new", "working"].includes(req.status)) return;
  const h = M.home(state);
  const have = h.weeks[req.week_start];
  if (have && (have.exported_at === req.draft.exported_at || !have.draft && have.exported_at > req.draft.exported_at)) return;
  try {
    const keep = h.current;
    const next = M.importBundle(state, { ...req.draft, household: state.household });
    if (keep) M.home(next).current = keep;
    if (commit(next)) renderAll();
  } catch (e) { /* 下書きが読めなくても、できあがった献立はあとで届く */ }
}

async function loadLastRequest() {
  if (!cloudUser || !cloudUser.household) return;
  try {
    lastRequest = await C.latestRequest(cloudUser.session, cloudUser.household);
    takeDraft(lastRequest);
    renderRequest();
  } catch (e) { /* 見られなくても、頼むことはできる */ }
}

async function sendRequest() {
  const btn = $("#reqsend");
  if (!cloudUser || !cloudUser.household) { $("#reqmsg").textContent = "頼むには、この画面の上でログインします"; return; }
  btn.disabled = true;
  $("#reqmsg").textContent = "送っています…";
  try {
    const session = await C.ensureSession();
    const r = currentRequest();
    let draft = null;
    if (P.canAutoPlan(state)) {
      const old = M.home(state).weeks[r.data.week_start];
      if (old && !old.draft && !confirm(`${M.weekSpan(r.data.week_start)} の週は、もう献立があります。作り直しますか？（いまの献立は、新しいものに置き換わります）`)) {
        $("#reqmsg").textContent = ""; btn.disabled = false; return;
      }
      try { draft = P.autoPlan(state, [...pick.ids], { need, fillRest: $("#fillrest").checked }); } catch (e) { draft = null; }
    }
    lastRequest = await C.sendRequest(session, cloudUser.household, { ...r.data, photo_day: C.dayFolder(), photo_count: photosToday, text: r.text, ...(draft ? { draft } : {}) });
    if (draft) lastRequest.draft = draft;
    $("#reqmsg").textContent = "";
    $("#picknote").value = "";
    pick.ids.clear();
    if (!$("#pickbox").hidden) renderPlan(); else renderRequest();
    needDecided = false; needAuto = true;
    if (draft && commit(M.importBundle(state, draft))) {
      // その場で組んだ献立を、すぐ画面に出す
      renderAll();
      renderRequest();
      C.cachePhotos(session, cloudUser.household, M.photoIds(draft), hydratePhotos).catch(() => {});
      showTab("menu");
      toast(M.sundayPlan(draft).has ? "献立・買い物・レシピを組みました" : "献立と買い物を組みました。日曜の段取りは、あとから届きます");
    } else {
      renderRequest();
      toast("献立を頼みました。これから組むので、すぐには変わりません");
      window.scrollTo(0, 0);
    }
  } catch (e) {
    $("#reqmsg").textContent = e.message;
  }
  btn.disabled = false;
}

async function copyRequest() {
  const text = currentRequest().text;
  try {
    await navigator.clipboard.writeText(text);
    toast("注文をコピーしました。献立を頼むチャットに貼ってください");
  } catch (e) {
    const range = document.createRange();
    range.selectNodeContents($("#reqtext"));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast("文を選んだ状態にしました。コピーしてください");
  }
}

// ---------- 冷蔵庫（ログインと写真の送信） ----------
let cloudUser = null; // { session, household }

async function refreshFridge() {
  let session = null;
  try { session = await C.ensureSession(); } catch (e) { session = C.getSession(); } // 電波なしでも、ログイン済みの見た目は保つ
  if (!session) cloudUser = null;
  else if (!cloudUser || cloudUser.session.user_id !== session.user_id) cloudUser = { session, household: pref("household") || null };
  else cloudUser.session = session;
  $("#fr-login").hidden = !!cloudUser;
  $("#fr-main").hidden = !cloudUser;
  $("#logout").hidden = !cloudUser;
  if (!cloudUser) return;
  try {
    if (!cloudUser.household) cloudUser.household = pref("household", await C.myHousehold(session));
    const n = await C.countToday(session, cloudUser.household);
    $("#fr-count").textContent = n ? `今日は ${n} 枚送っています` : "今日はまだ送っていません";
    $("#tfridge").textContent = n ? n : "";
    photosToday = n;
    renderRequest();
    loadLastRequest(); // ログインの確認が済んでから、いちばん新しい注文を読み直す
  } catch (e) {
    $("#fr-count").textContent = e.message;
  }
  syncFromServer();
}

async function doLogin(e) {
  e.preventDefault();
  const btn = $("#loginbtn");
  btn.disabled = true;
  $("#loginmsg").textContent = "";
  try {
    await C.signIn($("#login-email").value.trim(), $("#login-pass").value);
    $("#login-pass").value = "";
    await refreshFridge();
    toast("ログインしました");
  } catch (err) {
    $("#loginmsg").textContent = err.message;
  }
  btn.disabled = false;
}

async function sendPhotos(files) {
  for (const f of files) {
    const box = document.createElement("div");
    box.className = "shot busy";
    box.innerHTML = `<img alt=""><span>送信中</span>`;
    $("img", box).src = URL.createObjectURL(f);
    $("#shots").prepend(box);
    try {
      const session = await C.ensureSession();
      if (!session) { await refreshFridge(); toast("ログインし直してください"); box.remove(); return; }
      const blob = await C.shrink(f);
      await C.uploadPhoto(session, cloudUser.household, blob);
      box.className = "shot";
      $("span", box).textContent = "送信済み";
    } catch (err) {
      box.className = "shot fail";
      $("span", box).textContent = "送れませんでした";
      toast(err.message);
    }
  }
  refreshFridge();
}

// ---------- 全体 ----------
function renderAll() {
  const w = M.currentWeek(state);
  document.body.classList.toggle("noweek", !w);
  renderSettings();
  if (!w) {
    $("#headline").textContent = "週のデータがまだありません";
    return;
  }
  $("#headline").textContent = `${M.weekSpan(w.week_start)}　${w.memo || ""}`;
  $("#bookline").textContent = w.book ? `作り方は本『${w.book}』の各ページ（P.）を開いてください` : "";
  $("#tnote").textContent = (w.notes || []).length || "";
  renderMenu(w);
  renderShop(w);
  renderCook(w);
  renderNote(w);
  bindRows();
  refreshChecks();
}

// ---------- キャラクターと表紙 ----------
const MASCOT = "icons/mascot.png"; // 絵が無いあいだは、絵の所だけ出さない

function mascotImg(cls) {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = "";
  img.src = MASCOT;
  img.onerror = () => img.remove();
  return img;
}

// 全部済んだときに、数字の横でキャラクターが喜ぶ
function cheer(box, on) {
  let img = $(".mascot", box);
  if (on && !img) box.appendChild(mascotImg("mascot cheer"));
  if (!on && img) img.remove();
}

// 開いたときに、キャラクターとアプリ名の表紙を少しだけ出す（押すとすぐ消える。開き直しのたびには出さない）
function showCover() {
  const c = $("#cover");
  try {
    if (sessionStorage.getItem("mealprep-cover")) return;
    sessionStorage.setItem("mealprep-cover", "1");
  } catch (e) { /* 覚えられなくても、表紙は出す */ }
  c.hidden = false;
  const bye = () => { c.classList.add("bye"); setTimeout(() => { c.hidden = true; }, 500); };
  c.addEventListener("click", bye);
  setTimeout(bye, 1900);
}

function init() {
  showCover();
  $$(".blank").forEach((b) => b.prepend(mascotImg("mascot")));
  $$("nav.tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $$("[data-reset]").forEach((b) => b.addEventListener("click", () => {
    const w = M.currentWeek(state);
    if (!w) return;
    const week = w.week_start;
    const saved = structuredClone(M.home(state).checks[week] || {});
    commit(M.clearChecks(state, week, b.dataset.reset.split(",")));
    refreshChecks();
    toast("チェックを外しました", () => {
      const next = structuredClone(state);
      M.home(next).checks[week] = saved;
      commit(next);
      refreshChecks();
    });
  }));
  $("#logsave").addEventListener("click", saveLog);
  $("#file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (f) takeIn(await f.text());
    e.target.value = "";
  });
  $("#pastego").addEventListener("click", () => takeIn($("#paste").value));
  $("#export").addEventListener("click", download);
  $("#weeksel").addEventListener("change", (e) => switchWeek(e.target.value));
  $("#weekbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-week]");
    if (b) switchWeek(b.dataset.week);
  });
  $("#reqstatus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seeweek]");
    if (!b) return;
    switchWeek(b.dataset.seeweek);
    showTab("menu");
    window.scrollTo(0, 0);
  });
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.go)));
  $("#door-pick").addEventListener("click", () => { $("#pickbox").hidden = false; renderPlan(); $("#pickbox").scrollIntoView({ block: "start", behavior: "smooth" }); });
  $("#reqsend").addEventListener("click", sendRequest);
  bindNeeds();
  $("#kidok").addEventListener("change", (e) => { pick.kidOk = e.target.checked; renderPlan(); });
  $("#fillrest").addEventListener("change", renderRequest);
  $("#picknote").addEventListener("input", renderRequest);
  $("#reqcopy").addEventListener("click", copyRequest);
  $("#reqshare").addEventListener("click", () => navigator.share({ text: currentRequest().text }).catch(() => {}));
  $("#pickclear").addEventListener("click", () => { pick.ids.clear(); renderPlan(); });
  $("#timerstrip").addEventListener("click", (e) => {
    const chip = e.target.closest(".tchip");
    if (chip) openGuide(chip.dataset.dish);
  });
  $("#nowguide").addEventListener("click", (e) => { if (e.currentTarget.dataset.dish) openGuide(e.currentTarget.dataset.dish); });
  $("#nowdone").addEventListener("click", (e) => {
    const key = e.currentTarget.dataset.key;
    const w = M.currentWeek(state);
    if (!key || !w) return;
    commit(M.autoCook(M.toggleCheck(state, w.week_start, key, true), w.week_start, w));
    refreshChecks();
  });
  $("#loginform").addEventListener("submit", doLogin);
  $("#photo").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) sendPhotos(files);
  });
  $("#logout").addEventListener("click", async () => {
    if (!confirm("ログアウトすると、この端末から週の献立・品の一覧・料理の写真の控えを消します（もう一度ログインすれば取り直せます）。買い物や料理のチェックとメモの記録は残ります。")) return;
    await C.signOut();
    cloudUser = null;
    pref("household", "");
    commit(M.forgetServerData(state));
    await C.forgetPhotos();
    location.reload();
  });
  refreshFridge();
  // 閉じずに置いておいたアプリに戻ってきたときにも、新しい献立を受け取る（1 分に 1 回まで）
  let lastSeen = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") keepAwake($("#v-cook").classList.contains("on")); // 戻ってきたら点けたままを掛け直す
    if (document.visibilityState !== "visible" || Date.now() - lastSeen < 60000) return;
    lastSeen = Date.now();
    refreshFridge();
  });
  const cm = $(".covermascot");
  if (cm) mascot(cm);
  const mk = $(".mark img");
  if (mk) mascot(mk, () => mk.parentNode.classList.add("face"));
  renderAll();
  const last = pref("tab") === "fridge" ? "plan" : pref("tab"); // 前の版の「冷蔵庫」は「何つくる？」へ
  showTab(M.currentWeek(state) ? last || "menu" : "set");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    // 新しい版が届いたら、開き直して新しい画面にする。
    // ただし書きかけ・選びかけ・写真の送信中は、開き直すと消えるので、知らせだけ出して、押したら切り替える
    const had = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const reload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
    $("#newver").addEventListener("click", reload);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!had) return;
      if (busy()) $("#newver").hidden = false;
      else reload();
    });
    navigator.serviceWorker.register("./service-worker.js").then((r) => r.update()).catch(() => {});
  }
}

init();

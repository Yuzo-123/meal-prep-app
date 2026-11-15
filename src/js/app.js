// 画面。計算は model.js、保存は store.js。
import * as M from "./model.js";
import { load, save, pref } from "./store.js";
import * as C from "./cloud.js";

export const APP_VERSION = "0.6.1"; // service-worker.js の CACHE と同じ番号にする

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

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("on"), 2600);
}

// ---------- タブ ----------
function showTab(name) {
  $$(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + name));
  $$("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  pref("tab", name);
  window.scrollTo(0, 0);
}

// ---------- 献立 ----------
let dayFilter = "all";

// 献立のカード。押すと「食べた」の印が付く。作りおきは、日曜に作り終えたら「〇曜まで」が出る。
function dishCard(d, w, day, meal) {
  const src = M.photoOf(w, d.id);
  const pic = src ? `<img class="pic" src="${esc(src)}" alt="" loading="lazy">` : "";
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
}

function setDay(d) {
  dayFilter = d;
  pref("day", d);
  $$("#daypills .pill").forEach((p) => p.classList.toggle("on", p.dataset.day === d));
  $$(".day").forEach((s) => { s.hidden = !(d === "all" || s.dataset.day === d); });
}

// ---------- 買い物・日曜（チェックの行） ----------
let aisle = "all";

function rowHtml(r, right) {
  const some = r.some ? `<em>家に ${esc(r.some)} あり</em>` : "";
  return `<label class="row" data-key="${esc(r.key)}" data-aisle="${esc(r.aisle || "")}">
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
  $("#placepills").innerHTML = `<button class="pill" data-place="all">すべて</button>` +
    places.map((p, i) => `<button class="pill pl${i % 6}" data-place="${esc(p)}"><i class="dot"></i>${esc(p)}</button>`).join("") +
    `<button class="pill clear" id="dishclear" hidden></button>`;
  $$("#placepills [data-place]").forEach((p) => p.addEventListener("click", () => { stepPlace = p.dataset.place; refreshChecks(); }));
  $("#dishclear").addEventListener("click", () => { stepDish = null; refreshChecks(); });
  $("#steplist").innerHTML = s.steps.map((x) => checkRow(x.key, `step pl${places.indexOf(x.where) % 6}" data-place="${esc(x.where)}" data-dish="${esc(x.dish || "")}`,
    `<span class="when"><i>${esc(x.at)}</i>${esc(x.where)}</span><b>${esc(x.title)} ${x.page != null ? `<span class="pg">P.${esc(x.page)}</span>` : ""}</b><small class="wr">${esc(x.text)}</small>`)).join("");
  $("#matlist").innerHTML = s.materials.map((x) => checkRow(x.key, "",
    `<b>${esc(x.name)}</b><small>${esc(x.sub)}</small>`, `<span class="amt">${esc(x.amount)}</span>`)).join("");
  $("#matpantry").innerHTML = s.pantry.map((p) => `<span>${esc(p)}</span>`).join("");
  $("#beforelist").innerHTML = s.before.map((x) => checkRow(x.key, "", `<b class="wr">${esc(x.text)}</b>`)).join("");
  $("#cutlist").innerHTML = s.cut.map((x) => checkRow(x.key, "",
    `<b>${esc(x.name)}</b><small class="wr">${esc(x.how)}</small>`, `<span class="amt for">${esc(x.for)}</span>`)).join("");
  $$("#sunpills .pill").forEach((p) => { p.onclick = () => setSun(p.dataset.sun); });
  setSun(s.has ? pref("sun") || "dish" : "dish");
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
      commit(M.toggleCheck(state, M.home(state).current, row.dataset.key, box.checked));
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
    const ok = aisle === "all" ? !pantry : row.dataset.aisle === aisle;
    row.hidden = !ok;
    if (ok && !row.classList.contains("done")) shown++;
  });
  $("#shopempty").hidden = shown > 0;
  const buy = M.progress(state, wk, M.shoppingRows(w).filter((r) => !r.pantry));
  $("#shopleft").textContent = buy.left;
  $("#shoptext").textContent = buy.left ? `品目 残り（全 ${buy.total}）` : "品目 すべてかごに入りました";
  $("#shopbar").style.width = buy.ratio * 100 + "%";
  $("#tshop").textContent = buy.left ? `残り ${buy.left}` : "完了";
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
  $("#nowdone").dataset.key = now ? now.key : "";
  $$("#placepills [data-place]").forEach((p) => p.classList.toggle("on", p.dataset.place === stepPlace));
  const clear = $("#dishclear");
  if (clear) {
    const dish = stepDish ? M.cookRows(w).find((r) => r.key === "cook:" + stepDish) : null;
    clear.hidden = !dish;
    clear.textContent = dish ? `${dish.name} だけ ×` : "";
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
  $("#tcook").textContent = cook.left ? `残り ${cook.left}` : "完了";
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
  $("#weeksel").innerHTML = weeks.map((k) => `<option value="${k}"${k === h.current ? " selected" : ""}>${M.weekSpan(k)} の週</option>`).join("");
  $("#weekbox").hidden = weeks.length < 2;
  $("#version").textContent = APP_VERSION;
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
  $("#pickcount").textContent = `${shown.length} 品を表示中・${pick.ids.size} 品を選択中`;
  $("#picklist").innerHTML = shown.map((d) => {
    const keep = d.kind === "作りおき" ? (d.fridge ? `冷蔵 ${d.fridge}` : "") + (d.freezer_ok ? "・冷凍できる" : "") : d.time_min ? `当日 ${d.time_min} 分` : "当日";
    return `<label class="row${pick.ids.has(d.id) ? " picked" : ""}" data-pick="${esc(d.id)}"><input type="checkbox"${pick.ids.has(d.id) ? " checked" : ""}><span class="box"></span>
      <span class="body"><b>${esc(d.name)}</b><small>${esc([d.section, keep].filter(Boolean).join("・"))}${d.kid_caution ? `<em>取り分け注意</em>` : ""}</small></span>
      <span class="amt pg">P.${esc(d.print_page)}</span></label>`;
  }).join("");
  $$("#picklist .row").forEach((row) => $("input", row).addEventListener("change", (e) => {
    if (e.target.checked) pick.ids.add(row.dataset.pick); else pick.ids.delete(row.dataset.pick);
    $("#pickcount").textContent = `${shown.length} 品を表示中・${pick.ids.size} 品を選択中`;
    renderRequest();
  }));
  renderRequest();
}

function currentRequest() {
  return M.buildRequest(state, [...pick.ids], { kidOk: pick.kidOk, fillRest: $("#fillrest").checked, note: $("#picknote").value });
}

function renderRequest() {
  const r = currentRequest();
  $("#pickweek").textContent = `${M.weekSpan(r.data.week_start)} の週の献立を頼みます`;
  $("#reqtext").textContent = r.text;
  $("#reqshare").hidden = !navigator.share;
}

async function copyRequest() {
  const text = currentRequest().text;
  try {
    await navigator.clipboard.writeText(text);
    toast("注文をコピーしました。lio のチャットに貼ってください");
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
  if (!cloudUser) return;
  try {
    if (!cloudUser.household) cloudUser.household = pref("household", await C.myHousehold(session));
    const n = await C.countToday(session, cloudUser.household);
    $("#fr-count").textContent = n ? `今日は ${n} 枚送っています` : "今日はまだ送っていません";
    $("#tfridge").textContent = n ? `${n} 枚` : "写真";
  } catch (e) {
    $("#fr-count").textContent = e.message;
  }
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
  $("#tnote").textContent = (w.notes || []).length;
  renderMenu(w);
  renderShop(w);
  renderCook(w);
  renderNote(w);
  bindRows();
  refreshChecks();
}

function init() {
  $$("nav.tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $$("[data-reset]").forEach((b) => b.addEventListener("click", () => {
    const w = M.currentWeek(state);
    if (!w) return;
    commit(M.clearChecks(state, w.week_start, b.dataset.reset.split(",")));
    refreshChecks();
  }));
  $("#logsave").addEventListener("click", saveLog);
  $("#file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (f) takeIn(await f.text());
    e.target.value = "";
  });
  $("#pastego").addEventListener("click", () => takeIn($("#paste").value));
  $("#export").addEventListener("click", download);
  $("#weeksel").addEventListener("change", (e) => {
    const next = structuredClone(state);
    M.home(next).current = e.target.value;
    commit(next);
    renderAll();
  });
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.go)));
  $("#door-pick").addEventListener("click", () => { $("#pickbox").hidden = false; $("#door-pick").classList.add("on"); renderPlan(); });
  $("#kidok").addEventListener("change", (e) => { pick.kidOk = e.target.checked; renderPlan(); });
  $("#fillrest").addEventListener("change", renderRequest);
  $("#picknote").addEventListener("input", renderRequest);
  $("#reqcopy").addEventListener("click", copyRequest);
  $("#reqshare").addEventListener("click", () => navigator.share({ text: currentRequest().text }).catch(() => {}));
  $("#pickclear").addEventListener("click", () => { pick.ids.clear(); renderPlan(); });
  $("#nowdone").addEventListener("click", (e) => {
    const key = e.currentTarget.dataset.key;
    const w = M.currentWeek(state);
    if (!key || !w) return;
    commit(M.toggleCheck(state, w.week_start, key, true));
    refreshChecks();
  });
  $("#loginform").addEventListener("submit", doLogin);
  $("#photo").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) sendPhotos(files);
  });
  $("#logout").addEventListener("click", async () => { await C.signOut(); cloudUser = null; pref("household", ""); refreshFridge(); });
  refreshFridge();
  renderAll();
  showTab(M.currentWeek(state) ? pref("tab") || "menu" : "set");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    // 新しい版が届いたら、1 回だけ自動で開き直して新しい画面にする
    const had = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (had && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register("./service-worker.js").then((r) => r.update()).catch(() => {});
  }
}

init();

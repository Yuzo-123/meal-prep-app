// 画面。計算は model.js、保存は store.js。
import * as M from "./model.js";
import { load, save, pref } from "./store.js";

export const APP_VERSION = "0.3.0"; // service-worker.js の CACHE と同じ番号にする

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

function dishCard(d, w) {
  const src = M.photoOf(w, d.id);
  const pic = src ? `<img class="pic" src="${esc(src)}" alt="" loading="lazy">` : "";
  return dishCardBody(d).replace('<article class="card">', `<article class="card${src ? " haspic" : ""}">${pic}`);
}

function dishCardBody(d) {
  if (d.home) {
    return `<article class="card"><div class="tag home"><i></i>家にある</div><h4>${esc(d.name)}</h4></article>`;
  }
  const prep = d.kind === "作りおき";
  const tag = prep ? "作りおき" : d.time_min ? `当日 ${esc(d.time_min)} 分` : "当日";
  const meta = [
    d.print_page != null ? `<span class="pg">P.${esc(d.print_page)}</span>` : "",
    prep && d.fridge ? `<span>冷蔵 ${esc(d.fridge)}</span>` : "",
    d.kid_caution ? `<span class="kid">取り分け注意</span>` : "",
  ].join("");
  return `<article class="card"><div class="tag ${prep ? "prep" : "quick"}"><i></i>${tag}</div><h4>${esc(d.name)}</h4><div class="meta">${meta}</div></article>`;
}

function renderMenu(w) {
  const dates = M.dayDates(w.week_start);
  $("#daypills").innerHTML =
    `<button class="pill" data-day="all">すべて</button>` +
    dates.map((d) => `<button class="pill" data-day="${d.day}">${d.day}<small>${d.date}</small></button>`).join("");
  $("#panels").innerHTML = dates.map((d) => {
    const meals = (w.days || {})[d.day] || {};
    const body = M.MEALS.map((m) =>
      `<div class="mealhead">${m}</div><div class="grid">${(meals[m] || []).map((d) => dishCard(d, w)).join("")}</div>`).join("");
    return `<section class="day" data-day="${d.day}"><h3>${d.day}曜 <small>${d.month}/${d.date}</small></h3>${body}</section>`;
  }).join("");
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
  $("#shoplist").innerHTML = rows.map((r) => rowHtml(r, r.amount ? `<span class="amt">${esc(r.amount)}</span>` : "")).join("");
  $("#skiplist").innerHTML = (w.shopping.skip || []).map((s) => `<li><b>${esc(s.name)}</b><span>${esc(s.where || "")}</span></li>`).join("") || "<li><span>なし</span></li>";
  $$("#shoppills .pill").forEach((p) => p.addEventListener("click", () => { aisle = p.dataset.aisle; refreshChecks(); }));
}

function checkRow(key, cls, body, right = "") {
  return `<label class="row ${cls}" data-key="${esc(key)}"><input type="checkbox"><span class="box"></span><span class="body">${body}</span>${right}</label>`;
}

function renderCook(w) {
  $("#cooklist").innerHTML = M.cookRows(w).map((r) => rowHtml(r, r.page != null ? `<span class="amt pg">P.${esc(r.page)}</span>` : "")).join("");
  const s = M.sundayPlan(w);
  $("#assume").textContent = s.assume;
  $("#steplist").innerHTML = s.steps.map((x) => checkRow(x.key, "step",
    `<span class="when"><i>${esc(x.at)}</i>${esc(x.where)}</span><b>${esc(x.title)} ${x.page != null ? `<span class="pg">P.${esc(x.page)}</span>` : ""}</b><small class="wr">${esc(x.text)}</small>`)).join("");
  $("#matlist").innerHTML = s.materials.map((x) => checkRow(x.key, "",
    `<b>${esc(x.name)}</b><small>${esc(x.sub)}</small>`, `<span class="amt">${esc(x.amount)}</span>`)).join("");
  $("#matpantry").innerHTML = s.pantry.map((p) => `<span>${esc(p)}</span>`).join("");
  $("#beforelist").innerHTML = s.before.map((x) => checkRow(x.key, "", `<b class="wr">${esc(x.text)}</b>`)).join("");
  $("#cutlist").innerHTML = s.cut.map((x) => checkRow(x.key, "",
    `<b>${esc(x.name)}</b><small class="wr">${esc(x.how)}</small>`, `<span class="amt for">${esc(x.for)}</span>`)).join("");
  $$("#sunpills .pill").forEach((p) => { p.onclick = () => setSun(p.dataset.sun); });
  setSun(s.has ? pref("sun") || "steps" : "dish");
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

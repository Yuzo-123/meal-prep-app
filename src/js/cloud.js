// サーバー側（Supabase）とのやりとり。段階 2 の最初の一歩で、いまは「ログイン」と「冷蔵庫の写真を上げる」だけ。
// ここに書いてある鍵は「公開してよい鍵」。写真を守っているのはサーバー側の決まり（supabase/001_fridge_photos.sql）で、
// ログインした家族しか上げられない・見られない。管理用の鍵はこのアプリには入れない。

export const SUPABASE_URL = "https://lhiwkgzlajonpxjuwctb.supabase.co";
export const SUPABASE_KEY = "sb_publishable_KATBqesJxQesNGg4GcvIbw_SgpM0dLo";
export const BUCKET = "fridge";
export const DISH_BUCKET = "dish";
const SESSION_KEY = "mealprep-session-v1";

// ---------- 画面に依らない小さな計算（test/ から呼ぶ） ----------

const p2 = (n) => String(n).padStart(2, "0");

export function dayFolder(now = new Date()) {
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
}

// 置く場所は「<家庭>/<日付>/<写真の指紋>.jpg」。先頭のフォルダ名でサーバー側が家庭を見分ける。
// 名前を写真の中身から決めるので、同じ日に同じ写真を送り直しても 2 枚にならない。
export function photoPath(household, hash, now = new Date()) {
  if (!/^[a-z0-9_-]+$/.test(household || "")) throw new Error("家庭の名前が正しくありません");
  if (!/^[0-9a-f]{8,64}$/.test(hash || "")) throw new Error("写真の名前が正しくありません");
  return `${household}/${dayFolder(now)}/${hash}.jpg`;
}

// 写真の指紋（元のファイルの SHA-256 の先頭 16 文字）
export async function photoHash(file) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 置き場が「もうある」と返したか（Supabase は HTTP 400 の中に statusCode "409"・error "Duplicate" を入れて返す。2026-11-17 に確認）
export function isDuplicate(err) {
  return !!err && (err.status === 409 || String(err.code) === "409" || err.code === "KeyAlreadyExists" || err.error === "Duplicate");
}

// ログインの期限が切れそうか（残り 60 秒を切ったら更新する）
export function needsRefresh(session, nowSec = Math.floor(Date.now() / 1000)) {
  return !session || !session.expires_at || session.expires_at - nowSec < 60;
}

// 長いほうの辺が max を超えないように縮めた大きさ
export function fitSize(w, h, max = 1600) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function keepSession(json) {
  return {
    access_token: json.access_token, refresh_token: json.refresh_token,
    expires_at: json.expires_at || Math.floor(Date.now() / 1000) + (json.expires_in || 3600),
    user_id: json.user ? json.user.id : null, // メールアドレスは端末に残さない
  };
}

// ---------- 端末の中のログイン状態 ----------

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
}

function setSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* 保存できなくても、開いている間は使える */ }
}

// ---------- サーバーへの問い合わせ ----------

async function call(path, { method = "GET", body, token, type = "application/json" } = {}) {
  const headers = { apikey: SUPABASE_KEY };
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = type;
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, { method, headers, body });
  } catch (e) {
    throw new Error("サーバーにつながりません（電波を確かめてください）");
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* 文字のまま */ }
  if (!res.ok) {
    const err = new Error((json && (json.msg || json.message || json.error_description || json.error)) || "HTTP " + res.status);
    err.status = res.status;
    if (json) { err.code = json.statusCode || json.code; err.error = json.error; }
    throw err;
  }
  return json;
}

export async function signIn(email, password) {
  let json;
  try {
    json = await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  } catch (e) {
    if (e.status === 400 || e.status === 401) throw new Error("メールアドレスかパスワードが違います");
    throw e;
  }
  const s = keepSession(json);
  setSession(s);
  return s;
}

// 使える状態のログインを返す。期限が近ければ更新し、更新できなければ null（ログインし直し）。
export async function ensureSession() {
  let s = getSession();
  if (!s) return null;
  if (!needsRefresh(s)) return s;
  try {
    const json = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }) });
    s = keepSession(json);
    setSession(s);
    return s;
  } catch (e) {
    // 断られた（400・401＝更新の札が古い・取り消された）ときだけ、ログインし直し。
    // サーバーの不調（5xx など）や電波が無いだけなら、ログイン状態は消さない
    if (e.status === 400 || e.status === 401) { setSession(null); return null; }
    throw e;
  }
}

export async function signOut() {
  const s = getSession();
  setSession(null);
  if (s) { try { await call("/auth/v1/logout", { method: "POST", token: s.access_token }); } catch (e) { /* 端末側は消えている */ } }
}

export async function myHousehold(session) {
  const rows = await call("/rest/v1/household_members?select=household", { token: session.access_token });
  if (!rows || !rows.length) throw new Error("この人はまだ家庭に登録されていません");
  return rows[0].household;
}

// ---------- 献立・品の一覧・料理の写真を受け取る ----------

// 先に週ごとの印（updated_at）だけを取り、前に受け取ったものと変わった週だけ中身を取りに行く。
// known は { 週の始まり: 前に受け取ったときの updated_at }。戻り値は中身つきの行（変わった週だけ）。
export async function fetchWeeks(session, household, known = {}, limit = 3) {
  const hh = encodeURIComponent(household);
  const stamps = (await call(`/rest/v1/weeks?select=week_start,updated_at&household=eq.${hh}&order=week_start.desc&limit=${limit}`,
    { token: session.access_token })) || [];
  const stale = stamps.filter((r) => known[r.week_start] !== r.updated_at).map((r) => r.week_start);
  if (!stale.length) return [];
  return (await call(`/rest/v1/weeks?select=week_start,updated_at,bundle&household=eq.${hh}&week_start=in.(${stale.map(encodeURIComponent).join(",")})`,
    { token: session.access_token })) || [];
}

// 品の一覧も同じ。印が前と同じなら中身（約 800 KB）は取らず null を返す。
export async function fetchCatalog(session, household, knownUpdatedAt = null) {
  const hh = encodeURIComponent(household);
  const stamp = await call(`/rest/v1/catalogs?select=updated_at&household=eq.${hh}`, { token: session.access_token });
  if (!stamp || !stamp.length || (knownUpdatedAt && stamp[0].updated_at === knownUpdatedAt)) return null;
  const rows = await call(`/rest/v1/catalogs?select=updated_at,data&household=eq.${hh}`, { token: session.access_token });
  return rows && rows.length ? rows[0] : null;
}

// ---------- 献立を頼む（注文をサーバーに置く。組むのは Mac 側） ----------

// id は画面が注文を作ったときに 1 回だけ決める番号。返事だけ落ちて送り直しても、同じ番号なら 2 件目は入らない。
export async function sendRequest(session, household, data, id = crypto.randomUUID()) {
  const { week_start, ...payload } = data;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/requests?on_conflict=id`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json",
      Prefer: "return=representation,resolution=ignore-duplicates" },
    body: JSON.stringify({ id, household, week_start, payload }),
  }).catch(() => { throw new Error("サーバーにつながりません（電波を確かめてください）"); });
  if (!res.ok) throw new Error(res.status === 404 ? "頼む仕組みが、まだサーバーに入っていません" : "頼めませんでした（HTTP " + res.status + "）");
  const rows = await res.json();
  if (rows && rows.length) return rows[0];
  // もう届いていた（前の送信が入っていた）。その注文を読み直して返す
  const again = await call(`/rest/v1/requests?select=*&id=eq.${encodeURIComponent(id)}`, { token: session.access_token });
  if (!again || !again.length) throw new Error("頼めたか確かめられませんでした。少し待ってから、もう一度押してください");
  return again[0];
}

export async function latestRequest(session, household) {
  const rows = await call(`/rest/v1/requests?select=id,created_at,week_start,status,status_note,draft:payload->draft&household=eq.${encodeURIComponent(household)}&order=created_at.desc&limit=1`,
    { token: session.access_token });
  return rows && rows.length ? rows[0] : null;
}

// 料理の写真は、端末にも写しを持つ（電波なしでも出るように）。鍵は品の番号。
const PHOTO_CACHE = "mealprep-dish-photos";
const photoKey = (id) => `./__dish/${encodeURIComponent(id)}.jpg`;

// ログアウトのとき、料理の写真の控えを消す（もう一度ログインすれば取り直せる）
export async function forgetPhotos() {
  try { await caches.delete(PHOTO_CACHE); } catch (e) { /* 控えが使えない端末では何もしない */ }
}

export async function cachedPhotoUrl(id) {
  if (!("caches" in globalThis)) return null;
  const hit = await (await caches.open(PHOTO_CACHE)).match(photoKey(id));
  return hit ? URL.createObjectURL(await hit.blob()) : null;
}

// サーバーに写真がある品の番号の一覧
export async function listPhotoIds(session, household) {
  const rows = await call(`/storage/v1/object/list/${DISH_BUCKET}`, {
    method: "POST", token: session.access_token, body: JSON.stringify({ prefix: household, limit: 1000 }),
  });
  return (rows || []).map((r) => r.name).filter((n) => n && n.endsWith(".jpg")).map((n) => n.slice(0, -4));
}

// まだ端末に無い写真だけを取りに行く。戻り値は新しく入った枚数。
// 4 枚ずつ同時に取りに行き、1 組入るたびに onBatch を呼ぶ（届いた順に画面へ出せるように）。
export async function cachePhotos(session, household, ids, onBatch) {
  if (!("caches" in globalThis)) return 0;
  const cache = await caches.open(PHOTO_CACHE);
  const missing = [];
  for (const id of ids) if (!(await cache.match(photoKey(id)))) missing.push(id);
  let added = 0;
  const one = async (id) => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${DISH_BUCKET}/${household}/${encodeURIComponent(id)}.jpg`,
      { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token } });
    if (!res.ok) return 0; // その品の写真がまだ無いだけ
    await cache.put(photoKey(id), new Response(await res.blob(), { headers: { "Content-Type": "image/jpeg" } }));
    return 1;
  };
  for (let i = 0; i < missing.length; i += 4) {
    let got;
    try { got = await Promise.all(missing.slice(i, i + 4).map(one)); } catch (e) { break; } // 電波が切れたら、次に開いたときに続きを取る
    const n = got.reduce((a, b) => a + b, 0);
    added += n;
    if (n && onBatch) onBatch();
  }
  return added;
}

// 写真を縮めて JPEG にする（スマホの写真は 1 枚数 MB あるので、送る前に小さくする）
export async function shrink(file, max = 1600, quality = 0.8) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (e) {
    src = await new Promise((ok, ng) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => ng(new Error("この写真は読めませんでした（この端末で開けない形式です）"));
      img.src = URL.createObjectURL(file);
    });
  }
  const { w, h } = fitSize(src.width, src.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(src, 0, 0, w, h);
  const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", quality));
  if (!blob) throw new Error("この写真は読めませんでした（この端末で開けない形式です）");
  return blob;
}

// path は写真を選んだときに photoPath で 1 回だけ決める。「もうある」と返されたら、前の送信が届いていたので成功とする。
export async function uploadPhoto(session, path, blob) {
  try {
    await call(`/storage/v1/object/${BUCKET}/${path}`, { method: "POST", token: session.access_token, body: blob, type: "image/jpeg" });
  } catch (e) {
    if (!isDuplicate(e)) throw e;
  }
  return path;
}

export async function countToday(session, household) {
  const rows = await call(`/storage/v1/object/list/${BUCKET}`, {
    method: "POST", token: session.access_token,
    body: JSON.stringify({ prefix: `${household}/${dayFolder()}`, limit: 100 }),
  });
  return (rows || []).filter((r) => r.name && r.name.endsWith(".jpg")).length;
}

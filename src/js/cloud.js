// サーバー側（Supabase）とのやりとり。段階 2 の最初の一歩で、いまは「ログイン」と「冷蔵庫の写真を上げる」だけ。
// ここに書いてある鍵は「公開してよい鍵」。写真を守っているのはサーバー側の決まり（supabase/001_fridge_photos.sql）で、
// ログインした家族しか上げられない・見られない。管理用の鍵はこのアプリには入れない。

export const SUPABASE_URL = "https://lhiwkgzlajonpxjuwctb.supabase.co";
export const SUPABASE_KEY = "sb_publishable_KATBqesJxQesNGg4GcvIbw_SgpM0dLo";
export const BUCKET = "fridge";
const SESSION_KEY = "mealprep-session-v1";

// ---------- 画面に依らない小さな計算（test/ から呼ぶ） ----------

const p2 = (n) => String(n).padStart(2, "0");

export function dayFolder(now = new Date()) {
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
}

// 置く場所は「<家庭>/<日付>/<時刻>-<乱数>.jpg」。先頭のフォルダ名でサーバー側が家庭を見分ける。
export function photoPath(household, now = new Date(), id = Math.random().toString(36).slice(2, 8)) {
  if (!/^[a-z0-9_-]+$/.test(household || "")) throw new Error("家庭の名前が正しくありません");
  return `${household}/${dayFolder(now)}/${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}-${id}.jpg`;
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
    if (e.status) { setSession(null); return null; } // サーバーに断られた＝ログインし直し
    throw e; // 電波が無いだけなら、ログイン状態は消さない
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

export async function uploadPhoto(session, household, blob) {
  const path = photoPath(household);
  await call(`/storage/v1/object/${BUCKET}/${path}`, { method: "POST", token: session.access_token, body: blob, type: "image/jpeg" });
  return path;
}

export async function countToday(session, household) {
  const rows = await call(`/storage/v1/object/list/${BUCKET}`, {
    method: "POST", token: session.access_token,
    body: JSON.stringify({ prefix: `${household}/${dayFolder()}`, limit: 100 }),
  });
  return (rows || []).filter((r) => r.name && r.name.endsWith(".jpg")).length;
}

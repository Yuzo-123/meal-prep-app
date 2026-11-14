// 端末の中への保存。段階 1 はここだけ（サーバーへは何も送らない）。
import { emptyState, SCHEMA } from "./model.js";

const KEY = "mealprep-state-v1";

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && s.schema === SCHEMA && s.households) return s;
  } catch (e) { /* 壊れていたら空から始める */ }
  return emptyState();
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

// 画面ごとの小さな覚え書き（開いていたタブなど）。消えても困らないもの。
export function pref(name, value) {
  try {
    if (value === undefined) return localStorage.getItem("mealprep-pref-" + name);
    localStorage.setItem("mealprep-pref-" + name, value);
  } catch (e) { /* 無くても動く */ }
  return value;
}

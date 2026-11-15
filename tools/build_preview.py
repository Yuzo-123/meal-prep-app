#!/usr/bin/python3
"""いま手元にあるアプリを、確認用の 1 ページ（アーティファクト用）に組み立てる。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/build_preview.py <plan.json のある週のフォルダ> --out <書き出し先のフォルダ>

書き出すもの: index.html（画面と見た目を 1 枚に）、src/js/（アプリの中身そのまま）、icons/mascot.png、seed.json（週の献立と品の一覧）。
seed.json には料理の写真を入れない（写真は、家族 2 人だけが入れる非公開の置き場にだけ置く決まり）。
書き出し先は、このフォルダ（公開の置き場）の外にする。家の献立が入るため。
確認用のページでは、ログインとサーバーからの受け取り、ホーム画面への追加は使えない。
"""
import datetime
import json
import os
import re
import shutil
import sys

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(os.path.dirname(APP), "meal-prep", "02_outputs", "app_catalog.json")

BANNER_CSS = """
.previewbar{font-size:12px;line-height:1.5;color:var(--sub);background:var(--surface);border-radius:12px;padding:8px 12px;margin:8px 0 4px}
.previewbar b{color:var(--on)}
#loginform label,#loginform .formfoot{display:none}
"""

LOADER = """<script type="module">
// 確認用: 週の献立と品の一覧を先に入れてから、アプリを動かす。チェックの印は残す。
import * as M from "./src/js/model.js";
const KEY = "mealprep-state-v1", STAMP = "%(stamp)s";
try {
  if (localStorage.getItem("mealprep-preview-seed") !== STAMP) {
    const seed = await (await fetch("seed.json")).json();
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    if (!s || s.schema !== M.SCHEMA || !s.households) s = M.emptyState();
    s = M.importBundle(s, seed.week);
    if (seed.catalog) s = M.importCatalog(s, seed.catalog);
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.setItem("mealprep-preview-seed", STAMP);
  }
} catch (e) { console.warn("確認用のデータを入れられませんでした", e); }
await import("./src/js/app.js");
</script>"""


def main():
    if len(sys.argv) != 4 or sys.argv[2] != "--out":
        print(__doc__)
        sys.exit(1)
    week_dir = sys.argv[1]
    out = os.path.abspath(sys.argv[3])
    if out.startswith(APP + os.sep):
        sys.exit("書き出し先は、アプリのフォルダ（公開の置き場）の外にしてください")
    week = json.load(open(os.path.join(week_dir, "app_week.json"), encoding="utf-8"))
    week.pop("photos", None)
    catalog = json.load(open(CATALOG, encoding="utf-8")) if os.path.exists(CATALOG) else None

    html = open(os.path.join(APP, "index.html"), encoding="utf-8").read()
    css = open(os.path.join(APP, "src", "css", "styles.css"), encoding="utf-8").read()
    appjs = open(os.path.join(APP, "src", "js", "app.js"), encoding="utf-8").read()
    version = re.search(r'APP_VERSION = "([^"]+)"', appjs).group(1)
    now = datetime.datetime.now()
    body = html.split("<body>", 1)[1].rsplit("</body>", 1)[0]
    script = '<script type="module" src="src/js/app.js"></script>'
    if body.count(script) != 1 or body.count('<div class="wrap">') != 1:
        sys.exit("index.html の形が変わっています（組み立ての目印が見つからない）")
    banner = ('<p class="previewbar"><b>確認用</b> 版 %s・%s に組み立て・%s の週・料理の写真なし。'
              'ログインと受け取りは、ここでは使えません。</p>' % (version, now.strftime("%m/%d %H:%M"), week["week_start"]))
    body = body.replace('<div class="wrap">', '<div class="wrap">\n' + banner, 1)
    login_hint = "冷蔵庫の写真を送るには、家族のログインが要ります。最初の 1 回だけです。"
    if body.count(login_hint) != 1:
        sys.exit("index.html の形が変わっています（ログインの案内が見つからない）")
    body = body.replace(login_hint, "この確認用のページでは、ログインできません（外のサーバーとつながらない作りのため）。"
                        "ログイン・冷蔵庫の写真を送る・献立を頼む・料理の写真は、iPhone のアプリで確かめてください。", 1)
    body = body.replace(script, LOADER % {"stamp": now.strftime("%Y%m%d%H%M%S")})
    page = "<title>日曜につくりおき 確認用</title>\n<style>\n%s\n%s</style>\n%s" % (css, BANNER_CSS, body)

    os.makedirs(os.path.join(out, "src", "js"), exist_ok=True)
    os.makedirs(os.path.join(out, "icons"), exist_ok=True)
    open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(page)
    for name in sorted(os.listdir(os.path.join(APP, "src", "js"))):
        shutil.copy(os.path.join(APP, "src", "js", name), os.path.join(out, "src", "js", name))
    shutil.copy(os.path.join(APP, "icons", "mascot.png"), os.path.join(out, "icons", "mascot.png"))
    json.dump({"week": week, "catalog": catalog}, open(os.path.join(out, "seed.json"), "w", encoding="utf-8"), ensure_ascii=False)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
    print("組み立てました: 版 %s / %s の週 / 合計 %.0f KB / %s" % (version, week["week_start"], size / 1024, out))


if __name__ == "__main__":
    main()

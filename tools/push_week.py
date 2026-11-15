#!/usr/bin/python3
"""組み終えた 1 週間ぶんを、サーバー側へ送る（アプリは開くだけで受け取れる）。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/push_week.py projects/meal-prep/02_outputs/weeks/<月曜の日付>/plan.json [--dry-run] [--no-photos]
  /usr/bin/python3 projects/meal-prep-app/tools/push_week.py --catalog          品の一覧だけを送る

先に week.py build と export_week.py を流しておく（同じフォルダの app_week.json を読む）。
送るもの: 週の献立（料理名・ページ番号・日持ち・買い物リスト・日曜の段取り）と、その週に出る料理の写真。
送らないもの: 材料の分量を含む作り方の本文、ページ全体の画像。
料理の写真は本から切り出したもの。家族 2 人だけが入れる非公開の置き場に置く（2026-11-15 に Yuzo が決定。
アプリを売ると決めたら、その時点でサーバーから消す）。
管理用の鍵は macOS のキーチェーン（lio-supabase-mealprep）から読む。
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

URL = "https://lhiwkgzlajonpxjuwctb.supabase.co"
HOUSEHOLD = "home"
HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # projects/
CATALOG = os.path.join(HERE, "meal-prep", "02_outputs", "app_catalog.json")


def secret():
    r = subprocess.run(["security", "find-generic-password", "-a", "lio", "-s", "lio-supabase-mealprep", "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("キーチェーンに管理用の鍵がありません（保管場所の名前: lio-supabase-mealprep）")
    return r.stdout.strip()


def call(method, path, body, ctype="application/json", extra=None):
    key = secret()
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": ctype}
    headers.update(extra or {})
    req = urllib.request.Request(URL + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        sys.exit("サーバーに断られました: %s %s → HTTP %d %s" % (method, path.split("?")[0], e.code, e.read().decode("utf-8", "replace")[:200]))


def upsert(table, row, key):
    call("POST", "/rest/v1/%s?on_conflict=%s" % (table, key), json.dumps([row], ensure_ascii=False).encode("utf-8"),
         extra={"Prefer": "resolution=merge-duplicates,return=minimal"})


def push_catalog(dry):
    cat = json.load(open(CATALOG, encoding="utf-8"))
    print("品の一覧: %d 品" % len(cat["dishes"]))
    if not dry:
        upsert("catalogs", {"household": HOUSEHOLD, "data": cat, "updated_at": "now()"}, "household")
        print("送りました: 品の一覧")


def push_week(plan_path, dry, with_photos):
    week_dir = os.path.dirname(os.path.abspath(plan_path))
    src = os.path.join(week_dir, "app_week.json")
    if not os.path.exists(src):
        sys.exit("app_week.json がありません。先に export_week.py を流してください: " + src)
    bundle = json.load(open(src, encoding="utf-8"))
    photos = bundle.pop("photos", {}) or {}  # 写真は献立の行には入れず、写真の置き場へ別に送る
    bundle["photo_ids"] = sorted(photos) if with_photos else []
    size = len(json.dumps(bundle, ensure_ascii=False).encode("utf-8"))
    print("週の献立: %s の週 / %.0f KB / 写真 %d 枚" % (bundle["week_start"], size / 1024, len(bundle["photo_ids"])))
    if dry:
        print("（試しなので、何も送っていません）")
        return
    upsert("weeks", {"household": HOUSEHOLD, "week_start": bundle["week_start"], "bundle": bundle, "updated_at": "now()"},
           "household,week_start")
    print("送りました: 週の献立")
    if with_photos:
        for rid in bundle["photo_ids"]:
            data = base64.b64decode(photos[rid].split(",", 1)[1])
            call("POST", "/storage/v1/object/dish/%s/%s.jpg" % (HOUSEHOLD, rid), data, "image/jpeg", {"x-upsert": "true"})
        print("送りました: 料理の写真 %d 枚" % len(bundle["photo_ids"]))


def push_all_photos(dry):
    """本から切り出してある料理の写真を全部送る（品の一覧に写真を出すため）。すでに同じ名前があれば置き換える。"""
    photo_dir = os.path.join(os.path.dirname(HERE), "biz-dev", "library", "book-yaseru-tsukurioki-330", "pages", "_photos")
    names = sorted(n for n in os.listdir(photo_dir) if n.endswith(".jpg"))
    total = sum(os.path.getsize(os.path.join(photo_dir, n)) for n in names)
    print("料理の写真: %d 枚 / 合計 %.1f MB" % (len(names), total / 1e6))
    if dry:
        print("（試しなので、何も送っていません）")
        return
    for i, n in enumerate(names, 1):
        data = open(os.path.join(photo_dir, n), "rb").read()
        call("POST", "/storage/v1/object/dish/%s/%s" % (HOUSEHOLD, n), data, "image/jpeg", {"x-upsert": "true"})
        if i % 50 == 0:
            print("  %d 枚まで送りました" % i)
    print("送りました: 料理の写真 %d 枚" % len(names))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if "--all-photos" in sys.argv:
        push_all_photos(dry)
    if "--catalog" in sys.argv:
        push_catalog(dry)
    if args:
        push_week(args[0], dry, "--no-photos" not in sys.argv)
    if not args and "--catalog" not in sys.argv and "--all-photos" not in sys.argv:
        print(__doc__)


if __name__ == "__main__":
    main()

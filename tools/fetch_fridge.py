#!/usr/bin/python3
"""アプリから送られた冷蔵庫の写真を、Mac に取り込む・サーバーから消す。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/fetch_fridge.py list             いまサーバーにある写真の一覧
  /usr/bin/python3 projects/meal-prep-app/tools/fetch_fridge.py fetch            projects/meal-prep/01_inputs/<日付>/ へ取り込む
  /usr/bin/python3 projects/meal-prep-app/tools/fetch_fridge.py delete --days 0  取り込み済みで、指定した日数より古い写真をサーバーから消す

管理用の鍵は macOS のキーチェーン（保管場所の名前 lio-supabase-mealprep・アカウント名 lio）から読む。
鍵はどのファイルにも書かないし、画面にも出さない。
消すのは「Mac に取り込み済みと確かめられた写真」だけ（取り込み前の写真は、日数を過ぎていても消さない）。
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

URL = "https://lhiwkgzlajonpxjuwctb.supabase.co"
BUCKET = "fridge"
HOUSEHOLD = "home"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # projects/
INPUTS = os.path.join(ROOT, "meal-prep", "01_inputs")


def secret():
    r = subprocess.run(["security", "find-generic-password", "-a", "lio", "-s", "lio-supabase-mealprep", "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("キーチェーンに管理用の鍵がありません（保管場所の名前: lio-supabase-mealprep）")
    return r.stdout.strip()


def call(method, path, body=None, raw=False):
    key = secret()
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(URL + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        sys.exit("サーバーに断られました: HTTP %d %s" % (e.code, e.read().decode("utf-8", "replace")[:200]))
    return data if raw else (json.loads(data) if data else None)


def listing():
    """[(日付, ファイル名, 大きさ), ...]"""
    out = []
    days = call("POST", "/storage/v1/object/list/%s" % BUCKET, {"prefix": HOUSEHOLD, "limit": 1000})
    for d in days or []:
        if d.get("id"):  # フォルダではなくファイル
            continue
        files = call("POST", "/storage/v1/object/list/%s" % BUCKET, {"prefix": "%s/%s" % (HOUSEHOLD, d["name"]), "limit": 1000})
        for f in files or []:
            if f.get("id") and f["name"].endswith(".jpg"):
                out.append((d["name"], f["name"], (f.get("metadata") or {}).get("size", 0)))
    return sorted(out)


def local_path(day, name):
    return os.path.join(INPUTS, day, "fridge_app_" + name)


def main():
    global INPUTS
    if "--to" in sys.argv:  # 取り込み先を変える（試し用）
        INPUTS = os.path.abspath(sys.argv[sys.argv.index("--to") + 1])
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    items = listing()
    if cmd == "list":
        for day, name, size in items:
            print("%s %s %.0f KB %s" % (day, name, size / 1024, "取り込み済み" if os.path.exists(local_path(day, name)) else "未取り込み"))
        print("サーバーにある写真: %d 枚 / 合計 %.2f MB" % (len(items), sum(s for _, _, s in items) / 1e6))
    elif cmd == "fetch":
        new = 0
        for day, name, size in items:
            dst = local_path(day, name)
            if os.path.exists(dst):
                continue
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            data = call("GET", "/storage/v1/object/%s/%s/%s/%s" % (BUCKET, HOUSEHOLD, day, name), raw=True)
            with open(dst, "wb") as f:
                f.write(data)
            new += 1
            print("取り込み:", dst)
        print("新しく取り込んだ写真: %d 枚（サーバーには %d 枚）" % (new, len(items)))
    elif cmd == "delete":
        import datetime
        days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 7
        limit = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
        targets = [(d, n) for d, n, _ in items if d <= limit and os.path.exists(local_path(d, n))]
        kept = [(d, n) for d, n, _ in items if d <= limit and not os.path.exists(local_path(d, n))]
        if targets:
            call("DELETE", "/storage/v1/object/%s" % BUCKET, {"prefixes": ["%s/%s/%s" % (HOUSEHOLD, d, n) for d, n in targets]})
        print("サーバーから消した写真: %d 枚（%s 以前・取り込み済みのもの）" % (len(targets), limit))
        if kept:
            print("消さずに残した写真: %d 枚（まだ Mac に取り込んでいないため）" % len(kept))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

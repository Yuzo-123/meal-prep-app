#!/usr/bin/python3
"""アプリから届いた「献立を頼む」の注文を、Mac 側で読む・状態を書き換える。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/requests.py list                 まだ手を付けていない注文の一覧
  /usr/bin/python3 projects/meal-prep-app/tools/requests.py show <注文の番号>     注文の中身（選んだ品・ひとこと・写真の日付）
  /usr/bin/python3 projects/meal-prep-app/tools/requests.py set <注文の番号> working|done|failed [一言]

献立を組む流れ（組む側の手順）:
  1. list で注文を見つけ、set <番号> working で「組んでいます」にする
  2. 写真があれば fetch_fridge.py fetch で取り込み、選ばれた品とあわせて献立を組む（week.py）
  3. export_week.py → push_week.py で送り、set <番号> done で「届きました」にする
  4. うまく組めなかったら set <番号> failed "理由" にする（アプリにその一言が出る）
番号は先頭の 8 文字だけで指定できる。管理用の鍵は macOS のキーチェーン（lio-supabase-mealprep）から読む。
"""
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = "https://lhiwkgzlajonpxjuwctb.supabase.co"
HOUSEHOLD = "home"
STATUS = {"new": "まだ", "working": "組んでいます", "done": "届きました", "failed": "組めませんでした", "cancelled": "取り消し"}


def secret():
    r = subprocess.run(["security", "find-generic-password", "-a", "lio", "-s", "lio-supabase-mealprep", "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("キーチェーンに管理用の鍵がありません（保管場所の名前: lio-supabase-mealprep）")
    return r.stdout.strip()


def call(method, path, body=None):
    key = secret()
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "return=representation"}
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        sys.exit("サーバーに断られました: HTTP %d %s" % (e.code, e.read().decode("utf-8", "replace")[:200]))


def rows(extra=""):
    return call("GET", "/rest/v1/requests?select=id,created_at,week_start,status,status_note,payload&household=eq.%s&order=created_at.desc%s"
                % (HOUSEHOLD, extra))


def find(prefix):
    hit = [r for r in rows("&limit=50") if r["id"].startswith(prefix)]
    if len(hit) != 1:
        sys.exit("注文が %d 件見つかりました（1 件に絞れる番号を渡してください）" % len(hit))
    return hit[0]


def line(r):
    p = r["payload"]
    return "%s %s %s の週 / 選んだ品 %d / 写真 %s 枚 / %s" % (
        r["id"][:8], r["created_at"][:16].replace("T", " "), r["week_start"], len(p.get("picks", [])),
        p.get("photo_count", 0), STATUS.get(r["status"], r["status"]))


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd == "list":
        new = rows("&status=eq.new")
        for r in new:
            print(line(r))
        print("まだ手を付けていない注文: %d 件" % len(new))
    elif cmd == "show" and len(sys.argv) > 2:
        r = find(sys.argv[2])
        print(line(r))
        print(json.dumps(r["payload"], ensure_ascii=False, indent=1))
    elif cmd == "set" and len(sys.argv) > 3 and sys.argv[3] in ("working", "done", "failed", "cancelled"):
        r = find(sys.argv[2])
        note = sys.argv[4] if len(sys.argv) > 4 else None
        call("PATCH", "/rest/v1/requests?id=eq.%s" % urllib.parse.quote(r["id"]),
             {"status": sys.argv[3], "status_note": note, "updated_at": "now()"})
        print("書き換えました: %s → %s" % (r["id"][:8], STATUS[sys.argv[3]]))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

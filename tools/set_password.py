#!/usr/bin/python3
"""登録済みの利用者にパスワードを決めて、ログインできる状態（確認済み）にする。

使い方（ターミナルで、Yuzo 自身が実行する）:
  /usr/bin/python3 projects/meal-prep-app/tools/set_password.py

・利用者の一覧が出る（メールアドレスは一部を伏せて表示）
・番号を選び、パスワードを 2 回入力する。入力した文字は画面に出ない
・パスワードはこの道具からサーバーへ直接送られるだけで、ファイルにも記録にも残らない
・管理用の鍵は macOS のキーチェーン（lio-supabase-mealprep）から読む
"""
import getpass
import json
import subprocess
import sys
import urllib.error
import urllib.request

URL = "https://lhiwkgzlajonpxjuwctb.supabase.co"


def secret():
    r = subprocess.run(["security", "find-generic-password", "-a", "lio", "-s", "lio-supabase-mealprep", "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("キーチェーンに管理用の鍵がありません（保管場所の名前: lio-supabase-mealprep）")
    return r.stdout.strip()


def call(method, path, body=None):
    key = secret()
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("msg", "")
        except Exception:
            msg = ""
        sys.exit("サーバーに断られました: HTTP %d %s" % (e.code, msg))


def mask(email):
    name, _, domain = (email or "").partition("@")
    return "%s…@%s…" % (name[:2], domain[:2])


def main():
    users = call("GET", "/auth/v1/admin/users?per_page=50").get("users", [])
    if not users:
        sys.exit("利用者がいません")
    print("登録されている利用者:")
    for i, u in enumerate(users, 1):
        state = "ログインできる" if u.get("email_confirmed_at") else "まだログインできない"
        print("  %d. %s（%s）" % (i, mask(u.get("email")), state))
    pick = input("パスワードを決める人の番号を入れて Enter（やめるときは何も入れずに Enter）: ").strip()
    if not pick:
        return
    if not pick.isdigit() or not 1 <= int(pick) <= len(users):
        sys.exit("番号が正しくありません")
    user = users[int(pick) - 1]
    p1 = getpass.getpass("新しいパスワード（10 文字以上。入力は画面に出ません）: ")
    p2 = getpass.getpass("もう一度: ")
    if p1 != p2:
        sys.exit("2 回の入力が違います。やり直してください")
    if len(p1) < 10:
        sys.exit("10 文字以上にしてください")
    call("PUT", "/auth/v1/admin/users/" + user["id"], {"password": p1, "email_confirm": True})
    print("できました: %s はこのパスワードでログインできます" % mask(user.get("email")))


if __name__ == "__main__":
    main()

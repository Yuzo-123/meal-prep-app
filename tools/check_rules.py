#!/usr/bin/python3
"""Supabase の「誰が読めるか」の決まりが効いているかを、ログインしていない立場で実際に試す。

使い方: /usr/bin/python3 projects/meal-prep-app/tools/check_rules.py
使うのは公開してよい鍵だけ（アプリのファイルに書くものと同じ）。管理用の鍵は使わない。
全部「断られる・何も返らない」なら合格。1 つでも通ったら、決まりに穴がある。
"""
import json
import sys
import urllib.error
import urllib.request

URL = "https://lhiwkgzlajonpxjuwctb.supabase.co"
KEY = "sb_publishable_KATBqesJxQesNGg4GcvIbw_SgpM0dLo"  # 公開してよい鍵


def call(method, path, body=None, ctype="application/json"):
    req = urllib.request.Request(URL + path, data=body, method=method,
                                 headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main():
    results = []

    code, text = call("POST", "/storage/v1/object/fridge/home/_rule_check/anon.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")
    results.append(("ログインなしで写真を上げる", code >= 400, "HTTP %d" % code))

    code, text = call("POST", "/storage/v1/object/list/fridge", json.dumps({"prefix": "home", "limit": 10}).encode())
    empty = code >= 400 or text.strip() in ("[]", "")
    results.append(("ログインなしで写真の一覧を見る", empty, "HTTP %d・%s" % (code, "0 件" if text.strip() == "[]" else text[:60])))

    code, text = call("GET", "/storage/v1/object/fridge/home/_rule_check/anon.jpg")
    results.append(("ログインなしで写真を開く", code >= 400, "HTTP %d" % code))

    code, text = call("GET", "/storage/v1/object/public/fridge/home/_rule_check/anon.jpg")
    results.append(("公開用の URL で写真を開く", code >= 400, "HTTP %d" % code))

    code, text = call("GET", "/rest/v1/household_members?select=*")
    empty = code >= 400 or text.strip() == "[]"
    results.append(("ログインなしで家庭の名簿を読む", empty, "HTTP %d・%s" % (code, "0 件" if text.strip() == "[]" else text[:60])))

    code, text = call("POST", "/rest/v1/household_members", json.dumps({"user_id": "00000000-0000-0000-0000-000000000000"}).encode())
    results.append(("ログインなしで家庭の名簿に書く", code >= 400, "HTTP %d" % code))

    for table in ("weeks", "catalogs"):
        code, text = call("GET", "/rest/v1/%s?select=*&limit=1" % table)
        empty = code >= 400 or text.strip() == "[]"
        results.append(("ログインなしで %s の表を読む" % table, empty, "HTTP %d・%s" % (code, "0 件" if text.strip() == "[]" else text[:40])))
    code, text = call("POST", "/rest/v1/weeks", json.dumps({"household": "home", "week_start": "2000-01-03", "bundle": {}}).encode())
    results.append(("ログインなしで週の献立を書く", code >= 400, "HTTP %d" % code))
    code, text = call("POST", "/storage/v1/object/list/dish", json.dumps({"prefix": "home", "limit": 10}).encode())
    empty = code >= 400 or text.strip() in ("[]", "")
    results.append(("ログインなしで料理の写真の一覧を見る", empty, "HTTP %d・%s" % (code, "0 件" if text.strip() == "[]" else text[:40])))
    code, text = call("GET", "/storage/v1/object/dish/home/r046.jpg")
    results.append(("ログインなしで料理の写真を開く", code >= 400, "HTTP %d" % code))
    code, text = call("POST", "/storage/v1/object/dish/home/_rule_check.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")
    results.append(("ログインなしで料理の写真を上げる", code >= 400, "HTTP %d" % code))

    code, text = call("GET", "/rest/v1/requests?select=*&limit=1")
    empty = code >= 400 or text.strip() == "[]"
    results.append(("ログインなしで注文を読む", empty, "HTTP %d・%s" % (code, "0 件" if text.strip() == "[]" else text[:40])))
    code, text = call("POST", "/rest/v1/requests", json.dumps({"household": "home", "week_start": "2000-01-03", "payload": {}}).encode())
    results.append(("ログインなしで献立を頼む", code >= 400, "HTTP %d" % code))
    # 注文の取り消し（005）。ログインなしでは 1 件も書き換わらないこと（空の返事か、断られる）
    req = urllib.request.Request(URL + "/rest/v1/requests?status=eq.new", method="PATCH",
                                 data=json.dumps({"status": "cancelled"}).encode(),
                                 headers={"apikey": KEY, "Authorization": "Bearer " + KEY,
                                          "Content-Type": "application/json", "Prefer": "return=representation"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            code, text = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code, text = e.code, e.read().decode("utf-8", "replace")
    results.append(("ログインなしで注文を取り消す", code >= 400 or text.strip() == "[]", "HTTP %d・%s" % (code, "0 件" if text.strip() == "[]" else text[:40])))

    ok = True
    for name, passed, detail in results:
        ok = ok and passed
        print("%s %s（%s）" % ("○ 断られた" if passed else "× 通ってしまった", name, detail))
    print("判定:", "合格（ログインなしでは何もできない）" if ok else "不合格（決まりに穴がある）")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

#!/usr/bin/python3
"""コミットの前に、版の上げ忘れを止める（コミット前のチェックから呼ばれる）。

画面のファイル（html・js・css・アイコン・manifest・service-worker）を変えたコミットでは、
src/js/app.js の APP_VERSION と service-worker.js の CACHE を、同じ番号で、前のコミットより新しくしていること。
上げ忘れると、端末は控えにある古い画面を出し続ける（これまでに 2 回あった）。
"""
import re
import subprocess
import sys

SCREEN = ("index.html", "manifest.json", "service-worker.js", "src/", "icons/")


def git(*args):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def versions(ref):
    app = git("show", "%s:src/js/app.js" % ref)
    sw = git("show", "%s:service-worker.js" % ref)
    if app is None or sw is None:
        return None, None
    a = re.search(r'APP_VERSION = "([\d.]+)"', app)
    s = re.search(r"mealprep-([\d.]+)", sw)
    return (a.group(1) if a else None), (s.group(1) if s else None)


def as_tuple(v):
    return tuple(int(x) for x in v.split("."))


def main():
    staged = (git("diff", "--cached", "--name-only") or "").split()
    if not any(f.startswith(SCREEN) for f in staged):
        return 0
    app, sw = versions("")  # ":<path>" はコミットに載せる中身
    if not app or app != sw:
        print("■ コミットを止めました: 版の番号がそろっていません（app.js %s・service-worker.js %s）" % (app, sw))
        return 1
    old, _ = versions("HEAD")
    if old and as_tuple(app) <= as_tuple(old):
        print("■ コミットを止めました: 画面のファイルを変えたのに、版が %s のままです。" % app)
        print("  src/js/app.js の APP_VERSION と service-worker.js の CACHE を、同じ番号で上げてください")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

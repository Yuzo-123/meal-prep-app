#!/usr/bin/python3
"""本のページの絵から、料理の写真の位置を自動で見つけて切り出す。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/crop_dish_photos.py --pages <ページの絵のフォルダ> --index <recipe_index.json> --out <書き出し先>
      [--sheet <確認用の一覧の絵の書き出し先のフォルダ>] [--force] [--report <結果の json>]

やり方:
  1. ページの絵を 4 分の 1 に縮め、「白くない所」が四角くまとまっている部分を写真とみなす
  2. 1 ページの中で、上から順（同じ高さなら左から）に並べ、索引の品の番号の順に当てはめる
  3. 写真の数と品の数が合わないページは、切り出さずに「要確認」として報告する
切り出した写真は幅 480 に縮める。すでにある写真は、--force を付けないかぎり上書きしない（手で決めた切り出しを守る）。
書き出し先は本のフォルダの中（この Mac の中だけ）。このフォルダ（アプリ）には写真を置かない。
"""
import collections
import json
import os
import sys

import numpy as np
from PIL import Image

SCALE = 4     # 位置を探すときに縮める倍率
WIDTH = 480   # 書き出す写真の幅


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def find_photos(im):
    """ページの絵から、写真らしい四角の一覧（元の大きさの座標で 左, 上, 右, 下）を返す。"""
    w, h = im.size
    small = np.asarray(im.resize((w // SCALE, h // SCALE), Image.BOX).convert("RGB")).astype(np.int16)
    lum = small.mean(axis=2)
    sat = small.max(axis=2) - small.min(axis=2)
    mask = (lum < 215) | (sat > 40)  # 白い紙と薄い字を除いた「色のある所」
    H, W = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    boxes = []
    for y0 in range(H):
        for x0 in np.flatnonzero(mask[y0] & ~seen[y0]):
            if seen[y0, x0]:
                continue
            stack = [(y0, x0)]
            seen[y0, x0] = True
            xs, ys, n = [x0, x0], [y0, y0], 0
            while stack:
                y, x = stack.pop()
                n += 1
                if x < xs[0]: xs[0] = x
                if x > xs[1]: xs[1] = x
                if y < ys[0]: ys[0] = y
                if y > ys[1]: ys[1] = y
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True
                        stack.append((yy, xx))
            bw, bh = xs[1] - xs[0] + 1, ys[1] - ys[0] + 1
            if bw < 70 or bh < 45:             # 小さすぎる（札・印・見出し）
                continue
            if n / (bw * bh) < 0.72:           # 四角く詰まっていない（しま模様の帯・字のかたまり）
                continue
            if bw > 0.8 * W and bh < 40:       # 横いっぱいの細い帯
                continue
            boxes.append((xs[0], ys[0], xs[1] + 1, ys[1] + 1, n))
    out = []
    for l, t, r, b, _ in boxes:
        sub = mask[t:b, l:r]
        rows = np.flatnonzero(sub.mean(axis=1) > 0.6)   # まわりに付いた札や字の出っぱりを落とす
        cols = np.flatnonzero(sub.mean(axis=0) > 0.6)
        if len(rows) < 40 or len(cols) < 60:
            continue
        out.append(((l + cols[0]) * SCALE, (t + rows[0]) * SCALE, (l + cols[-1] + 1) * SCALE, (t + rows[-1] + 1) * SCALE))
    out.sort(key=lambda bx: (round(bx[1] / 200), bx[0]))  # 上から順。ほぼ同じ高さなら左から
    return out


def longest_run(flags, min_len):
    """True が続くいちばん長い区間（始まり, 終わり）。min_len より短ければ None。"""
    best, start = None, None
    for i, f in enumerate(list(flags) + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if best is None or i - start > best[1] - best[0]:
                best = (start, i)
            start = None
    return best if best and best[1] - best[0] >= min_len else None


def all_runs(flags, min_len):
    """True が続く区間のうち、min_len 以上のものを全部（始まり, 終わり）で返す。"""
    out, start = [], None
    for i, f in enumerate(list(flags) + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    return out


def find_photo_column(im, n):
    """この本のページの作り（写真が左か右の 1 列に、品の数だけ縦に並ぶ）を使って写真を見つける。

    1 列の中で「紙の白でなく、模様のある所」が続く幅を写真の列とみなし、その列の中で縦に続く範囲を、品の数で等分する。
    色だけの札（かんたん・レンチンなどの見出し）は模様が無いので、列から外れる。
    """
    w, h = im.size
    small = np.asarray(im.resize((w // SCALE, h // SCALE), Image.BOX).convert("RGB")).astype(np.int16)
    lum = small.mean(axis=2)
    sat = small.max(axis=2) - small.min(axis=2)
    ink = (lum < 246) | (sat > 14)                      # 紙の白ではない所（白っぽい写真も拾う）
    H, W = ink.shape
    top, bottom = int(H * 0.25), int(H * 0.86)          # 画面の中で、本のページが写っている高さ
    body = ink[top:bottom]
    texture = np.abs(np.diff(lum[top:bottom], axis=0)).mean(axis=0)  # 縦にたどったときの明るさの変わり方
    cols = (body.mean(axis=0) > 0.78) & (texture > 3.5)
    run = longest_run(cols, 50)
    if not run:
        return []
    x0, x1 = run
    rows = ink[:, x0:x1].mean(axis=1) > 0.75
    runs = all_runs(rows, 100)                           # 写真 1 枚ぶんの高さ（およそ 180）に足りる区間だけ
    inset = 2
    spans = []
    if len(runs) == n:                                   # 写真の数だけ、縦に区間が見つかった
        spans = runs
    elif len(runs) == 1 and runs[0][1] - runs[0][0] >= 150 * n:   # 2 枚がすきまなく続いている → 等分する
        y0, y1 = runs[0]
        step = (y1 - y0) / n
        spans = [(int(y0 + step * i), int(y0 + step * (i + 1))) for i in range(n)]
    elif len(runs) == 1 and n == 2:                      # 片方だけ見つかった（もう片方は白っぽい写真）→ 同じ高さで上か下に置く
        y0, y1 = runs[0]
        height = y1 - y0
        middle = (top + bottom) / 2
        other = (y1, min(H, y1 + height)) if (y0 + y1) / 2 < middle else (max(0, y0 - height), y0)
        spans = sorted([runs[0], other])
    boxes = []
    for a, b in spans:
        # 横幅は写真ごとに決め直す。列の見当（x0〜x1）から、色のある所が続くかぎり左右へ広げる
        filled = ink[a:b].mean(axis=0) > 0.7
        l, r = x0, x1
        while l > 0 and filled[l - 1]:
            l -= 1
        while r < W and filled[r]:
            r += 1
        boxes.append(((l + inset) * SCALE, (a + inset) * SCALE, (r - inset) * SCALE, (b - inset) * SCALE))
    return boxes


def main():
    pages, index, out = arg("--pages"), arg("--index"), arg("--out")
    if not (pages and index and out):
        print(__doc__)
        sys.exit(1)
    force = "--force" in sys.argv
    recipes = json.load(open(index, encoding="utf-8"))
    by_page = collections.OrderedDict()
    for r in recipes:
        by_page.setdefault(r["page_file"], []).append(r)
    os.makedirs(out, exist_ok=True)
    report = {"ok": [], "kept": [], "mismatch": []}
    made = []
    for page, rs in by_page.items():
        path = os.path.join(pages, page + ".png")
        if not os.path.exists(path):
            report["mismatch"].append({"page": page, "ids": [r["id"] for r in rs], "found": 0, "why": "ページの絵が無い"})
            continue
        im = Image.open(path).convert("RGB")
        boxes = find_photo_column(im, len(rs)) if len(rs) == 2 else []   # ほとんどのページは 2 品が縦に並ぶ
        if len(boxes) != len(rs):
            boxes = find_photos(im)                                      # 作りの違うページは、かたまりで探す
        if len(boxes) != len(rs):
            report["mismatch"].append({"page": page, "ids": [r["id"] for r in rs], "found": len(boxes), "boxes": boxes})
            continue
        for r, box in zip(rs, boxes):
            dst = os.path.join(out, r["id"] + ".jpg")
            if os.path.exists(dst) and not force:
                report["kept"].append(r["id"])
                continue
            crop = im.crop(box)
            crop = crop.resize((WIDTH, round(crop.height * WIDTH / crop.width)), Image.LANCZOS)
            crop.save(dst, quality=78)
            report["ok"].append(r["id"])
            made.append((r["id"], r["name"], dst))
    sheet_dir = arg("--sheet")
    if sheet_dir and made:  # 確認用の一覧（1 枚に 24 品）
        os.makedirs(sheet_dir, exist_ok=True)
        for n in range(0, len(made), 24):
            sheet = Image.new("RGB", (6 * 200, 4 * 170), "white")
            for i, (rid, _, dst) in enumerate(made[n:n + 24]):
                t = Image.open(dst)
                t.thumbnail((196, 166))
                sheet.paste(t, ((i % 6) * 200 + 2, (i // 6) * 170 + 2))
            sheet.save(os.path.join(sheet_dir, "sheet_%02d.jpg" % (n // 24 + 1)), quality=70)
    if arg("--report"):
        json.dump(report, open(arg("--report"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=lambda o: int(o))
    print("切り出した: %d 品 / すでにあったので残した: %d 品 / 要確認: %d ページ（%d 品）"
          % (len(report["ok"]), len(report["kept"]), len(report["mismatch"]), sum(len(m["ids"]) for m in report["mismatch"])))


if __name__ == "__main__":
    main()

#!/usr/bin/python3
"""ホーム画面用のアイコン（192・512）を作る。黒い角丸に白い「作」。
使い方: /usr/bin/python3 projects/meal-prep-app/tools/make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = ["/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
         "/System/Library/Fonts/Hiragino Sans GB.ttc"]


def main():
    font_path = next(p for p in FONTS if os.path.exists(p))
    for size in (192, 512):
        img = Image.new("RGB", (size, size), "#111111")  # iPhone が自分で角を丸めるので四角のまま塗る
        d = ImageDraw.Draw(img)
        font = ImageFont.truetype(font_path, int(size * 0.56))
        box = d.textbbox((0, 0), "作", font=font)
        x = (size - (box[2] - box[0])) / 2 - box[0]
        y = (size - (box[3] - box[1])) / 2 - box[1]
        d.text((x, y), "作", font=font, fill="#ffffff")
        out = os.path.join(HERE, "icons", "icon-%d.png" % size)
        img.save(out)
        print("書き出し:", out)


if __name__ == "__main__":
    main()

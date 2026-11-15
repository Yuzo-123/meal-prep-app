#!/usr/bin/python3
"""ホーム画面用のアイコンの派生を、icons/icon-512.png から作る。
使い方: /usr/bin/python3 projects/meal-prep-app/tools/make_icon_variants.py

- icons/icon-maskable-512.png: Android が丸や角丸に切り抜いても顔が欠けないよう、絵を 90% に縮めて下にそろえ、
  まわりを同じ地の色で塗ったもの（大事な部分を、中央の直径 80% の円に収める）
- icons/icon-180.png: iPhone のホーム画面用（apple-touch-icon）
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(HERE, "icons")
SCALE = 0.9


def main():
    src = Image.open(os.path.join(ICONS, "icon-512.png")).convert("RGB")
    bg = src.getpixel((2, 2))
    n = int(512 * SCALE)
    small = src.resize((n, n), Image.LANCZOS)
    out = Image.new("RGB", (512, 512), bg)
    out.paste(small, ((512 - n) // 2, 512 - n))  # 下にそろえる（絵の下の切れ目を見せない）
    out.save(os.path.join(ICONS, "icon-maskable-512.png"), optimize=True)
    src.resize((180, 180), Image.LANCZOS).save(os.path.join(ICONS, "icon-180.png"), optimize=True)
    print("書き出し: icon-maskable-512.png / icon-180.png")


if __name__ == "__main__":
    main()

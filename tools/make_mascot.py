#!/usr/bin/python3
"""キャラクターの絵（背景が透明な PNG）から、アプリで使う絵とアイコンを作る。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/make_mascot.py <もとの絵.png>

作るもの:
  icons/mascot.png      画面に置くキャラクター（余白を落として、高さ 520 に縮めたもの）
  icons/icon-192.png    ホーム画面のアイコン（生成りの地に、顔と手もとを大きく）
  icons/icon-512.png    同上の大きいもの
もとの絵はこのフォルダには置かない（置くのは縮めたものだけ）。
"""
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = (251, 232, 214, 255)  # アイコンの地（やわらかい肌色がかった生成り）


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    src = Image.open(sys.argv[1]).convert("RGBA")
    body = src.crop(src.getchannel("A").getbbox())  # 透明な余白を落とす

    mascot = body.resize((round(body.width * 520 / body.height), 520), Image.LANCZOS)
    out = os.path.join(HERE, "icons", "mascot.png")
    mascot.save(out, optimize=True)
    print("書き出し: icons/mascot.png %s %.0f KB" % (mascot.size, os.path.getsize(out) / 1024))

    # アイコン: 上から 88% ぶん（顔・スプーン・茶碗・よだれかけ）を、正方形の地に大きく置く。
    # 横幅いっぱいに近づけ、縦はまんなかより少し下に（切れ目が下の縁に来るように）
    top = body.crop((0, 0, body.width, round(body.height * 0.88)))
    side = top.width
    for size in (192, 512):
        canvas = Image.new("RGBA", (side, side), BG)
        scale = 1.04
        fit = top.resize((round(top.width * scale), round(top.height * scale)), Image.LANCZOS)
        canvas.alpha_composite(fit, ((side - fit.width) // 2, side - fit.height))
        icon = canvas.resize((size, size), Image.LANCZOS).convert("RGB")
        path = os.path.join(HERE, "icons", "icon-%d.png" % size)
        icon.save(path, optimize=True)
        print("書き出し: icons/icon-%d.png %.0f KB" % (size, os.path.getsize(path) / 1024))


if __name__ == "__main__":
    main()

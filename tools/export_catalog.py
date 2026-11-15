#!/usr/bin/python3
"""「カテゴリから選ぶ」で使う品の一覧を、アプリに取り込める 1 つのファイルにまとめる。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/export_catalog.py

読むもの: projects/meal-prep/data/recipe_index.json（料理名・区分・ページ番号・日持ち。材料と作り方は入っていない）
書くもの: projects/meal-prep/02_outputs/app_catalog.json（本の品名の一覧なので、アプリのフォルダには置かない）
レシピの本を足したり入れ替えたりしたら、流し直してアプリに取り込み直す。
"""
import datetime
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # projects/
SRC = os.path.join(HERE, "meal-prep", "data", "recipe_index.json")
OUT = os.path.join(HERE, "meal-prep", "02_outputs", "app_catalog.json")
BOOK = "やせる！作りおき&帰って10分おかず330"


def main():
    rows = json.load(open(SRC, encoding="utf-8"))
    dishes = [{
        "id": r["id"], "name": r["name"], "kind": r["kind"], "group": r["group"], "section": r.get("section"),
        "print_page": r["print_page"], "fridge": r["fridge"], "fridge_days": r.get("fridge_days"),
        "freezer_ok": r["freezer_ok"], "time_min": r["time_min"], "kid_caution": bool(r["kid_caution"]),
    } for r in rows]
    cat = {"format": "mealprep-catalog", "version": 1, "household": "home", "book": BOOK,
           "exported_at": datetime.datetime.now().isoformat(timespec="seconds"), "dishes": dishes}
    json.dump(cat, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("書き出し: %s / %d 品 / %.0f KB" % (OUT, len(dishes), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()

#!/usr/bin/python3
"""「カテゴリから選ぶ」と「アプリの中で献立を組む」で使う品の一覧を、アプリに取り込める 1 つのファイルにまとめる。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/export_catalog.py

読むもの: projects/meal-prep/data/recipe_index.json（料理名・区分・ページ番号・日持ち）
          projects/meal-prep/scripts/week.py 経由で、本のデータ（材料の名前と分量だけ。作り方は読まない）
書くもの: projects/meal-prep/02_outputs/app_catalog.json（本の品名と材料の一覧なので、アプリのフォルダには置かない）
レシピの本を足したり入れ替えたりしたら、流し直してサーバーへ送り直す（push_week.py --catalog）。

材料の名前と分量を入れるのは、2026-11-15 に Yuzo が決めた例外（GUARDRAILS §4「書籍原文の例外 2」）。
家族 2 人だけが入れる非公開の置き場にだけ置く。本の作り方の文は入れない。
詳しい手順（lio が自分の言葉で言い直したもの。projects/meal-prep/02_outputs/guides/）も入れる（同じく「例外 3」）。

品ごとの材料は、短く持つために配列で書く: [名前, 分量の文字, 分子, 分母, 単位, 調味料なら 1, 売り場の番号]
（分量が数として読めないときは、分子・分母・単位が null）
"""
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # projects/
SRC = os.path.join(HERE, "meal-prep", "data", "recipe_index.json")
OUT = os.path.join(HERE, "meal-prep", "02_outputs", "app_catalog.json")
GUIDES = os.path.join(HERE, "meal-prep", "02_outputs", "guides")  # lio が言い直した詳しい手順（make_guides.py が書く）
GUIDE_KEYS = ("amounts", "line", "where", "active_min", "total_min", "before", "cut", "steps", "after")
BOOK = "やせる！作りおき&帰って10分おかず330"

sys.path.insert(0, os.path.join(HERE, "meal-prep", "scripts"))
import week as week_tool  # noqa: E402  買い物リストと同じ決まり（調味料の見分け・売り場・分量の読み方）を使う

AISLES = ["肉", "魚介", "野菜・きのこ・果物", "卵・乳製品・大豆", "缶詰・乾物・その他"]


def ing_rows(recipe):
    rows = []
    for i in recipe.get("ingredients", []):
        name = re.sub(r"[（(].*?[）)]", "", i["name"]).strip() or i["name"]
        amount = i.get("amount") or ""
        if amount == "お好みで":
            continue
        pantry = 1 if week_tool.is_pantry(name) else 0
        pa = None if pantry else week_tool.parse_amount(amount)
        rows.append([name, amount, pa[0].numerator if pa else None, pa[0].denominator if pa else None,
                     pa[1] if pa else None, pantry, AISLES.index(week_tool.aisle(name))])
    return rows


def main():
    rows = json.load(open(SRC, encoding="utf-8"))
    full = week_tool.load()
    dishes = []
    for r in rows:
        f = full.get(r["id"], {})
        gp = os.path.join(GUIDES, r["id"] + ".json")
        guide = None
        if os.path.exists(gp):
            g = json.load(open(gp, encoding="utf-8"))
            guide = {k: g[k] for k in GUIDE_KEYS if k in g}
        dishes.append({
            "guide": guide,
            "id": r["id"], "name": r["name"], "kind": r["kind"], "group": r["group"], "section": r.get("section"),
            "print_page": r["print_page"], "fridge": r["fridge"], "fridge_days": r.get("fridge_days"),
            "freezer": r.get("freezer"), "freezer_ok": r["freezer_ok"], "time_min": r["time_min"],
            "kid_caution": bool(r["kid_caution"]),
            "servings_n": f.get("servings_n") if f.get("per") == "1人分" else None,
            "unsure": bool(f.get("has_uncertain")),
            "ing": ing_rows(f),
        })
    cat = {"format": "mealprep-catalog", "version": 1, "household": "home", "book": BOOK, "aisles": AISLES,
           "exported_at": datetime.datetime.now().isoformat(timespec="seconds"), "dishes": dishes}
    json.dump(cat, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n = sum(1 for d in dishes if d["ing"])
    g = sum(1 for d in dishes if d["guide"])
    print("書き出し: %s / %d 品（材料つき %d 品・詳しい手順つき %d 品）/ %.0f KB" % (OUT, len(dishes), n, g, os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()

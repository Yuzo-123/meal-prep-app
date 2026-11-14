#!/usr/bin/python3
"""lio が組んだ 1 週間ぶんを、アプリに取り込める 1 つのファイルにまとめる。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/export_week.py projects/meal-prep/02_outputs/weeks/<月曜の日付>/plan.json

読むもの: plan.json、同じフォルダの shopping.json（week.py build が書く）、projects/meal-prep/data/recipe_index.json
書くもの: plan.json と同じフォルダの app_week.json（家の献立なので、アプリのフォルダには置かない）

載せるのは料理名・本のページ番号・日持ち・買い物リスト・メモまで。
本の材料・分量・作り方は読まないし、書き出さない（recipe_index.json にはそもそも入っていない）。
"""
import datetime
import json
import os
import sys

DAYS = ["月", "火", "水", "木", "金"]
BOOK = "やせる！作りおき&帰って10分おかず330"


def dish(rid, R):
    if rid.startswith("x:"):
        return {"id": rid, "name": rid[2:], "home": True}
    r = R[rid]
    return {"id": rid, "name": r["name"], "kind": r["kind"], "print_page": r["print_page"],
            "fridge": r["fridge"], "freezer": r["freezer"], "freezer_ok": r["freezer_ok"],
            "time_min": r["time_min"], "kid_caution": bool(r["kid_caution"])}


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    plan_path = os.path.abspath(sys.argv[1])
    week_dir = os.path.dirname(plan_path)
    root = os.path.dirname(os.path.dirname(os.path.dirname(week_dir)))  # projects/meal-prep
    plan = json.load(open(plan_path, encoding="utf-8"))
    shop_path = os.path.join(week_dir, "shopping.json")
    if not os.path.exists(shop_path):
        sys.exit("shopping.json がありません。先に week.py build を回してください: " + shop_path)
    shop = json.load(open(shop_path, encoding="utf-8"))
    R = {r["id"]: r for r in json.load(open(os.path.join(root, "data", "recipe_index.json"), encoding="utf-8"))}

    days = {}
    for d in DAYS:
        meals = plan.get("days", {}).get(d, {})
        days[d] = {m: [dish(x, R) for x in meals.get(m, [])] for m in ("朝", "夜")}
    cook = []
    for c in plan.get("cook_sunday", []):
        one = dish(c["id"], R)
        one["batches"] = c.get("batches", 1)
        cook.append(one)

    def row(it, keys):
        return {k: it[k] for k in keys if k in it}

    bundle = {
        "format": "mealprep-week", "version": 1, "household": "home",
        "week_start": plan["week_start"], "memo": plan.get("memo", ""), "people": plan.get("people"),
        "book": BOOK, "days": days, "cook_sunday": cook,
        "shopping": {
            "buy": [row(b, ("name", "amount", "aisle", "for", "some")) for b in shop.get("buy", [])],
            "pantry": shop.get("pantry", []),
            "skip": [row(s, ("name", "where")) for s in shop.get("skip", [])],
        },
        "notes": shop.get("notes", []),
        "exported_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    out = os.path.join(week_dir, "app_week.json")
    json.dump(bundle, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    n = sum(len(v["朝"]) + len(v["夜"]) for v in days.values())
    print("書き出し: %s / 献立 %d 品 / 日曜に作る %d 品 / 買うもの %d 品目" % (out, n, len(cook), len(bundle["shopping"]["buy"])))


if __name__ == "__main__":
    main()

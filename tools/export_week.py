#!/usr/bin/python3
"""lio が組んだ 1 週間ぶんを、アプリに取り込める 1 つのファイルにまとめる。

使い方:
  /usr/bin/python3 projects/meal-prep-app/tools/export_week.py projects/meal-prep/02_outputs/weeks/<月曜の日付>/plan.json [--no-photos]

読むもの: plan.json、同じフォルダの shopping.json（week.py build が書く）、projects/meal-prep/data/recipe_index.json、
          料理の写真 biz-dev/library/book-yaseru-tsukurioki-330/pages/_photos/<レシピ id>.jpg（ある品だけ）
書くもの: plan.json と同じフォルダの app_week.json（家の献立と本の写真が入るので、アプリのフォルダには置かない。
          親のリポジトリでも Git に入れない）

載せるのは料理名・本のページ番号・日持ち・買い物リスト・メモ・料理の写真まで。
本の材料・分量・作り方は読まないし、書き出さない（recipe_index.json にはそもそも入っていない）。
写真入りのファイルは家族の端末へ渡すだけにして、公開の場所やサーバーには置かない。
"""
import base64
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
            "fridge": r["fridge"], "fridge_days": r.get("fridge_days"), "freezer": r["freezer"], "freezer_ok": r["freezer_ok"],
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
    # 料理の写真（本から切り出したもの）。公開の場所には置かず、この取り込みファイルに入れて
    # 家族の端末の中だけに残す（2026-11-14 に Yuzo が決定）。同じ品が何度出ても 1 枚だけ持つ。
    photos = {}
    if "--no-photos" not in sys.argv:
        workspace = os.path.dirname(os.path.dirname(root))
        photo_dir = os.path.join(workspace, "biz-dev", "library", "book-yaseru-tsukurioki-330", "pages", "_photos")
        ids = [x["id"] for v in days.values() for m in v.values() for x in m] + [c["id"] for c in cook]
        for rid in dict.fromkeys(ids):
            p = os.path.join(photo_dir, rid + ".jpg")
            if os.path.exists(p):
                photos[rid] = "data:image/jpeg;base64," + base64.b64encode(open(p, "rb").read()).decode("ascii")
    bundle["photos"] = photos

    # 日曜の段取り（手順・下準備は lio が自分の言葉で plan.json に書いたもの。材料は日曜に作る品のぶんを集計）。
    # 集計は projects/meal-prep/scripts/week.py の道具を借りる（本の全データを読むのは Mac の中だけ。
    # 書き出すのは買い物リストと同じく材料名と合計量まで）。
    sun = plan.get("sunday") or {}
    if sun:
        steps = []
        for s in sun.get("steps", []):
            r = R.get(s.get("id"))
            steps.append({"id": s.get("id"), "at": s.get("at", ""), "where": s.get("where", ""), "do": s.get("do", ""),
                          "title": s.get("title") or (r["name"] if r else ""),
                          "print_page": r["print_page"] if r else None})
        materials = {"items": [], "pantry": []}
        try:
            sys.path.insert(0, os.path.join(root, "scripts"))
            import week as week_tool
            items, pantry, _ = week_tool.shopping({"cook_sunday": plan.get("cook_sunday", []), "days": {}}, week_tool.load())
            materials = {"items": [row(i, ("name", "amount", "for")) for i in items], "pantry": pantry}
        except Exception as e:  # 道具が変わっていても、手順と下準備だけは出す
            print("注意: 日曜の材料を集計できませんでした（%s）。手順と下準備だけ書き出します" % e)
        bundle["sunday"] = {"assume": sun.get("assume", ""), "before": sun.get("before", []),
                            "cut": [row(c, ("what", "how", "for")) for c in sun.get("cut", [])],
                            "steps": steps, "materials": materials}

    out = os.path.join(week_dir, "app_week.json")
    json.dump(bundle, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    n = sum(len(v["朝"]) + len(v["夜"]) for v in days.values())
    print("書き出し: %s / 献立 %d 品 / 日曜に作る %d 品 / 買うもの %d 品目 / 写真 %d 枚 / ファイル %.2f MB"
          % (out, n, len(cook), len(bundle["shopping"]["buy"]), len(photos), os.path.getsize(out) / 1e6))


if __name__ == "__main__":
    main()

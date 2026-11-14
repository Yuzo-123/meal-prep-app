# 作り置きアプリ（meal-prep-app）

家族用の PWA。1 週間の作り置きの献立・買い物リスト・日曜に作る品をスマホで見る。
献立を選ぶのは lio（`projects/meal-prep/`）。このアプリは結果を見る・チェックする・記録する画面。

- 設計メモ: `projects/meal-prep/03_notes/2026-11-14-app-design.md`
- はじめての人向けの手順: `projects/meal-prep/03_notes/2026-11-14-pwa-first-steps.md`
- 別 git 管理（`projects/diet-app/` と同じ型）。親のリポジトリでは追跡しない

## いまの段階: 1（2026-11-14 着手）

できること: 週のデータを取り込む／献立（月〜金・今日を自動で開く）／買い物（売り場別・チェック・残り数）／日曜（作る品のチェック）／メモと今週の記録／書き出しと読み戻し／電波なしで開く。
まだ無いもの: 2 人の同期、写真、ひとこと、在庫、食費、生協（段階 2 以降）。

## 守ること

- **家のデータをこのフォルダに入れない**。画面のファイルはネットに置くと誰でも開ける。献立・チェック・記録は端末の中だけ
- **本の材料・分量・作り方を入れない**。載せるのは料理名・ページ番号・日持ち・買い物リスト・メモまで
- 鍵や合言葉を画面側のファイルに書かない
- 画面を直したら `src/js/app.js` の `APP_VERSION` と `service-worker.js` の `CACHE` を一緒に上げる（テストがそろっているか確かめる）

## 毎週の流れ

1. lio が `projects/meal-prep/` で献立を組み、`week.py build` まで回す
2. `/usr/bin/python3 projects/meal-prep-app/tools/export_week.py projects/meal-prep/02_outputs/weeks/<月曜の日付>/plan.json` → 同じフォルダに `app_week.json`
3. `app_week.json` をスマホへ送り（AirDrop など）、アプリの「設定 → ファイルを選ぶ」で取り込む

## 手元で動かす

- 確認用サーバー: ワークスペースの `.claude/launch.json` の `meal-prep-app`（ポート 8765）
- テスト: このフォルダで `node --test`

## 中身

| 場所 | 役割 |
|---|---|
| `index.html` | 画面の骨組み |
| `src/js/model.js` | データの形と計算（画面に依らない。テストの対象） |
| `src/js/store.js` | 端末の中への保存 |
| `src/js/app.js` | 画面の動き |
| `src/css/styles.css` | 見た目（共有ページと同じ調子） |
| `service-worker.js` `manifest.json` `icons/` | ホーム画面に置く・電波なしで開くための仕掛け |
| `tools/export_week.py` | 週のデータの書き出し |
| `tools/make_icons.py` | アイコンづくり |
| `test/` | テスト |

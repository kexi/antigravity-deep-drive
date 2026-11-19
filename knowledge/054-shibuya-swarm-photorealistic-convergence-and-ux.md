---
title: 渋谷エリア並列 /swarm 収束改修：3Dランドマーク・PLATEAU/GIS境界・道路街区連続性・URL/ギアUX・E2E検証
tags:
  - architecture
  - graphics
  - open-data
  - roads
  - physics
  - ui
trust_signals:
  verified_date: 2026-11-18
  author: verifier
  reviewed_by: just verify-all (25 files / 214 tests) + Playwright UI-OFF 12-view Shibuya visual inspection + Blender 360-degree renders
---

# 054: 渋谷エリア並列 /swarm 収束改修：3Dランドマーク・PLATEAU/GIS境界・道路街区連続性・URL/ギアUX・E2E検証

## 1. 背景と目的

[053-shibuya-ibl-dem-r246-plateau-360-audit.md](./053-shibuya-ibl-dem-r246-plateau-360-audit.md) の後に実施した UI OFF 実画面監査およびユーザー実機プレイ報告から特定された残存課題を、担当領域を分離した並列 `/swarm` 体制（`landmarks-3d` / `plateau-gis` / `city-roads` / `vehicle-url-ux` / `verifier`）で一括解消し、コード品質・単体テスト・実ブラウザ 3D 描画のすべてを収束させた。

主な解決対象は以下の 5 点：

1. **主要 3D ランドマーク造形・UV 密度**: SHIBUYA 109 の `1 0 9` エンブレム背後を貫通していた縦ガラススリット、QFRONT 1F 店舗の暗色壁化、渋谷ストリーム稲荷橋大階段のブロック感、首都高 3 号渋谷線高架のディテール・標識比率。
2. **宮益坂上〜青山通り境界 (`x < -345`) と外苑東通り侵入壁**: `x >= -550` で WGS84 座標・DEM5A 標高が丸の内/大手町へ急落ジャンプする問題、最寄り PLATEAU ビルに千代田区側（読売新聞東京本社ビル等）が誤マッチする問題、および `X:-376, Z:-11`（外苑東通り）右車線へ大手町プレイス (`13101-bldg-5103`) ポディウム壁・`PlateauTile_data150` 建物が食い込む問題。
3. **道路標示・街区連続性・空白モノリス**: 公園通り入口 (`-791, 270`) の半欠け横断歩道・東側街区欠損、道玄坂/宮益坂の孤立暗色ボックスや無地モノリス、宮益坂途中の孤立矩形交差点パッド、ハチ公像の日陰黒潰れ、スクランブル斜め横断歩道中央の欠け。
4. **車両ギア・URL 同期・StreetReaderAI 知見統合**: 停車中の微小速度ジッターによる `D 1` / `R` チャタリング、ブラウザ URL クエリへの緯度経度・方位角双方向同期、`streetreaderAI` 準拠の進行方向基準 4 象限相対方位 (`FRONT LEFT` / `FRONT RIGHT` 等) および前方交差点案内。
5. **多言語辞書整合**: 新規追加された渋谷・青山 PLATEAU ビル 3 棟の中国語翻訳漏れによる `i18n.test.ts` 失敗の検出と解消。

---

## 2. 各領域の実施内容

### 2.1 `landmarks-3d` (`blender/scripts/generate_shibuya_stream.py`, `apps/web/public/models/shibuya_stream.glb`)

- `add_box` / `add_cylindrical_panel_z` に部分 UV 矩形マッピング (`uv_rect`) を導入し、低層店舗への 4 層テクスチャ圧縮や QFRONT 3F への 2F スターバックス二重投影を解消。
- **SHIBUYA 109**: 正面エレベーター縦スリットを上下 (`Z=9.2..15.4m` / `Z=23.6..60.4m`) へ 2 分割し、`1 0 9` 立体エンブレム (`Z=19.5m` / `Z=68.0m`) の背後にソリッド白パネルを配置。48 分割円筒、20 本垂直フィン、4 段半円形御影石ステップ、三角基壇ポディウム (`Z=0..8.2m`) を構築。
- **QFRONT**: 1F (`Z=0..4.8m`) を 4 連アーケードピラー・高輝度ウォームガラス店舗・バックライトファシア・3 連自動ドアへ刷新し、2F スターバックス・3F〜7F Q'S EYE の 3 層構成を確立。
- **渋谷ストリーム大階段 & 首都高 3 号線**: 稲荷橋広場大階段を奥行き `13.6m`・42 段・ウォーム LED 段鼻照明・クリアガラス欄干へ刷新。首都高門型橋脚の 45° コンクリートハンチ・支承・3 段ゼブラ帯・正方比率案内標識を整備し、MAGNET (`worldX ∈ [-784.0, -775.6]`) と北側 JR 高架 (`x=-769.2, width=10.5`) の無干渉を維持。
- GLB 出力サイズ `8,267,472 bytes`（18 メッシュ）、Blender 24 視点 (`/tmp/stream_swarm_review`) 目視確認済み。

### 2.2 `plateau-gis` (`gsiPlateauLoader.ts`, `tokyoMarunouchiOpenData.ts`, `tokyo_marunouchi_open_data.json`, `fetch-open-data.ts`, `generate_shibuya_plateau.py`, `shibuya_plateau_buildings.glb`, `i18n.ts`, `openData.test.ts`)

- `SHIBUYA_AOYAMA_ZONE_MAX_X = -345` (`x < -345`) を渋谷・青山連続境界として `localToWgs84` / `wgs84ToLocal` / `sampleGsiDemElevation` / `findNearestPlateauBuilding` を統合し、`(-550, 248)`〜`(-380, 248)` で渋谷側 WGS84・連続台地標高 (`> 20m`)・`13113-*` 最寄りビルを返すよう修正（`(-335, 110)` 大手町タワー判定は維持）。
- 宮益坂〜青山通り沿道 3 棟（`13113-bldg-shibuya-miyamasu-tower`, `13113-bldg-miyamasuzaka-ue-tower`, `13113-bldg-aoyama-omotesando-square`）を追加し、`apps/web/src/core/i18n.ts` の中国語辞書へも登録。
- 外苑東通り (`x = -380`, `x ∈ [-394, -364]`) へ食い込んでいた千代田区西端ビル (`13101-bldg-5101..5103`) を `x >= -364` へセットバック、`5104..5105` を西側へ退避。`generate_shibuya_plateau.py` でも外苑東通り・宮益坂 (`r=12.5m`) クリアランス追加と斜面誤削除修正・法線方向セットバック・ビル単位 UV 位相オフセットを実施し、Blender 55 視点 (`/tmp/plateau_swarm_review`) と `trimesh` 監査（外苑東通り/宮益坂内頂点 0）で収束。

### 2.3 `city-roads` (`tokyoStationMap.ts`, `roadBuilder.ts`, `roadMarkings.ts`, `roadSigns.ts`, `carModel.ts`, `roadSystem.test.ts`)

- `carModel.ts` の `isShibuyaZone = carX < -345` を `gsiPlateauLoader.ts` と一致させ、ナビ地図での `13101-*` 重複ビル除外および宮益坂・公園通り延伸ルートを描画。`tokyoStationMap.ts` でも外苑東通りセットバックの二重防御と `focusPosition.x < -345` 時の千代田区西端重複ビルカリングを適用。
- `nav-road-shibuya-koen-dori` に `skipStartCrosswalk = true` を設定して半欠け横断歩道を解消し、`roadBuilder.ts` で中央線・車線境界線・外側線を横断歩道/停止線手前でトリム。
- 公園通り (`ShibuyaKoenDoriStreetscapeGroup`)・道玄坂 (`ShibuyaDogenzakaStreetscapeGroup`)・宮益坂 (`ShibuyaMiyamasuzakaStreetscapeGroup`) の連続歩道エプロンとガラス店舗ビル群を構築し、宮益坂途中の孤立矩形パッド (`Intersection_-560_248`, `Intersection_-400_248`) を撤去。フォールバックビル群へ `plateauLod2Storefront` / `plateauLod2Facade` テクスチャを適用。
- スクランブル斜め横断歩道の中央重複・誘導ドット干渉を整理し、ハチ公像および白御影石台座の昼夜エミッシブ視認性を改善。

### 2.4 `vehicle-url-ux` (`physics/vehicle.ts`, `main.ts`, `vehicle.test.ts`)

- `vehicle.ts` に `isReverseInputActive` / `wasInReverse` ゲート、停止付近 (`|forwardSpeed| < 0.4 m/s` または `speedKmh < 1.5`) のオートホールド・微振動クランプ、および `getState()` での停止時未入力 `"R"` 残留解除を実装し、無入力時の `D 1` → `R` 誤遷移・フリッカーを完全に禁止。
- `main.ts` の `teleportVehicleToLocal` スポーン高度をサスペンション静止高 (`y = 0.62m`) へ是正してテレポート直後の地面貫通反発スパイクを排除するとともに、`parseUrlLocationQuery` / `compassHeadingDegToLocalYawRad` / `buildUrlWithGpsCoordinates` で `?lat=...&lon=...&heading=...` 初期スポーン・`popstate` ワープ・走行中 `history.replaceState` 同期を実現。
- `streetreaderAI` 調査知見をもとに `getObserverRelativePosition` / `computeStreetReaderContext` を統合し、進行方向基準 4 象限相対位置と前方交差点距離を表示。

---

## 3. 検証記録（Trust Signals）

- **静的解析・全テスト・本番ビルド** (`just format-code && just verify-all`):
  - `actionlint` & `pinact run --check`: PASS
  - `tsc --noEmit`: PASS
  - `oxlint --deny-warnings . && oxfmt --check .`: PASS (0 warnings, 0 errors / 79 files)
  - `ruff check blender/scripts/` / `ruff format --check blender/scripts/`: PASS (8 files)
  - `vitest run`: **25 test files passed (25), 214 tests passed (214)**（`openData.test.ts`, `roadSystem.test.ts`, `shibuyaConnectivity.test.ts`, `vehicle.test.ts`, `i18n.test.ts`, `buildingTexture.test.ts` 等すべて含む）
  - `vite build && pnpm run minify`: PASS（219 modules、`dist/assets/index-DKob-oLm.js` 出力）
- **実ブラウザ E2E・UI OFF (`Tab`) ビジュアル検査**:
  - **Round 1 12 視点検査** (`/tmp/verify_shots_round1/`):
    1. スクランブル交差点北西 (`-792, 222`, 323°): QFRONT 1F TSUTAYA / 2F Starbucks / 3F-7F Q'S EYE、ハチ公銅像＋白御影石台座、斜め横断歩道中央・109 の鮮明表示を確認。
    2. SHIBUYA 109 前 Y 字路 (`-832, 248`, 270°, chase & cockpit): `1 0 9` ロゴ背後のスリット非貫通、4 段半円ステップ、右沿道ビル連続性を確認（※ Round 1 コクピット拡大 `/tmp/gauge_crop.png` ではテレポート高度 `0.02m` の反発スパイクにより `0 km/h` で赤色 `R` / `[R]` が残留していたため是正）。
    3. JR 渋谷駅ガード下 (`-798, 245`, 90°): `JR 渋谷駅 SHIBUYA STA.` / `高さ制限 4.5M` 標識とガード下通過見通しを確認。
    4. 道玄坂 (`-940, 195` & `-925, 215`, 90°): 浮遊暗色コンテナボックスおよび空白モノリスの完全消滅、沿道ガラス商業ビル・歩道・街路樹連続性を確認。
    5. 国道 246 号 / 首都高 3 号渋谷線 (`-860, 100`, 90°): 45° 門型橋脚ハンチ・箱桁・遮音壁・沿道 1F 店舗を確認。
    6. 明治通り / 渋谷ストリーム (`-740, -30`, 0°): 42 段稲荷橋広場大階段・ガラス欄干・段鼻照明・ヒカリエ球体オーブを確認。
    7. 公園通り (`-791, 270`, 0°): 半欠け横断歩道の消滅と左右歩道・ガードレール・1F ガラス店舗の連続性を確認。
    8. 宮益坂上 (`-550, 248` & `-450, 248`, 270°): WGS84 渋谷〜青山連続座標 (`35.65959°N, 139.70478°E`〜`139.70588°E`)、DEM 標高 (`+28.5m` / `+30.0m`)、最寄りビル `13113-bldg-*` 一致、千代田区タワー非侵入・無地モノリスゼロを確認。
    9. 外苑東通りユーザー報告地点 (`-376, -11`, 0°): 走行車線を塞いでいた灰色石積み壁の完全排除を確認。
    10. URL 座標初期スポーン (`?lat=35.65959&lon=139.70187&heading=270`) で `(-815.37, 247.94)` へ自動ワープすることを確認。
  - **Round 2 コクピット・ギア修正実証** (`/tmp/verify_shots_round2/`):
    - `02b_109_y_cockpit.png` (`-832, 248`, 270°, cockpit, UI OFF) およびメーター拡大クロップ `gauge_crop_round2.png` (`x: 540..740, y: 560..680`) を直接目視確認し、無入力・`0 km/h` で **青色 `D` および `[D 1]`** が鮮明に点灯していること（赤色 `R` でないこと）、`gps.json` (`gear: "D 1", speedKmh: 0`)、コンソールエラー 0 件を実証。

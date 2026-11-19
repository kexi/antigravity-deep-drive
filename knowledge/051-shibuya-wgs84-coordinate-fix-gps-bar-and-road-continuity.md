---
title: 渋谷エリア WGS84 緯度南北反転の修正・常時表示 GPS 座標バー追加・道路接続破綻の解消
tags:
  - open-data
  - roads
  - physics
  - ui
trust_signals:
  verified_date: 2026-11-17
  author: antigravity
  verified_by: vitest (25 files / 209 tests), just verify-all, Playwright live visual review
---

# 051: 渋谷エリア WGS84 緯度南北反転の修正・常時表示 GPS 座標バー追加・道路接続破綻の解消

## 1. 背景と発見された課題

渋谷エリアでの走行検証・不具合切り分けの過程で、位置特定の困難さと道路網の視覚的・構造的破綻の要因となっていた以下の課題が判明した。

1. **渋谷ゾーンの WGS84 緯度南北符号反転 (`gsiPlateauLoader.ts`)**:
   - シーン内で渋谷ストリーム `(-695, -15)` からスクランブル交差点 `(-815, 248)` へ北上（`+Z` 増加）する設計であるにもかかわらず、`wgs84ToLocal` と `localToWgs84` の渋谷分岐（`x < -550` / `lon < 139.725`）が `northM = -(z - -15.0)` と符号を反転させていた。そのため、北へ向かうほど緯度が南へ減少していた。
2. **UI OFF 時・モバイル環境での経緯度視認性とコピー手段の欠如**:
   - `#gis-coord-display` が `UI OFF [Tab]` で非表示になり、`<= 1024px` 画面でも既定折りたたみ (`.is-collapsed-mobile`)、また `user-select: none` により選択や 3D `(X, Z)`・方位角の確認および位置共有コピーができなかった。
3. **渋谷道路網の欠損・継ぎ目破綻・Z-fighting**:
   - **国道246号・玉川通り（`x = -750..-855, z = 95..102`）の約 105m 欠損**: `nav-road-route246` が `(-738, 102)` 始まり、`nav-road-shibuya-tamagawa-west` が `(-855, 95)` 始まりであったため、明治通り以西の 105m に道路メッシュが存在しなかった。
   - **明治通り継目 `(-750, -210)` の分断と偽横断歩道**: `nav-road-meiji-dori` と `nav-road-meiji-dori-ebisu-curve` の端点が `(-750, -210)` で接しているのに両端へ既定トリムと横断歩道・停止線が生成され、道路中央に 4m の分離帯・歩道切れ目と 2 重の横断歩道が生じていた。
   - **公園通り・宮益坂端点の接続ギャップと T字入口塞ぎ**: `nav-road-shibuya-koen-dori` が `z = 270` 始まりでスクランブル連絡路まで 22m 空いており、`nav-road-shibuya-miyamasuzaka` 東端 `(-400, 232)` が青山一丁目 `(-380, 250)` の開口とズレていた。また `CurvedRoadway_Asphalt` が全路線で同一の `y = 0.012` を共有して交差点重複部で Z-fighting していた。

---

## 2. 実施した修正内容

### 2.1. 渋谷 WGS84 変換の南北整合化 (`apps/web/src/openData/gsiPlateauLoader.ts`)
- `wgs84ToLocal`: `const z = -15.0 + northM;` に修正。
- `localToWgs84`: `const northM = z - -15.0;` に修正。
- `openData.test.ts` にスクランブル交差点 `(-815, 248)` の緯度増加（`lat > 35.659`）・経度減少（`lon < 139.702`）・往復変換精度テストを追加。

### 2.2. 常時表示 GPS 座標オーバーレイバー & 1クリックコピー (`apps/web/index.html`, `apps/web/src/main.ts`, `apps/web/src/vehicle/carModel.ts`)
- `UI OFF` モードやモバイル画面でも常に視認可能な固定ピル `#gps-live-bar`（緯度経度 `#gps-live-latlon`、3D `(X, Z)`・標高・地球コンパス方位 `#gps-live-xyz`、1クリックコピーボタン `#gps-copy-btn`）を追加。
- `.speedometer-box` に `#hud-coord-status` を追加し、車内 11型ナビ下端ステータスバーも 5桁精度の緯度経度＋`(X, Z)` 表示へ更新。
- クリップボードコピー時に Zod 構造化ログ（`gis:coord.copied`）を出力し、外部・E2E 参照用に `window.__DEEP_DRIVE_GPS__.getCurrentLocation()` を公開。

### 2.3. 渋谷道路連続性の修復と Z-fighting 解消 (`apps/web/src/roads/types.ts`, `roadBuilder.ts`, `gsiPlateauLoader.ts`, `tokyoStationMap.ts`)
- **玉川通り・国道246号の完全接続**: `nav-road-shibuya-tamagawa-west` と `nav-road-route246` を `(-750, 102)` で結合し、交差点パッド `{ x: -750, z: 102, w: 34, d: 30 }` および各種 `medianExclusionZones` / 街路樹除外ゾーンを追加。
- **公園通り・宮益坂・ヒカリエ連絡路の接続修正**: `nav-road-shibuya-koen-dori` の始点を `(-791, 250)`（`points[1]` の PARCO 前 `(-798, 360)` は維持）、`nav-road-shibuya-miyamasuzaka` の東端を `(-380, 250)`（青山一丁目交差開口）へ接続し、各 T字・Y字合流点（`(-729, 248)`, `(-727.5, 102)`, `(-837, 250)`, `(-940, 345)`）に開口除外ゾーンを設定。
- **明治通り連続接続 & レイヤー分離**: `skipStartCrosswalk` / `skipEndCrosswalk` を追加し、`(-750, -210)` の連続継ぎ目を `startTrimMeters = 0` で隙間なく直結。また `buildPolylineSegment` に路線インデックスごとの微小標高オフセット（`0.011 + corridorIdx * 0.00012`）を与え、スプライン路面同士の Z-fighting を解消。
- **動的信号 PointLight の共通除外**: 宮益坂上交差点が歩道メッシュ上に正規配置可能になったことで生成された信号機ライトを `TokyoStationMap.removeAttachedLights` 共通メソッドで除外し、不要光源ゼロ（`vehicle.test.ts` 保証）を維持。

---

## 3. 検証結果（Trust Signals）

- `just check-types` (`tsc --noEmit`): エラー 0 件。
- `just verify-all`: `actionlint` / `pinact` / `oxlint` / `oxfmt` / `ruff` / Vitest（25 テストファイル・209 テスト）/ 本番ビルド全パス。
- 影響重点テスト（`openData.test.ts`, `shibuyaConnectivity.test.ts`, `roadSystem.test.ts`, `vehicle.test.ts`）: 4 ファイル・42 テスト 100% 合格。

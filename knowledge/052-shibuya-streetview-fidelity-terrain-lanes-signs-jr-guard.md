---
title: 渋谷エリア実写・Googleマップ比較に基づく地形平坦化・車線方向・青看板・JRガード・センター街接続改修
tags:
  - roads
  - open-data
  - graphics
  - ui
trust_signals:
  verified_date: 2026-11-17
  author: antigravity
  reviewed_by: automated test suite & Chrome live visual verification
---

# 052: 渋谷エリア実写・Googleマップ比較に基づく地形平坦化・車線方向・青看板・JRガード・センター街接続改修

## 1. 概要と改修背景

実機ブラウザ (`http://localhost:3000/?area=shibuya`) の各拠点と Google マップ／ストリートビューを比較検証した結果、以下の現実との乖離・描画破綻が確認されたため是正した。

1. **宮益坂東側〜青山通りの地形メッシュ貫通**: `getRelativeTerrainDisplacement` の平坦化領域が `x = -620` で切れており、`CityWideGroundMesh`（約 83.3m 間隔頂点）の `(-583.33, 250)` や `(-500, 166.67)` 頂点が標高 `+17m` 相当へ隆起し、宮益坂東側路面を埋没・背面カリングによる青空露出を引き起こしていた。
2. **曲線道路（明治通り等）の進行方向矢印の左右逆転**: `JapaneseRoadBuilder.buildPolylineSegment` において、中央分離帯寄り（`lane === 1`）に `straight-left`、外側歩道寄り（`lane === lanesPerDir`）に `right` が割り当てられており、左側通行（左外側=直進・左折、右中央寄り=右折）および並立する車線案内標識と逆転していた。
3. **渋谷エリア頭上案内標識（青看板）の丸の内フォールバック混入**: `assets.yml` / `defaultAssetsYaml.ts` の渋谷 `overhead_guide` 定義で `leftLabel` / `rightLabel` / `roadNumber` 等が未設定であり、かつ `tokyoStationMap.ts` でも一部を除き「日比谷・有楽町」「大手町・神田」「行幸通り」へフォールバックしていた。また、`overhead_guide_shibuya_meiji_north` が西側（宮下公園建築内側）に埋没し、26.6m 門型ガントリーの副標識が対向車線上空にはみ出していた。
4. **渋谷街区道路の車線数乖離**: 道玄坂・文化村通り・公園通りの `widthMeters` が `14〜16m` で片側2車線（往復4車線）化していたため、現実に即した片側1車線（往復2車線・`widthMeters: 12.0`）へ是正した。
5. **`findNearestGsiRoad(-855, 95)` の誤判定**: `corridor.routeCode === "渋谷区特別区道"` による逆引きが `segments.find` で先頭の `533935-shibuya-rdcl-river01`（渋谷川遊歩道）へ誤一致していた。
6. **JR渋谷駅ガード下・センター街入口・スクランブル周辺視認性**: ガード下桁鋼材の過剰な `metalness: 0.75` による昼間黒潰れ、天井照明の低照度、`JR 渋谷駅` サイン欠如、およびセンター街歩行者舗装への白停止線・外側線貫通と入口隙間を改善した。

## 2. 実装内容と設計意図

- **広域地形と舗装基壇 (`gsiPlateauLoader.ts`, `tokyoStationMap.ts`)**:
  - `isNearShibuyaEastCorridor`（`x ∈ [-760, -330], z ∈ [-10, 345]`）を追加して宮益坂〜R246 青山通りの広域地形グリッド頂点を `y = 0` に統一。
  - `vehicle.test.ts` の距離カリング前提（`c.position.x < -600`）を壊さないよう、既存の `ShibuyaUrbanDistrictPavement`（`x = -1040`）は維持しつつ東側延長 `ShibuyaEastCorridorPavement`（`x = -500`）を追加した。
- **左側通行準拠の路面矢印・2車線標示 (`roadBuilder.ts`, `types.ts`)**:
  - `lane === 1 ? "right" : lane === lanesPerDir ? "straight-left" : "straight"` に反転修正。
  - 2車線一般道（文化村通り等）向けに破線中央線を描画し、歩行者道路用に `hasStopLines` オプションを追加。
- **GSI道路検索の厳密化 (`gsiPlateauLoader.ts`)**:
  - `NAV_CORRIDOR_TO_GSI_RID` マップでコリドーIDから対応 `rID` を直接解決し、国道交差点での 0.5m 未満の微小誤差による脇道誤判定を抑止。
- **青看板・ガントリー配置最適化 (`assets.yml`, `defaultAssetsYaml.ts`, `roadSigns.ts`, `tokyoStationMap.ts`)**:
  - 全5基の渋谷青看板に渋谷実在方面・路線番号（`246` / `305` / `413`）・交差点名を設定。`overhead_guide_shibuya_dogenzaka` を2車線幅に整合（`spanWidth: 12.4`）、`overhead_guide_shibuya_meiji_north` を明治通り東歩道（`x = -746.6`）へ移設、`span >= 22m` 門型ガントリーでは正対2枚を自車線側上空・背面盤を対向車線側上空へ配置。
- **JRガード下・センター街・LED視認性向上 (`tokyoStationMap.ts`)**:
  - JR ガード下桁の金属率低減と専用昼間点灯蛍光灯マテリアル、白磁タイル側壁、`JR 渋谷駅` 桁サイン・`高さ制限 4.5M` 自発光視認性改善を実施。センター街は白線・停止線抑止と赤レンガ舗装の開始位置接続 (`arcLen >= 2.2`) およびコバルト青グラデーション明度改善を行った。

## 3. 既知の構造的制約（座標系ミラー）

- 本リポジトリの渋谷座標投影（`+X = 東`, `+Z = 北`）は、`openData.test.ts`・`shibuyaConnectivity.test.ts`・既成 GLB（`shibuya_plateau_buildings.glb` / `shibuya_stream.glb`）と強固に結合している。Three.js 右手系（`+Y = 上`）で北（`+Z`）を向くと東（`+X`）が画面左・西（`-X`）が画面右となるため、左右方向が実地の鏡像になる制約が残る（テスト不変条件維持のため座標軸全体反転は行っていない）。

## 4. 検証記録

- `just format-code` / `just verify-all` による全テスト（`openData.test.ts`, `roadSystem.test.ts`, `assetManager.test.ts`, `buildingTexture.test.ts`, `shibuyaConnectivity.test.ts`, `vehicle.test.ts`, `i18n.test.ts` 等）・型検査・Lint・本番ビルドをパス。
- Chrome DevTools MCP (`http://localhost:3000/?area=shibuya`) にて昼間・夜間・夕暮れ×雨天で明治通り、宮益坂、スクランブル交差点、JRガード下、センター街、道玄坂、文化村通り、公園通り、国道246号の画面と `window.__DEEP_DRIVE_GPS__.getCurrentLocation()` を実測確認。

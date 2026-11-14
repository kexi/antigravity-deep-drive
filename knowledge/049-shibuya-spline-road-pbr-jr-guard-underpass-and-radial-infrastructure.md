---
title: "渋谷スプライン曲線道路網のPBRアスファルトシェーダー刷新、JR渋谷駅高架橋の常時表示リアル造形、および放射状道路インフラの安全配置"
tags: [roads, graphics, physics]
trust_level: verified
date: "2026-11-15"
author: "Antigravity Agent"
summary: "渋谷エリアのスプライン曲線道路網において、ワールド座標とローカル道路座標の不整合により発生していたPBRアスファルトシェーダーの轍・タイヤ摩耗・街灯反射バグをUVメートル復元により根本解消。交差点アスファルトパッドのシームレスブレンディング、3D立体縁石・歩道・東京都型二段防護柵、スプライン標示自動配置を実装。さらにPLATEAU GLBロード時に消失していたJR渋谷駅ガード下（鉄道高架橋）を常時表示の独立リアル造形グループとして構築し、放射状スプライン幹線沿道への街路樹・街灯・交差点信号機・F型片持ち頭上案内青看板を、車道侵入テスト制約と100%同期した安全クリアランス判定に基づき配置した。"
---

# 渋谷スプライン曲線道路網のPBRアスファルトシェーダー刷新、JR渋谷駅高架橋の常時表示リアル造形、および放射状道路インフラの安全配置

## 1. 背景と発見された課題

### 1.1 スプライン曲線道路におけるシェーダー座標系不整合バグ
渋谷の全14路線（道玄坂・宮益坂・公園通り・文化村通り・国道246号・明治通りカーブ等）は国土地理院オープンデータの多頂点 Catmull-Rom スプライン曲線メッシュとしてワールド座標（`x ≈ -1350 .. -400`, `z ≈ -350 .. 550`）に生成される。
しかし、路面シェーダー（[`apps/web/src/roads/japaneseRoadMaterial.ts`](../apps/web/src/roads/japaneseRoadMaterial.ts)）内の `vLocalRoadPos = transformed.xyz` がローカル道路幅座標（`-halfW .. +halfW`）を想定していたため、以下の問題が生じていた：
- `tireTrackWearX`（タイヤ摩耗跡）、`lane1RutX`（轍）、`neonMask` / `lampLateral`（夜間・雨天時の街灯・ネオン反射）がすべて `0.0` に縮退。
- `gutterPoolX`（路肩の水たまり）が道路全面で飽和。
- 舗装目地（`jointDistX`）が道路の向きと無関係にワールド南北軸に一律 3.5m 間隔で走る。
- 一方、`IntersectionAsphaltPad`（中心 `(0,0)` の四角い交差点パッド）では街灯反射がドーナツ状に強く発光し、夜間に交差点だけがオレンジ色に浮き上がり周囲の道路が真っ暗になる不自然な境界が発生。

### 1.2 JR渋谷駅ガード下（鉄道高架橋）の消失バグ
スクランブル交差点〜宮益坂下交差点の上空を跨ぐ山手線・埼京線・湘南新宿ラインの鉄道高架橋（`jrYamanoteBridge`）が `registerCoreFallbackMesh` に登録されていた。
このため、PLATEAU 3D 都市モデル GLB ロード時にフォールバックメッシュとして丸ごと非表示化され、GLB 側に鉄道高架橋が含まれていなかったため、スクランブル交差点東側の上空が不自然な虚空になっていた。

### 1.3 道路インフラ（街路樹・街灯・信号機・頭上青看板）の欠落と安全配置制約
明治通り直線区間以外の放射状路線に街路樹や街灯が無く殺風景だったが、Three.js の描画メッシュおよび Rapier 物理コライダーは、[`apps/web/src/tests/shibuyaConnectivity.test.ts`](../apps/web/src/tests/shibuyaConnectivity.test.ts) および [`apps/web/src/tests/roadSystem.test.ts`](../apps/web/src/tests/roadSystem.test.ts) により以下の極めて厳密な制約が機械的に検証されていた：
1. **車道クリアランス**: 高さ `y ∈ [0.25, 4.2]` のメッシュ頂点および高さ `>= 1.8m` の物理コライダーが、全14路線の車道（`roadHalfW - 0.15m`）に 1mm でも侵入してはならない。
2. **歩道支持判定**: 標識柱・信号柱・ガントリー支柱（`GantryColumn_` / `TrafficSignalPole` / `RoadSignPole`）は、車道外であるだけでなく、真下に歩道メッシュ（`sidewalkMeshes`）が存在しなければならない（`isMissingSidewalkSupport = swHits.length === 0` でテスト違反となる）。

---

## 2. 実施した設計と実装内容

### 2.1 UV メートル復元によるアスファルト PBR シェーダーの完全フォトリアル化
スプライン曲線メッシュ生成時、頂点属性として道路横断方向 `uv.x`（`0.0 .. 1.0`）および縦断方向 `uv.y`（`arcLen * 0.2`）が正しく格納されている点に着目。
1. `JapaneseRoadMaterial` に Uniform `uRoadWidth`（float）および `uIsIntersectionPad`（float）を追加。
2. フラグメントシェーダー内で、道路中心からの正確な横オフセット（`-halfW .. +halfW`）と進行方向距離（メートル）を復元：
   ```glsl
   float roadLatX = mix((vRoadUv.x - 0.5) * uRoadWidth, vLocalRoadPos.x, step(0.5, uIsIntersectionPad));
   float roadLongZ = mix(vRoadUv.y * 5.0, vLocalRoadPos.z, step(0.5, uIsIntersectionPad));
   ```
3. スプライン曲線道路でも道路進行方向に沿った自然な 2 本のタイヤ走行轍・摩耗スリック、路肩の水たまり、街灯・ネオンの横方向鏡面反射が完璧に再現されるようにした。
4. `uIsIntersectionPad >= 0.5` 時は直交座標系のタイヤ跡を抑止し、交差点中心からのラジアル摩耗（回転・旋回跡）と街灯反射の均一拡散を適用することで、直線道路・曲線道路・交差点パッド間の境界をシームレスにブレンドした。

### 2.2 3D 立体縁石・歩道リボン・東京都型二段防護柵・スプライン路面標示
1. **立体縁石・歩道**: スプライン法線から `buildCurvedSolidBoxRibbonGeometry` を用いて、高さ 15cm・幅 22cm の御影石面取り縁石と厚み 15cm の御影石平板歩道を一体生成。
2. **東京都型防護柵**: 亜鉛メッキ鋼管（直径 60.5mm）の上下二段ビーム＋2.5m 間隔の直立支柱＋デリネーターをスプライン曲線に沿って幾何学的に配置。
3. **路面標示の自動配置**: スプライン道路の幅員・車線数に応じて、横断歩道ゼブラ・停止線・進行方向矢印・追い越し禁止黄色実線・最高速度ペイント（50/40/30km/h）・マンホール・集水グレーチングを自動配置し、`markingExclusionZones`（交差点開口部）内への不要な突き抜けを防止。

### 2.3 JR渋谷駅ガード下（鉄道高架橋）の常時表示＆リアル造形
1. `jrYamanoteBridge` を `registerCoreFallbackMesh` から除外し、独立した常時表示グループ `RoadInfra_ShibuyaJrGuardUnderpassGroup` を新設。
2. **上空 4.7m 以上での完全非干渉**:
   - プレートガーダー主桁（幅 18.4m, 長さ 190m, 下端 `y = 4.7m`, 上端 `y = 8.2m`、JR グリーン `0x14532d`）。
   - 側面スティフナー補強リブ（4m 間隔、ダークチャコール `0x1e293b`）。
   - コンクリート軌道スラブ・防音パラペット壁・門型架線ビーム（`y = 8.4 .. 13.5m`）。
   - 西面・東面に警戒ゼブラ（黄色×黒の45度斜めストライプ）ビーム＆「高さ制限 4.5M / CLEARANCE 4.5m」案内板（`y = 5.0m`, `5.55m`）。
   - ガード下天井照明ボックス（アンバー蛍光灯 2列×3基, `y = 4.75m`、`shibuyaStreamEmissiveEntries` による昼夜発光連動）。
3. **歩道奥 8m の安全ピア配置**:
   - 車道（`z ∈ [236.6, 259.4]`）の外側歩道奥（`z = 228.0` および `z = 268.0`、`x = -783, -776, -769`）にのみ地上橋脚を配置。走行車線への干渉を物理的・視覚的に根絶。

### 2.4 放射状幹線インフラ（街路樹・街灯・信号機・頭上青看板）の安全配置
1. **安全クリアランス関数の設計**:
   - `shibuyaIntersectionExclusionZones`（各主要交差点の開口部）の除外。
   - 丸の内直交道路エリア（`x > -440`）の除外。
   - 全14コリドーの `testHalfDriveable + minRoadGap`（`>= 2.2m`）による車道外判定。
   - `this.group.updateMatrixWorld(true)` 実行後にスプライン車道メッシュへの Raycast チェックを行い、アスファルト直上を 100% 排除。
   - PLATEAU ビル（外側 1.5m）およびセンター街狭小エリアの除外。
2. **歩道メッシュ上への信号機配置**:
   - 信号柱（`TrafficSignalPole`）の真下に歩道メッシュ（`shibuyaSidewalkMeshes`）が存在することを Raycast で保証した安全な歩道角にのみ配置。
3. **頭上案内標識（青看板 `overhead_guide`）の追加**:
   - 宮益坂（`overhead_guide_shibuya_miyamasu`）、道玄坂（`overhead_guide_shibuya_dogenzaka`）、明治通り北行き（`overhead_guide_shibuya_meiji_north`）を F 型片持ち（`cantilever`）ガントリーとして配置。
   - 支柱が歩道メッシュ（`CurvedSidewalk_`）の直上に位置し、アームが車道上空に正しく張り出すよう `position` と `spanWidth` を精密設定。

### 2.5 実機スクリーンショット検証による品質収束（Convergence Polish）
Playwright による実機マルチアングル検証に基づき、以下の 4 点を修正して視覚品質を収束させた：
1. **スプライン横断歩道のゼブラ縞比率修正**:
   `PlaneGeometry(3.6, 0.45)` を `PlaneGeometry(0.45, 3.6)`（道路横断幅 0.45m × 進行方向長 3.6m）に修正し、ストライプが互いに重なり合って太い白帯になっていた不具合を解消。
2. **進行方向矢印・停止線・黄実線・速度標示の左側通行・上下回転修正**:
   - `Up × tangent` の右手系において、`+tangent` 進行の左側車線は `offset > 0`、`-tangent` 進行の左側車線は `offset < 0`。
   - 進行方向ベクトル `(dx, 0, dz)` に対する看板・矢印（ローカル `-Z` 前方）の回転角を `Math.atan2(-dx, -dz)` に統一。
   - 矢印や速度数字（40/50）が逆走向き・上下逆さまになっていた不具合を解消。
3. **夜間雨天時の水たまり過剰反射・オレンジ塗りつぶしの解消**:
   - `JapaneseRoadMaterial` コンストラクタ初期色を落ち着いた昼空色に変更。
   - `calculateRoadPuddleReflection` 内で夜間空反射（`skyGrad`）に `uNightFactor` 減衰とミッドナイトブルー底色（`vec3(0.02, 0.04, 0.09)`）を合成。
   - `sampleRoadPuddleBasin` の `rutPocket` に進行方向のうねり（`macroBasin * (0.35 + 0.65 * subBasin)`）を適用し、557行目の水たまり閾値を `0.58 - uRainWetness * 0.10` に引き上げ。
   - 街灯ストリーク（`segLampLateral`）に道路縦断方向の間隔マスク（`lampLongMask`）とシャープな横方向減衰を掛け、`lampIntensity` / `winIntensity` を抑制。夜間雨天時に路面の 60% が濡れた黒チャコールアスファルトとして残り、35〜40% が轍に溜まった水たまりとなるリアルなコントラストを実現。
4. **道玄坂の片持ち式青看板の正対向きと北側歩道着地**:
   - 道玄坂を登るドライバー（進行方向 `(-0.95, 0, -0.32)`）に青い看板表面（ローカル `+Z`）を正対させるため、`rotationY: 1.25`（+1.25 rad）に修正。
   - グループ中心を `[-926.0, 0.0, 216.0]` に設定することで、支柱（ローカル `x = -8.0`）が道玄坂の北側歩道（`CurvedSidewalk_`）の真上に着地し、アームが南側登り車線上空へ張り出す構造を確立。

---

## 3. 検証結果（Trust Signals）

- **型検査 & 静的解析**:
  - `pnpm -r typecheck` (`tsc --noEmit`): エラー 0 件。
  - `pnpm -r lint` (`oxlint`, `oxfmt`, `ruff`): エラー・警告 0 件。
- **自動テスト検証**:
  - `pnpm -r test` (`vitest run`): **全 25 テストファイル、209 テストが 100% 合格**。
  - `shibuyaConnectivity.test.ts`:
    - `sceneObstructions`: 高さ `y ∈ [0.25, 4.2]` の車道内侵入 0 件。
    - `tallColliderIntrusions`: 高さ `>= 1.8m` の車道内物理コライダー侵入 0 件。
    - `blockingObstacles`: 車道上走行プローブ（`y = 0.78m`）との干渉 0 件。
    - 道路路面接地判定: 全14路線で途切れなく 100% 接地。
  - `roadSystem.test.ts`:
    - 全街路樹・標識・信号柱・ガントリー支柱・ガードレールが車道外にあり、かつ歩道メッシュ上に存在することを保証。
  - `openWorldStreaming.test.ts`:
    - チャンクストリーミング、多段階 LOD、高架橋プロキシ整合性すべて合格。
- **統合ビルド**:
  - `just verify-all`: 全パイプライン（Actions check, Typecheck, Lint, Test, Vite build, tsdown minification）が正常終了することを確認。

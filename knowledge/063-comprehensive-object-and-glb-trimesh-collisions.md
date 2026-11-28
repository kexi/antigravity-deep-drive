---
title: 都市・道路・GLB建築物全域の当たり判定網羅修正と地上帯 Trimesh コライダー統合
tags:
  - physics
  - roads
  - architecture
trust_signals:
  verified_date: 2026-11-28
  author: antigravity
  verification_method:
    - 新規単体テスト apps/web/src/tests/objectCollision.test.ts による信号機・ハチ公広場・JRガード壁/橋脚・バスシェルター・センター街・沿道ビル・109縁石・GLB地上帯 Trimesh 衝突検証
    - apps/web/src/tests/shibuyaConnectivity.test.ts による全14渋谷道路コリドーでの車道非侵入（見えない壁ゼロ）確認
    - just format-code && just verify-all && just build-pages && just build-app 全通過
---

# 都市・道路・GLB建築物全域の当たり判定網羅修正と地上帯 Trimesh コライダー統合

## 1. すり抜け・当たり判定欠落の根本原因

都市マップ全体（東京駅・丸の内・渋谷・道路全8系統・非同期ロード GLB 群）の物理コライダーを網羅監査した結果、以下の 8 系統の欠落・不整合が判明した。

1. **GLB ロード時の主要渋谷ランドマーク 10 棟のコライダー消失**:
   - [`tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts) の `setShibuyaGlbOverlappingProceduralVisible(false)` が `shibuya_stream.glb` ロード時に `proceduralGlbOverlappingColliders`（渋谷ストリーム・スクランブルスクエア・ヒカリエ・サクラステージ・フクラス・宮下公園・QFRONT/109・PARCO・セルリアンタワー・マークシティ・センター街アーチ）をすべて `setEnabled(false)` にする一方、GLB 側の代替コライダーを生成していなかった。さらに GLB 単独収録の `ShibuyaMagnet_Tower`・`ShibuyaToeiBic_Tower`・`ShibuyaHachiko_Statue` も無判定だった。
2. **渋谷 PLATEAU 建物群 (`shibuya_plateau_buildings.glb`) のコライダー全欠落**:
   - 8 枚の `PlateauTile_*` メッシュ（数百棟の実在渋谷建築）が `loadGlbShibuyaPlateauModel()` で視覚配置されるのみで Rapier コライダーが 1 つも生成されていなかった。
3. **渋谷交差点信号機（最大 24 基）および曲線道路信号機の支柱コライダー欠落**:
   - `shibuyaIntersections` ループと `roadBuilder.ts` の曲線道路信号機配置で支柱の物理コライダー生成が抜けていた。
4. **ハチ公前広場・JR 渋谷駅ガード下・センター街プロップのコライダー欠落**:
   - 忠犬ハチ公像、大型プランター 3 基、広場ベンチ 3 基、LED 照明灯 3 基、JR ハチ公改札口キャノピー柱 4 本、JR 渋谷駅ガード下の化粧壁・腰壁・橋脚、センター街アーチ西柱とバナー柱 10 本、109 三角広場縁石 6 区間にコライダーが無かった。
5. **`isObstacle = false` 誤登録と `groundBody` (`y = -0.5`) オフセットズレ**:
   - 渋谷バスターミナルシェルター 2 基・センター街商業ビル 6 棟・公園通り/道玄坂/宮益坂/金王坂沿道ビル群が `registerCollider(..., false)` で `obstacleColliderHandles` から漏れており、さらに `y = -0.5` の `groundBody` にワールド標高がそのまま指定されていた。また `MiyamasuSouth_EastTower` の南東角が国道 246 号車道へ `3.67m` 食い込んでいた。
6. **回転未適用コライダー**:
   - 首都高 3 号線橋脚コライダーおよび `buildUnifiedJapaneseRoadAccessories` の直方体コライダー（地上変圧器・郵便ポスト・案内板・ベンチ）に `rotationY` が設定されていなかった。
7. **非同期コライダーの `VehiclePhysics` 未同期**:
   - `main.ts` で起動時に 1 回しか `vehiclePhysics.setObstacleColliderHandles()` を呼んでおらず、非同期 GLB コライダー追加時に車輪レイキャスト除外リストが更新されなかった。

## 2. 実装した解決策

- **地上帯 GLB Trimesh コライダー生成器 ([`apps/web/src/physics/meshColliderBuilder.ts`](../apps/web/src/physics/meshColliderBuilder.ts))**:
  - `extractGroundLevelCollisionTriangles` / `createGlbGroundSliceColliders` を新設し、ロード済み GLB メッシュから車両衝突高さ帯（路面 `-0.25m .. +3.2m`）に掛かる壁面・支柱・基壇の三角形のみをワールド座標で抽出して Rapier `trimesh` 障害物コライダーを構築。
  - 上層階（30m〜355m）・頭上歩道橋/アーチ桁（>3.2m）・平坦床面スラブ・`PlateauProxyTile_*`・走行車線内へ微小侵入する三角形を自動除外することで、見えない壁を発生させずに全 GLB 建築物の見た目と完全一致する当たり判定を実現（`shibuya_stream.glb`: `9,624` 三角形、`shibuya_plateau_buildings.glb`: `18,417` 三角形）。
- **排他切替と動的同期 ([`tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts), [`main.ts`](../apps/web/src/main.ts))**:
  - `worldOriginStaticBody` (`(0, 0, 0)`) を導入して全ワールド座標コライダーの `-0.5m` ズレを根絶。
  - GLB 表示中は GLB Trimesh を有効・プロシージャル重複箱を無効にし、GLB 未ロード／チャンク Evict 時はプロシージャル箱へシームレス復帰。`onObstacleCollidersChanged` コールバックで `VehiclePhysics` の `obstacleColliderHandleSet` を自動更新する。
- **全プロシージャル構造物の網羅コライダー化**:
  - 渋谷信号機全基・曲線道路信号機・ハチ公広場（ハチ公像・プランター・ベンチ・照明灯・キャノピー柱）・JR ガード下壁＆橋脚・センター街アーチ両柱＆バナー柱・109 三角広場縁石へ障害物コライダーを追加。
  - バスターミナルシェルター・センター街ビル・沿道商業ビルを `isObstacle = true` 化し、首都高橋脚と統一道路附属物直方体に正確な `rotationY` を付与。`MiyamasuSouth_EastTower` は国道 246 号・宮益坂双方から `5.16m` 離隔する配置へ適正化。

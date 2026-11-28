---
title: 渋谷PLATEAU公式20リーフタイル全面展開・斜面誤削除解消・歩道外縁セットバック・LOD2スカイライン刷新
tags:
  - open-data
  - graphics
  - architecture
  - roads
trust_signals:
  verified_date: 2026-11-28
  author: antigravity
  verification: "Blender 360-degree 2-pass convergence audit (0 roadway intrusions, 0 sidewalk outer-edge intrusions across 4,161 buildings / 20 tiles) + just format-code && just verify-all + just build-pages + live WebGL Shibuya browser visual verification"
---

# 渋谷PLATEAU公式20リーフタイル全面展開・斜面誤削除解消・歩道外縁セットバック・LOD2スカイライン刷新

## 背景・課題

渋谷エリアの建築物密度が実在の渋谷と比べて疎らであった原因を、国土交通省 Project PLATEAU 渋谷区 (`13113_shibuya-ku_pref_2025_citygml_1_op_bldg_3dtiles_13113_shibuya-ku_lod1/tileset.json`) 実測データと [`blender/scripts/generate_shibuya_plateau.py`](../blender/scripts/generate_shibuya_plateau.py)・[`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts) の突き合わせにより定量監査した結果、以下 6 つの根本原因が判明した。

1. **PLATEAU リーフタイルの大量未収録（8 タイル → 20 タイル）**:
   - `13113_shibuya-ku` LOD1 `tileset.json` は `refine: "REPLACE"` の階層構造であり、全建築物の実体は最下層リーフタイル（`d=4, geometricError=0.0`）に格納されている。
   - 現行は中心 8 タイル（`data142, 143, 147, 150, 151, 153, 155, 157`、計 1,729 棟）しか読み込んでおらず、走行可能エリア内（`X ∈ [-1732, -345], Z ∈ [-557, +1268]`）にある **12 枚の隣接リーフタイル（3,208 棟）** が完全に未収録だった（原宿・明治通り北・渋谷区役所/NHK・富ヶ谷・松濤・円山町・神泉・渋谷橋・恵比寿・代官山）。
2. **単一バッチタイルでの急勾配斜面誤削除バグ（448 棟欠損）**:
   - Draco 圧縮 `.b3dm` を Blender へインポートする際、20 タイル中 8 タイル（`data155, 140, 152, 156, 158, 182, 183, 187`）では `_BATCHID` 属性が単一バッチ扱い（`is_single_batch_tile = True`）となっていた。
   - 従来の浮遊スラブ判定は「半径 45m 以内の最低標高から 4.5m 超高いシェルを浮遊とみなす」実装だったため、道玄坂・神泉・渋谷東・代官山など 45m で 5m〜15m 起伏する実在の急勾配斜面ビル 448 棟が誤って全削除されていた。
3. **狭小ペンシルビル・低層店舗の過剰除外**:
   - `min(w, d) < 3.5m` / `area < 180㎡ && h < 4.5m` / `area < 45㎡ && h < 7.0m` の閾値により、渋谷特有の狭小商業ビル・2 階建て店舗が 400 棟以上削除されていた。
4. **道路ポリライン旧版ズレ・過大交差点円・セットバック救済上限の制約**:
   - `EXACT_CURVED_ROAD_CLEARANCES` の一部ポリライン（六本木通り・井の頭通り・神南二丁目・ヒカリエ連絡路）が [`apps/web/src/openData/gsiPlateauLoader.ts`](../apps/web/src/openData/gsiPlateauLoader.ts) と乖離していたほか、14m〜23m の過大な交差点円およびセットバック救済の高さ・規模制限（`8.5m〜65m`, `max <= 56m`, 斜め街路での AABB 誤衝突）により、公園通り・R246・六本木通り・宮益坂・道玄坂沿いの 35m〜72m 級高層ビル群が多数削除されていた。
5. **遠景プロキシ（Decimate 0.20）の崩壊とマルチマテリアル LOD ズレ**:
   - 遠景（235m〜800m）用の `PlateauProxyTile_*` を Blender `Decimate (ratio=0.20)` で生成していたため、独立した低・中層ビルの大半が縮退崩壊して遠景で消失していた。
   - また `loadGlbShibuyaPlateauModel` でマルチマテリアル分割された同一タイル配下のサブメッシュ同士で `userData.cullingBounds` が統一されておらず（`cullingBoundsCache` のみ更新）、距離境界で一部材質だけ先に空ジオメトリへ切り替わる部分消失が発生していた。
6. **広域渋谷チャンク連携漏れ**:
   - `hasActiveShibuyaChunk()` / `activateWorldChunk()` / `WORLD_CHUNK_DEFINITIONS` に `harajuku-yoyogi`, `ebisu-daikanyama`, `aoyama-west`, `roppongi-nishiazabu`, `omotesando-aoyama-north` が含まれておらず、原宿・恵比寿・青山西へ移動時に PLATEAU ビル群のロード・保持対象から漏れていた。

## 設計・実装

1. **公式 20 リーフタイル全面展開（[`blender/scripts/generate_shibuya_plateau.py`](../blender/scripts/generate_shibuya_plateau.py)）**:
   - `PLATEAU_TILES` を全 20 リーフタイル（`data140, 141, 145, 146, 142, 143, 147, 148, 150, 151, 155, 156, 152, 153, 157, 158, 182, 183, 187, 188`、総計 4,937 棟）へ拡大。千代田区境界（`X > -345.0`）への越境をクリップして丸の内座標系と完全分離。
   - **DEM5A ジオイド基準の浮遊スラブ判定**: `sample_shibuya_dem_tp(cx, cz)` でシェル自身位置の GSI DEM5A 標高を取得し、タイル中央値ジオイド高との差分 `> 8.5m` または下部躯体上空 `>= 35%` 面積重複の真の浮遊スラブのみ除外することで、斜面ビル 448 棟を全数救済。
   - **実歩道外縁同期クリアランス＆3 方向精密セットバック救済**: 全 19 路線のポリラインと歩道外縁幅（`resolveCorridorCrossParams()` の `halfWidth + sidewalkWidth + 0.2m`）を 1:1 同期し、高さ `3.0m〜185.0m`・幅 `<= 95.0m` の沿道ビルを 3 方向 × 7 段階（`1.8m〜18.0m`）で歩道外縁へセットバック救済。斜め街路の既存ビル判定も面積重複比（`>= 35%`）へ改善。
   - **狭小・低層フィルタ緩和＆重複除外の精緻化**: 最小幅 `2.2m`・面積 `14㎡`・高さ `2.8m` へ緩和し、スクランブル交差点角の地下鉄出入口小ブース・沿道プロシージャル街区・`exp-bldg-*` の実寸フットプリントのみをタイトに除外して Z-fighting を防止。
   - **ジオメトリ最適化＆箱型スカイラインプロキシ（LOD2）刷新**: 地中不可視の底面（`normal.z < -0.55`）削除と `dissolve_limit(angle_limit=2.5°, delimit={"MATERIAL", "UV"})` で詳細メッシュを圧縮し、`PlateauProxyTile_*` を Decimate 0.20 から各建築物単位（`h >= 10m` または `area >= 80㎡ && h >= 6.5m`）の 5 面プリズム構築へ刷新。
   - **結果**: 保持建築物数が **約 1,170 棟（8 タイル）→ 4,161 棟（20 タイル、約 3.6 倍）** へ増加（GLB 容量 `8.44 MB`）、車道侵入 **0 件**・歩道外縁侵入 **0 件** を達成。
2. **ランタイム LOD 同期と広域渋谷チャンク統合（[`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts), [`apps/web/src/city/openWorldStreaming.ts`](../apps/web/src/city/openWorldStreaming.ts)）**:
   - `loadGlbShibuyaPlateauModel` で親タイルノード配下の全サブメッシュへ同一の `tileMesh.userData.cullingBounds = sharedBounds` を設定し、LOD0 / LOD1 / LOD2 / Culled 遷移の完全同期を保証。
   - `hasActiveShibuyaChunk()` / `activateWorldChunk()` / `evictWorldChunk()` および `WORLD_CHUNK_DEFINITIONS` の `associatedGlbModelIds` に渋谷広域 9 チャンク（`shibuya-core/north/south/west`, `harajuku-yoyogi`, `ebisu-daikanyama`, `aoyama-west`, `roppongi-nishiazabu`, `omotesando-aoyama-north`）を統一登録。

## 検証結果（Trust Signals）

- **Blender 360 度 2 パス収束レビュー**:
  - Pass 1（12 視点）でスクランブル角の極小地下鉄出入口ブースと歩道幅マージン不足を検出 → Pass 2 修正後、全 20 タイル 4,161 棟で **車道侵入 0 件・歩道外縁侵入 0 件**、遠景プロキシ単体視点でも密な渋谷スカイラインの完全保持を確認。
- **回帰テスト＆品質ゲート**:
  - [`apps/web/src/tests/openWorldStreaming.test.ts`](../apps/web/src/tests/openWorldStreaming.test.ts) に実アセット `shibuya_plateau_buildings.glb` の全 20 タイル＋20 プロキシ存在・座標被覆（`X < -1700`, `Z < -500`, `Z > 1200`）・広域チャンク連携検証を追加し、`just format-code` / `just verify-all` / `just build-pages` を全件パス。

---
title: "道玄坂・国道246号周辺の実画面レビューに基づく PLATEAU LOD・中央分離帯ガイドポスト・宙浮きビル屋根スラブの根本解消"
tags: [graphics, open-data, roads, physics]
trust_level: verified
date: "2026-11-11"
author: "Antigravity Agent"
summary: "実画面スクリーンショットおよび Blender 360度レビューで確認された道玄坂上空の宙浮き巨大スラブ、片面ゼブラ板の視認性・裏抜け、道玄坂上 PLATEAU 建物群へのプロシージャルビルめり込みを根本解消。exp-bldg-* の medium LOD における下部メッシュ非表示＋塔屋のみ残存バグを修正し、重複ビルを山手通り西側（PLATEAU 外）へ退避、PLATEAU GLB の曲線道路クリップ軸反転・浮遊スラブ除去および両面視線誘導標（ガイドポスト）化を実施。"
---

# 道玄坂・国道246号周辺の実画面レビューに基づく PLATEAU LOD・中央分離帯ガイドポスト・宙浮きビル屋根スラブの根本解消

## 1. 背景と発見された不具合

本番ビルドのライブ画面確認（スクランブル交差点、道玄坂、国道246号・桜丘さくら坂合流、神泉、山手通り周辺）を通じ、以下の複合的な視覚・配置不具合が確認された。

1. **道玄坂・国道246号・神泉の上空に宙浮きする暗色スラブ（最大の原因）**
   - スクランブル交差点・道玄坂入口・R246西進など複数視点から、道玄坂左側建物の屋上上空（`y = 42m..46m`）に大きな暗い長方形プレートが宙に浮いて見えていた。
   - **原因**: `apps/web/src/city/tokyoStationMap.ts` の `buildExpandedUrbanBuildings` で、`baseMesh` と `towerMesh` に `lodDetailTier = "high"`、`crownMesh`（塔屋・屋上スラブ）に **`lodDetailTier = "medium"`**、未使用の `proxyMesh`（`visible = false`）に `lodDetailTier = "low"` を付与していた。`applySubtreeLodTier` が `medium` 距離帯（`135m < dist <= 235m`）で `"high"` を非表示・`"medium"` を表示とするため、**基壇とタワー本体だけが消えて屋上スラブ（`crownMesh`）のみが空中に残存**していた。
2. **道玄坂上の実在 PLATEAU 建物群へのプロシージャルビルめり込み**
   - `exp-bldg-shoto-heights`（`(-1045, 195)`、高さ 46m）が実在の渋谷 PLATEAU タイル `PlateauTile_data155` に重なっており（重複頂点 309 点）、近距離（`v3_04c`）では窓のない無地の巨箱が道玄坂沿道ビルにめり込み、中距離では上記 1 の宙浮きスラブの発生源となっていた。同様に `exp-bldg-yamate-shinsen-center`（`(-1290, 90)`）も PLATEAU 側と重複（102 点）していた。
3. **中央分離帯の看板（ゼブラ板）・街路樹帯・合流部標示の違和感**
   - 片面ポリゴンだった中央分離帯の大型ゼブラ板・視線誘導標が裏側から視認できず、角度によっては浮いた看板片に見えていた。また桜丘さくら坂と玉川通り西進の合流点（`(-940, 115)`）付近の道路標示・縁石コントラストに改善余地があった。
4. **PLATEAU GLB における法線反転・宙浮き屋上ペントハウス片・道路干渉**
   - `blender/scripts/generate_shibuya_plateau.py` の道路クリップ座標系でワールド Z 軸（Blender Y 軸反転 `c_world_min_z = -c_max_y`）や `cid` 単位の法線・パリティ、切り欠き後に残る浮遊スラブ片の除去が不足していた。

---

## 2. 実施した修正内容

### 2.1 `buildExpandedUrbanBuildings` の LOD 一体化と山手通り西側への退避
- `apps/web/src/city/tokyoStationMap.ts`:
  - `baseMesh` / `towerMesh` / `crownMesh` から個別の `lodDetailTier` 指定を外し、未使用だった `proxyMesh` / `lod2ProxyMat` も削除して、丸の内ビル群やランドマークと同様に **基壇・本体・塔屋の 3 メッシュを全可視距離で一体表示（接地維持）** する構成へ統一（超高層ビルの航空障害灯 `beaconMesh` のみ遠距離軽量化で `"medium"` を維持）。
  - `exp-bldg-shoto-heights` を `(-1415, 200)`、`exp-bldg-yamate-shinsen-center` を `(-1415, 90)`（山手通り西側の PLATEAU 外ブロック、`plateauHits = 0`, `roadHits = []`）へ再配置。

### 2.2 中央分離帯・視線誘導標・合流部道路標示の改善
- `apps/web/src/roads/roadSigns.ts` / `apps/web/src/roads/roadBuilder.ts`:
  - 片面の大型ゼブラ板を廃止し、両面視認可能なコンパクトな `createMedianGuidePost(x, z)` と両面 `createDelineatorPost` へ刷新。
  - 中央分離帯上面マテリアル（`medianTopMat`）を `0xb8c2cf` に明色化し、外肩の 12m ゼブラ板を撤去、`sakurazaka-loop` × `tamagawa-west` 合流点（`(-940, 115)`）の白線トリムを整理。

### 2.3 Blender PLATEAU ビルドスクリプトの幾何整合化
- `blender/scripts/generate_shibuya_plateau.py` / `apps/web/public/models/shibuya_plateau_buildings.glb`:
  - 全 19 道路コリドーに対する 2D 三角形対曲線クリアランス判定（ワールド Z 軸符号整合 `c_world_min_z = -c_max_y`）を導入。
  - 建物単位（`cid`）の法線向き修復、ペントハウス前デシメート、5cm 量子化連結成分解析による非接地浮遊シェルの除去を実装（`data155` で 128 面の浮遊スラブ片を除去、全体で 1,729 棟・39,027 面を採用し道路重複 4,884 面をクリップ）。

### 2.4 回帰テストの追加
- `apps/web/src/tests/openWorldStreaming.test.ts`:
  - `plateauBuildingGroups`（`exp-bldg-*` を含む全建物グループ）について、`high` / `medium` / `low` 各 LOD 距離で **最下部の可視メッシュが常に接地高さ（`visibleLowestY - lowestMeshY <= 0.5`）を保ち、上部スラブだけが宙に浮かないこと** を検証するテストを追加。

---

## 3. 検証結果（Trust Signals）

- **静的検査・ビルド・全自動テスト（`just format-code && just verify-all`）**:
  - `actionlint` / `pinact run --check` / `tsc --noEmit` / `oxlint --deny-warnings .` / `ruff check` / `ruff format --check` すべてパス（エラー 0・警告 0）。
  - `vitest run`: 全 24 テストファイル・203 テスト全件パス。
  - `vite build` + `tsdown` minify 成功。
- **3D 幾何・障害物クリアランス検証**:
  - `detect_invisible_walls.ts`: 全 19 道路コリドー・16 実走行軌道（車両 OBB）で `laneBlocks = 0, pathBlockedColliders = 0`。
  - `check_all_exp_bldgs.ts`: 改修対象の渋谷西側・山手通り沿い 3 棟（`exp-bldg-shinsen-crossing`, `exp-bldg-shoto-heights`, `exp-bldg-yamate-shinsen-center`）すべて `plateauHits = 0, roadHits = []`。
  - `generate_shibuya_plateau.py --render-review`: Blender 360 度レビュー画像 55 枚を生成し目視確認。
- **本番ビルド・ライブブラウザ目視検証（`http://localhost:4173/?v=20261111_4`）**:
  - スクランブル交差点・道玄坂（sunset/day）・国道246号西進・神泉東向き・山手通り×神泉の計 7 視点で HTTP 50/50 リクエスト 200 OK、コンソールエラー 0 件。
  - スクリーンショット目視にて、道玄坂上空の宙浮きスラブ・PLATEAU めり込みボックスが完全に消失し、中央分離帯縁石・両面オレンジガイドポスト・合流白線が正常に表示されていることを確認。

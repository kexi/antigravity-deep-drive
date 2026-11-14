---
title: "渋谷ビル群テクスチャの人物・雑多ノイズ除去、PLATEAU UV モアレ解消、およびシェーダー・GLB 全面クリーン化"
tags: [graphics, architecture, open-data, roads]
trust_level: verified
date: "2026-11-11"
author: "Antigravity Agent"
summary: "渋谷エリアの建物テクスチャに映り込んでいた人物・車両・電柱架線・空・CAD 注記・緑斑点・連結コラージュ境界を一掃し、14枚の正対ファサードテクスチャ（1024x1024 JPEG）へ刷新。あわせて PLATEAU GLB の縦 3.2m 圧縮 UV モアレ、USE_MAP 上への緑被り・微細粒子ノイズ重ね掛け、Texture.anisotropy 未設定、センター街ビル屋上側面テクスチャ混入、QFRONT 文字横切り鉄骨、明治通り首都高標識の遮蔽ボックスを根本修正し、Blender マルチングル描画および本番ビルドブラウザ画面で確認した。"
---

# 渋谷ビル群テクスチャの人物・雑多ノイズ除去、PLATEAU UV モアレ解消、およびシェーダー・GLB 全面クリーン化

## 1. 背景と発見されたノイズ・アーティファクトの原因

渋谷主要建築・沿道ビル群における「人物の映り込み」および「建物表面の視覚的ノイズ」を調査した結果、単一原因ではなく以下の 4 層の複合要因が重なっていた。

1. **テクスチャ素材自体への人物・街路ノイズ混入（14枚）**
   - ストリートビュー由来の歩行者・自転車・車両の映り込み（`shibuya_qfront.jpg`, `shibuya_109.jpg`, `shibuya_magnet.jpg`, `shibuya_toei_bic.jpg`, `shibuya_commercial_facade.jpg`, `shibuya_dogenzaka_commercial.jpg`, `shibuya_mark_city.jpg`）。
   - 電柱・架空線・配電箱・空・隣接ビルの混入、上下 2 段コラージュの継ぎ目線、CAD 立面注記（`L1–L4`、`1:200` 等）・黄色住所キャプション・プレースホルダ文字列・ぼやけた緑塗料ブロブ（`shibuya_scramble_square.jpg`, `shibuya_billboards.jpg`, `shibuya_miyashita_park.jpg`, `shibuya_stream.jpg`, `plateau_lod2_storefront.jpg`, `plateau_lod2_facade.jpg`）。
2. **PLATEAU GLB の UV スケール過圧縮によるモアレ・縞ノイズ**
   - [`blender/scripts/generate_shibuya_plateau.py`](../blender/scripts/generate_shibuya_plateau.py) で壁面 UV スパンが `span_v = 3.2m` 〜 `3.6m` に設定されており、4 階建てモジュールを 1 階分の高さに押し潰してタイル反復させていたため、遠中距離で強いモアレ・ちらつきが発生していた。
3. **Three.js シェーダーの `#ifdef USE_MAP` 重ね掛けノイズと異方性フィルタ欠落**
   - [`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts) の建物シェーダーが `USE_MAP` 有効ファサードにも `treeFoliageReflection`（緑色の汚れ状反射）および高周波 3D ノイズ `archVolMicro` を加算していた。
   - [`apps/web/src/textures/shibuyaTextureManager.ts`](../apps/web/src/textures/shibuyaTextureManager.ts) でブラウザ読み込み側テクスチャに `texture.anisotropy = 8` が設定されていなかった。
   - `CenterGaiCommercialBuilding_*` の天面（`+Y/-Y`）に壁面テクスチャが横向きに貼られ、側面 UV も縦反復されず引き伸ばされていた。また PLATEAU GLB マテリアル適用分岐で `PlateauStorefront` のバインドが欠落していた。
4. **渋谷ストリーム・QFRONT・109・首都高標識 GLB の形状・UV 干渉**
   - [`blender/scripts/generate_shibuya_stream.py`](../blender/scripts/generate_shibuya_stream.py) で、明治通り高架側面の `ShutokoHighwayGreenSign` 前面に無地ボックス（`mat_idx=5`, `mat_idx=0`）が突出して標識を遮蔽していた。
   - `QFRONT` の水平鉄骨が `"QFRONT"`・`"SHIBUYA"` 文字を横切り、`add_box` が屋上面にも壁面ファサードを貼り、`Shibuya109Crown` 看板パネルが扁平に歪んでいた。

---

## 2. 実施した対策

### 2.1 正対・無人物・ノイズフリー建物テクスチャへの全面刷新（`1024x1024` JPEG）

- [`apps/web/public/textures/shibuya/`](../apps/web/public/textures/shibuya/) のうち、`plateau_lod2_roof.jpg` を除く 14 枚を、人物・車両・電柱架線・空・CAD 注記・不自然なブロブを含まない正対建築ファサードテクスチャへ置換・整形。
- `shibuya_toei_bic.jpg` は上映作品枠のプレースホルダ括弧文字を `"SHIBUYA ROADSHOW • SCREEN 1 · 2 · 3"` に修正。
- `shibuya_miyashita_park.jpg` は上部パーゴラ背後の白い空切り抜き隅を暗色打放しコンクリート背景へ差し替え、空抜き白枠を解消。
- `plateau_lod2_storefront.jpg` は 4×4 ライムストーン＋ブロンズ枠ガラス店舗グリッドに刷新し、ぼやけた緑斑点を除去。
- `shibuya_shutoko_sign.jpg` は横長高架プレートで文字が潰れないよう横方向約 `0.45×` 事前圧縮した高精細 `"首都高 3 / 出口 303 EXIT / 渋 谷 SHIBUYA / 六本木・霞が関 ROPPONGI・KASUMIGASEKI"` 標識を作成。

### 2.2 UV スケール正規化・GLB 形状修正・再エクスポート

- `blender/scripts/generate_shibuya_plateau.py`: 壁面 UV スパンを `(12.0, 3.2)` / `(6.0, 3.4)` / `(6.0, 3.6)` から `(16.0, 14.0)` / `(16.0, 14.0)` / `(16.0, 14.4)` へ変更（1 層あたり約 `3.5m` の実寸モジュールに整合）し、1,729 棟分の `apps/web/public/models/shibuya_plateau_buildings.glb` を再出力。
- `blender/scripts/generate_shibuya_stream.py`:
  - 高架側面の遮蔽ボックス（`mat_idx=5/0`）を削除し `ShutokoHighwayGreenSign` の視認性を確保。
  - `add_box` に `FACADE_WALL_MAT_INDICES` 屋上キャップ上書き（`cap_mat_idx`、既定 `2` `StreamDarkVoidSteel`）と `REPEATABLE_FACADE_MAT_INDICES = {16, 19, 26}` の整数タイル反復（`16m × 14m`）を導入。
  - `QFRONT` 水平枠高さを `[7.0, 14.2, 39.0, 45.4]` に調整して `"QFRONT"`・`"SHIBUYA"` 文字との重なりを解消し、`Shibuya109Crown` を `z = 29.0`・`(0.4, 15.0, 18.0)` に正規化。`apps/web/public/models/shibuya_stream.glb` を再出力。

### 2.3 Three.js シェーダー・フィルタリング・マテリアル修正

- `apps/web/src/textures/shibuyaTextureManager.ts`: `getOrCreateTexture` 内でブラウザ分岐と Node ヘッドレス `DataTexture` フォールバックの両方に共通で `texture.anisotropy = 8` を設定。
- `apps/web/src/city/tokyoStationMap.ts`:
  - `treeFoliageReflection` と `groundWarmReflection` を `#else`（`#ifndef USE_MAP`）へ限定し、`#ifdef USE_MAP` 内の `archVolMicro` 粒子ノイズを除去して 160m 未満の控えめな `mix(0.97, 1.02, archVolMacro.r)` のみ維持。
  - `CenterGaiCommercialBuilding_*` の天面に `PlateauLod2RoofMat` を割り当て、側面 UV の縦方向反復（`Math.max(1, Math.round(bConf.h / 14.0))`）を追加。
  - `applyShibuyaPlateauGlbMaterial3DTexture` に `PlateauStorefront` 分岐を追加し `"plateauLod2Storefront"` をバインド。
- [`apps/web/src/tests/buildingTexture.test.ts`](../apps/web/src/tests/buildingTexture.test.ts): `anisotropy === 8`、`PlateauStorefrontMat`、`USE_MAP` シェーダー保護、および `CenterGaiCommercialBuilding_*` 屋上面・UV 検証テストを追加。

---

## 3. 検証結果（Trust Signals）

- **全テクスチャ画像目視確認**: `apps/web/public/textures/shibuya/*.jpg` 15 枚すべてを確認し、人物・車両・電柱架線・空抜き・文字化けがないことを確認。
- **Blender レンダリングレビュー**: `shibuya_stream.glb` および `shibuya_plateau_buildings.glb`（1,729 棟）のマルチアングル描画を目視確認。
- **単体テスト (`buildingTexture.test.ts`)**: `9/9 passed`。
- **本番プレビューブラウザ実画面確認 (`http://localhost:4173/`)**:
  - ライブプレビューにて QFRONT、SHIBUYA109、MAGNET、渋谷TOEI/ビックカメラ、渋谷ストリーム/宮益坂、道玄坂上、渋谷センター街、宮下パーク方面をスクリーンショット撮影し、`read_file` で直接目視確認（コンソールエラー `0` 件、HTTP エラー `0` 件）。人物ノイズ・緑ブロブ・UV モアレ・屋上横向き店舗が解消されていることを確認した。

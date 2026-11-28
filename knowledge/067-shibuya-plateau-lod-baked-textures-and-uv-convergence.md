---
title: 渋谷PLATEAU建築の3D-to-LODテクスチャベイク基盤・整数スパンUV同期・夜間窓専用発光収束
tags:
  - graphics
  - open-data
  - architecture
trust_signals:
  verified_date: 2026-11-28
  author: antigravity
  verification: "Blender 15アングル視覚収束レビュー（Pass 1→Pass 2）・実機 WebGL 昼/夕暮れ/夜ネットワーク全HTTP 200確認・vitest 全30テストファイル通過"
---

# 渋谷PLATEAU建築の3D-to-LODテクスチャベイク基盤・整数スパンUV同期・夜間窓専用発光収束

## 1. 背景と解決した課題

従来の渋谷 PLATEAU 建築物（全20リーフタイル・4,159棟）は、近景 LOD0・中景 LOD1・遠景 LOD2 で共通の汎用ファサードテクスチャを使い回しつつ、1枚のテクスチャをそのまま `emissiveMap` に兼用していたため、以下の視覚的不自然さが生じていた。

1. **建物隅・屋根際での窓途中切れ**: ワールド座標比例 UV 投影により、外壁の角や屋上直下で窓が半分に切断されていた。
2. **1F 路面店舗の上階反復**: 玄関ガラス扉・店頭看板帯が 2F〜5F へ繰り返し貼付されていた。
3. **傾斜地での壁下端 UV 引き伸ばし**: 道玄坂等の斜面で地面下まで壁頂点を引き下げた際、1F 壁のテクスチャが縦に引き伸ばされていた。
4. **勾配屋根への陸屋根柄貼付**: 低層住宅の寄棟屋根（1,319棟）に陸屋根防水パネル柄が貼られていた。
5. **夜間の壁面・屋上誤発光**: アルベド画像を `emissiveMap` に流用したため、夜間にコンクリート外壁・マリオン・屋上まで薄く発光していた。
6. **LOD 間（LOD0 → LOD1 → LOD2）の質感断絶**: LOD1 簡略躯体で 3D 庇・マリオンの陰影が欠落し、遠景 LOD2 でモアレが発生していた。

---

## 2. Blender 3D-to-LOD テクスチャベイク基盤

[`blender/scripts/generate_building_lod_textures.py`](../blender/scripts/generate_building_lod_textures.py) を新設し、Blender 上に実寸の 3D 建築ファサードリグ（4スパン × 4層、完全周期シームレス）と屋根リグを構築して正射影ベイク（`AgX` アルベドパス + `Standard` 夜間窓専用発光マスクパス）で全 19 枚の多段階 LOD テクスチャを生成した。

- **LOD0 (`1024×1024` / 屋根 `512×512`)**:
  - `plateau_lod0_glass.jpg`, `plateau_lod0_commercial.jpg`, `plateau_lod0_storefront.jpg`, `plateau_lod0_alley.jpg`, `plateau_lod0_roof.jpg`, `plateau_lod0_pitched_roof.jpg`
  - 窓ガラス内室のみを発光させ壁・サッシ・庇・ブラインドを完全黒 `(0,0,0)` とした専用発光マスク `plateau_lod0_*_emissive.jpg` (`512px`)
- **LOD1 (`512×512` / 屋根 `256×256`)**:
  - LOD0 建築リグに **3D 突出スパンドレル庇（2階毎）と 3D 構造マリオン柱（2スパン毎）** を付加し、斜め太陽光陰影ごと正射影ベイク（`plateau_lod1_glass/commercial/alley/roof.jpg` + `*_emissive.jpg`）。
- **LOD2 (`256×256` / 発光 `128×128`)**:
  - LOD1 テクスチャからボックスダウンサンプリング＋対モアレ事前フィルタリングで直接縮約（`plateau_lod2_proxy.jpg`, `plateau_lod2_proxy_emissive.jpg`）。

### 実装上の重要知見（Blender 5.0）
- `mesh.materials.clear()` を呼ぶと全ポリゴンの `material_index` が `0` にリセットされ、マルチパス発光ベイクが真っ黒になる。必ず `mesh.materials[idx] = emissive_mat` でスロットをインプレース置換すること。
- `AgX` 有効状態で NumPy 配列から `img.save_render()` すると二重トーンマップが掛かるため、配列保存直前に `view_transform = "Standard"`, `exposure = 0.0` へ明示リセットすること。

---

## 3. 整数窓スパン UV 同期と傾斜地基礎スカート

[`blender/scripts/generate_shibuya_plateau.py`](../blender/scripts/generate_shibuya_plateau.py) を刷新し、全 4,159 棟へ以下を適用した。

1. **平面統合後（`dissolve_limit` 後）の整数スパン・整数階高 UV (`_assign_integer_bay_wall_uvs`)**:
   - 各統合外壁面の幅 `wlen`・高さ `wh` から `n_bays = max(1, round(wlen / target_bay_w))`, `n_floors = max(1, round(wh / target_floor_h))` を算出し、`u ∈ [0, n_bays * 0.25]`, `v ∈ [0, n_floors * 0.25]` へ厳密正規化。建物角・屋根際の窓途中切れを根絶し、3D 庇・ピラスターも同一グリッドへ 1px の狂いなく同期させた。
2. **1F 路面店舗の独立分離 (`MAT_STOREFRONT`)**:
   - 上階外壁から店舗柄を排除し、1F 地上帯（`0.38m..canopy_z0`）へ整数店舗スパンの専用ショーウィンドウを配置。庇を `exact_floor_h - 0.12` へ揃えて 2F 窓との干渉を解消した。
3. **独立基礎スカート (`_add_foundation_skirts`)**:
   - 斜面での壁底面引き下げによる UV 引き伸ばしを廃止し、`z = -3.5..0.08m` の専用ダークコンクリート基礎スカートを追加＋建物全体を一様 `+ty` 平行移動することで、道玄坂・宮益坂の急勾配でも UV 歪みゼロを実現した。
4. **寄棟勾配屋根専用マテリアル (`MAT_PITCHED_ROOF`) & パラペットコーナー閉合**:
   - 寄棟屋根全 4 傾斜面へ軒平行 UV のスレート瓦テクスチャを適用し、90° パラペット・コーニス両端を `+0.14m / +0.24m` 延長して隅欠けを完全解消した。

---

## 4. 収束レビューと Three.js ランタイム統合結果

- **Blender ジオメトリ & 監査結果（Pass 2 収束後）**:
  - LOD0: `959,022 tris` / LOD1: `124,428 tris` (**-87.0%**, 4系統マルチマテリアル `PlateauMidTile_*` `midGroup` 切替) / LOD2: `35,180 tris` (**-96.3%**)
  - 道路監査: **`LOD0 Roadway intrusions: 0 | Sidewalk outer-edge intrusions: 0`**
- **実機 WebGL 検証（昼・夕暮れ・夜）からの収束補正（Pass 3）**:
  - 1F 路面店舗の夜間 `emissiveIntensity` が `1.45` × 飽和黄 `0xfef08a` で白飛び気味だった点と、LOD1 (`1.15`)・LOD2 (`0.90`) が遠景フォグ下で LOD0 (`1.35–1.40`) より暗く落ち込む段差を検出。
  - [`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts) および [`apps/web/src/textures/shibuyaTextureManager.ts`](../apps/web/src/textures/shibuyaTextureManager.ts) にて、中立暖色乗算（`0xfff0d4` / `0xfff2dc` / `0xe6f1ff`）および LOD0 Storefront `0.95`・LOD0 上階 `1.14–1.15`・LOD1 `1.16–1.18`・LOD2 `1.16` へ統一補正した。

---
title: 渋谷PLATEAU全4,159棟のBlender 3D建築モデリング・3段階距離LOD・Draco配信最適化
tags:
  - graphics
  - open-data
  - architecture
  - physics
trust_signals:
  verified_date: 2026-11-28
  author: antigravity
  verification:
    - "Blender 4パス360度・近景・3段階LOD比較レビュー（Pass 1〜4）にて浮遊・めり込み・屋上窓柄・傾斜地ズレの全解消を視覚確認"
    - "全908,933三角形に対する19幹線道路・歩道外縁クリアランス監査で車道侵入0件・歩道外縁侵入0件を確認"
    - "just format-code / just verify-all / just build-pages / just build-app 全通過および実ブラウザWebGLでのDracoデコード・近景3Dディテール・遠景LOD表示を確認"
---

# 渋谷PLATEAU全4,159棟のBlender 3D建築モデリング・3段階距離LOD・Draco配信最適化

## 1. 背景と課題

従来の渋谷エリア PLATEAU 建築物（`apps/web/public/models/shibuya_plateau_buildings.glb`）は、実測フットプリントから立ち上げた直方体プリズム（LOD1 箱型躯体）へ窓テクスチャを貼る構成であり、以下の課題があった。

1. **近景での立体感不足**: 走行中に間近で見る沿道ビルが平坦な箱にテクスチャを貼っただけの表現となり、1F 路面店舗の庇・隅柱・階層スパンドレル・垂直マリオン・屋上パラペット・機械室ペントハウス・低層住宅の勾配屋根といった実建築の立体陰影が欠けていた。
2. **中距離 LOD の未分離**: 135m〜235m の中距離帯（`medium`）でも近景と同じ高精細メッシュ＋マルチマテリアルを描画していたため、近景ビルを本格的に 3D モデリングすると GPU 頂点負荷・ドローコール・配信容量が急増する。
3. **遠景プロキシ屋上への窓柄混入**: 単一マテリアルで生成した遠景プロキシ（`PlateauProxyTile_*`）の屋根面に外壁窓テクスチャがそのまま貼られ、高台や坂道から見下ろした際に LOD0 と視覚的乖離が生じていた。

## 2. アーキテクチャ設計

### 2.1 Blender 3D 建築モデリング（`blender/scripts/generate_shibuya_plateau.py`）

全 20 リーフタイル（4,159 棟）の LOD0 メッシュ（`PlateauTile_*`, 7 PBR マテリアル）に対し、4×4 グリッド外壁テクスチャ（`plateau_lod2_facade.jpg` / `plateau_lod2_storefront.jpg`）の階高（`floor_h = span_v / 4`）および窓スパン（`bay_w = span_u / 4`）と数学的に厳密同期した 3D 建築ディテールを造形した。

- **1F 路面店舗ポディウム**:
  - 基礎幅木キックプレート（`MAT_DARK_FRAME`, `allow_skirt=True` で傾斜地スカートと無縫接合）
  - 1段大判ショーウィンドウ（`MAT_STOREFRONT`, `v_range=(0.01, 0.24)`, `allow_skirt=False` で UV 地中伸縮を防止）
  - 1F コロネード隅柱（`MAT_ARCH_TRIM`, `allow_skirt=True` で急勾配斜面でも浮遊ゼロ）
  - 3D 突出エントランス庇・キャノピー（突出量 `0.24〜0.31m`、全 20 幹線道路クリアランスへ事前 `+0.35m` マージンを確保）
- **外壁立体構造**:
  - テクスチャ階高に厳密一致する水平スパンドレル帯・バルコニー庇（窓ガラス中央を絶対に横切らない）
  - テクスチャ窓目地に厳密一致する垂直アルミマリオン・構造柱（`MAT_ARCH_TRIM` / `MAT_DARK_FRAME`）
- **屋上シルエット・住宅屋根**:
  - 実屋上端（`abs(z_hi - true_top_z) <= 0.35`）に限定した最上階コーニス＋屋上立ち上がりパラペット壁
  - 2段機械室ペントハウス＋ダーク笠木＋HVAC 冷却塔ルーバー＋高層通信マスト
  - 低層住宅（`3.2m <= h <= 10.5m`, `18〜175m²`, 4〜8 頂点ポリゴン）へ最小面積配向矩形（OBB）ベースの日本式寄棟（よせむね）勾配屋根（`MAT_ROOF` マットスレート調、全 1,319 棟）を造形

### 2.2 真の 3 段階距離 LOD と頂点カラー単一ドローコール化

全 20 タイルそれぞれに 3 種類の専用メッシュ（計 60 メッシュ）を単一 GLB へ格納し、`TokyoStationMap.updateDistanceCulling()` で距離別に動的切替する。

| LOD 階層 | 距離帯 | GLB ノード名 | 20 タイル合計三角形数 | 削減率 | Draw Call / タイル | 影 (`castShadow`) | 特徴・用途 |
| :--- | :--- | :--- | ---: | ---: | ---: | :---: | :--- |
| **LOD0（近景）** | `<= 135m` | `PlateauTile_*` | 908,933 | 基準 | 6〜7 | ON | 本格 Blender 3D 建築ディテール（常時 1〜3 タイルのみ有効） |
| **LOD1（中景）** | `135m < d <= 235m` | `PlateauMidTile_*` | 82,115 | **-91.0%** | **1** | OFF | 軽量躯体＋頂点カラー `COLOR_0`（棟別色調＆暗色無地屋上）。Rapier Trimesh コライダー生成元も兼用 |
| **LOD2（遠景）** | `235m < d <= 800m` | `PlateauProxyTile_*` | 35,180 | **-96.1%** | **1** | OFF | 5 面箱型スカイライン＋頂点カラー `COLOR_0`（棟別色調＆暗色無地屋上） |
| **Culled** | `> 800m` | 非表示 | 0 | -100% | 0 | OFF | 完全非表示 |

- **LOD1/LOD2 の屋上窓柄解消（ゼロ追加ドローコール）**: `COLOR_0` 頂点カラーを付与し、外壁面は各ビルのマテリアル系統（青ガラス・白オフィス・暖色商業）に一致する色調を乗算する一方、屋上面は UV を暗色無地ピクセル `(0.006, 0.006)` へ集約＋暗色頂点カラーを適用した。これにより 1 ドローコールのまま屋上の窓柄と夜間誤発光を完全に排除し、LOD0→LOD1→LOD2 遷移の視覚的ポップを解消した。
- **サブメッシュ退避最適化**: マルチマテリアル分割された LOD0 サブメッシュ（6〜7 個）のうち先頭 1 個のみを LOD1/LOD2 キャリアとし、残りのサブメッシュは LOD1/LOD2 遷移時に `visible = false` としてフラスタムカリングと描画を完全スキップする。
- **物理コライダー連携**: `attachShibuyaPlateauGlbColliders` は細かな庇・マリオンを含まないクリーンな外周躯体 `PlateauMidTile_*` を優先参照し、平滑で軽量な Rapier 地上帯 Trimesh コライダーを構築する。

### 2.3 Draco メッシュ圧縮とローカルデコーダー同梱

- Blender glTF 2.0 出力時に `KHR_draco_mesh_compression`（`level=6`, position 14-bit, normal 10-bit, uv 12-bit）を有効化し、全 60 メッシュ（約 203 万頂点）を **9.86 MB** へ圧縮した。
- Three.js 同梱の Draco デコーダー（`draco_decoder.wasm`, `draco_wasm_wrapper.js`, `draco_decoder.js`）を `apps/web/public/draco/` に配置し、`DRACOLoader.setDecoderPath(assetManager.resolveAssetUrl("/draco/"))` で参照することで、オフライン環境・`localhost`・GitHub Pages サブパス（`/antigravity-deep-drive/draco/`）のすべてで外部 CDN 非依存に高速デコードできる。

## 3. Blender 4 パス 360 度収束レビューで発見・解決した主要不具合

1. **Pass 1 → Pass 2**:
   - LOD1/LOD2 屋上に外壁窓テクスチャが貼られる問題 → `COLOR_0` 頂点カラー＋屋上 UV `(0.006, 0.006)` 集約で単一ドローコールのまま完全解決。
   - 3D スパンドレル・垂直マリオンが窓テクスチャと位相ズレを起こす問題 → `floor_h = span_v / 4`, `bay_w = span_u / 4`, `u_phase` 同期へ改修。
   - 1F ショーウィンドウに 3.5 階分の小窓が圧縮される問題 → `v_range=(0.01, 0.24)` で 1 層分だけ大判展開。
2. **Pass 2 → Pass 3**:
   - 外苑東通り（`gaien-higashi`）で 4 三角形が歩道外縁へ僅かに接触 → クリアランス半径を `15.15m -> 15.55m` に拡充し **車道 0 件・歩道外縁 0 件** へ収束。
   - 1F ショーウィンドウへ `allow_skirt=True` を適用すると UV が地中 -3.5m まで引き伸ばされる問題 → 無地の基礎幅木と隅柱のみ `allow_skirt=True`、窓ガラス帯は `z >= 0.46, allow_skirt=False` に分離。
3. **Pass 3 → Pass 4（決定的根本バグ解消）**:
   - 傾斜地の段差建物でパラペットが屋根より 2m 下にめり込み、低層住宅の寄棟屋根が 2m 宙浮きする現象を接写レビューで発見。
   - 原因: Step 7b の地形標高シフトで `v.index` をキーにビル ID を引いていたが、`_sculpt_buildings_lod0` が新規作成した全 `BMVert` は `index_update()` 前に **`v.index == -1`** となるため、タイル内すべての新規 3D トリム・屋根がタイル先頭ビルの標高へ誤シフトしていた。
   - 修正: `bm.verts.index_update()` の実施に加え、`BMVert` オブジェクト自体を辞書キー化（`dict[bmesh.types.BMVert, int]`）することで衝突を構造的に根絶。さらに寄棟屋根マテリアルを金属反射のある `MAT_DARK_FRAME` からマットスレート調の `MAT_ROOF` へ変更し、Pass 4 の全 13 アングルで指摘事項ゼロの収束を確認した。

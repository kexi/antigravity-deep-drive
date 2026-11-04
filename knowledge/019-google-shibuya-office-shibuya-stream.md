---
title: 渋谷ストリーム実写ベース Blender 3Dモデリング・3Dテクスチャ・曲線道路オープンデータ統合・タイトル画面＆30fps最適化
tags:
  - graphics
  - open-data
  - roads
  - architecture
trust_signals:
  verified_date: 2026-11-03
  author: antigravity
  verification_method:
    - Wikimedia Commons 実写写真16枚（SHIBUYA STREAM 全景・アトリウム大階段・渋谷川護岸・稲荷橋広場）に基づく建築ディテール検証
    - Blender 5.0 CLI 360度マルチアングル12視点レンダリング収束レビュー（Googleロゴ完全除去・建築ディテール確認、指摘事項ゼロに収束）
    - トヨタ クラウン セダン (car.glb) 360度＋車内ドライバー視点レンダリング収束レビュー（コックピット視界遮蔽物の解消）
    - Vitest 単体テスト全通過 (16 files, 118 tests) および本番ビルド・Minification 検証 (just format-code && just verify-all)
---

# 渋谷ストリーム実写ベース Blender 3Dモデリング・3Dテクスチャ・曲線道路オープンデータ統合・タイトル画面＆30fps最適化

## 1. 実写写真検証に基づく渋谷ストリーム建築構造と Blender 3D モデリング（特定企業ロゴ非表示化）

- **実写リファレンスに基づく建築特徴の抽出**:
  - 所在地：東京都渋谷区渋谷三丁目21番3号（東急東横線旧渋谷駅高架跡地・渋谷川沿い再開発、シーラカンスアンドアソシエイツ CAt 設計、地上35階・高さ `179.95m`）。
  - **高層オフィスタワー（14F–35F）**:
    - 全面 Low-E ブルイッシュグレー・ガラスカーテンウォールに、フロアごとに千鳥配置（スタッガード）された白色アルミ押出成形の水平・垂直ルーバーフィンが走る特有のグリッドファサード。
    - 北西コーナー（明治通り・稲荷橋広場側）に垂直リセス（ガラスのスリット状くびれ）と最上部ヘリポート・メカニカルルーバークラウンを備える。
  - **中層テラス・スカイロビー（4F–13F）**:
    - 明治通り・稲荷橋広場に向かって階段状にせり出すステップド・ポディウムと、緑化された空中庭園テラス、および東急東横線旧高架橋のモチーフを継承した溶融亜鉛めっき鋼（ガルバナイズドスチール）のピロティ柱列。
  - **低層商業・大階段アトリウム（1F–3F）と渋谷川プロムナード**:
    - 1F 稲荷橋広場から 3F 歩行者デッキへ直結する大階段（Grand Staircase）と、アンバー暖色の木目ルーバー天井、杉板本実（ほんざね）型枠打ち放しコンクリート護岸、植栽プランター。
- **特定企業（Google）3Dロゴおよび名称表記の完全除去（訂正・更新）**:
  - 初期バージョンでは渋谷ストリーム壁面・広場に Google 4色立体チャンネル文字サインおよび UI 上の「Google オフィス」表記を配置していたが、商標・ブランド中立性の観点から、[`blender/scripts/generate_shibuya_stream.py`](../blender/scripts/generate_shibuya_stream.py) より 3D ロゴ造形および専用マテリアルを完全除去し、純粋な「渋谷ストリーム（SHIBUYA STREAM）」建築モデルとして [`apps/web/public/models/shibuya_stream.glb`](../apps/web/public/models/shibuya_stream.glb) を再生成した。
  - 併せて、UI（日/英/中 i18n 辞書）、道路案内標識、オープンデータ建物名称・道路名称、車内ナビゲーション表記からも「Google」「Google オフィス」をすべて「渋谷」「渋谷ストリーム」へ統一し、デフォルトの初期走行エリアを渋谷（`"shibuya"`）に設定した。
- **360度マルチアングル収束レビュー**:
  - Blender 5.0 CLI で全12アングル（正面・背面・左側面・右側面・斜め4方向・俯瞰・ドライバーアイレベル・大階段接写・高層クラウン接写）のレンダリングを実施し、2F/3Fデッキの大階段切り欠き貫通、ルーバーフィンの整列、およびロゴ除去後のファサード美観を視覚確認して指摘事項ゼロに収束させた。

## 2. 3D プロシージャル・ボリュームテクスチャ (`Data3DTexture` / `sampler3D`)

- **Blender 側 3D シェーダーノード**:
  - [`blender/scripts/generate_3d_pbr_textures.py`](../blender/scripts/generate_3d_pbr_textures.py) に `create_shibuya_stream_3d_material()` を実装し、オブジェクト空間の3D座標（`Texture Coordinate -> Object`）と 3D Noise / Wave / Voronoi を組み合わせた異方性ヘアライン・アルミフィンとガルバナイズド鋼フレームの 3D PBR マテリアルを構築。
- **Three.js 側 WebGL2 `sampler3D` ボリュームシェーダー統合**:
  - [`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts) の `applyShibuyaStreamGlbMaterial3DTexture()` にて、GLB 内のマテリアル（`StreamWhitePanel`, `StreamCurtainGlass`, `StreamDarkVoidSteel`, `StreamGalvanizedFrame`, `StreamVerticalGreen`, `StreamYellowAccent`, `WarmPlazaGlow`, `BeaconRed`）をマテリアル名で厳密に振り分け、`onBeforeCompile` で 3D ボリュームテクスチャ（`uArchVolumeTex` / `uPropVolumeTex`）をバインド。
  - ワールド3D座標 `vArchWorldPos` から 3D トリリニアサンプリングを行い、以下の実写質感を UV シーム無しで表現：
    - **白色アルミフィン (`StreamWhitePanel`) & 溶融亜鉛めっき鋼 (`StreamGalvanizedFrame`)**: `anodized_metal` モードによるブラッシュドヘアライン・スパングル粒子と法線マイクロバンプ。
    - **ダーク鉄骨・杉板本実コンクリート (`StreamDarkVoidSteel`)**: `cast_iron` モードによる砂型ディンプル・打放しコンクリートの微細凹凸。
    - **垂直壁面緑化 (`StreamVerticalGreen`)**: `white_granite` モードによる非金属（`metalness = 0.02`）の有機的な立体陰影・法線ゆらぎ。
    - **カーテンウォールガラス (`StreamCurtainGlass` / `WarmPlazaGlow`)**: `curtain_glass` モードによるフロア単位のガラスパネル微小たわみと暖色オフィス室内発光。

## 3. オープンデータ（国土地理院 GIS × PLATEAU）を活用した曲線道路（Catmull-Rom スプライン）と渋谷デフォルト化

- **曲線道路メッシュ＆物理コライダー生成（[`apps/web/src/roads/roadBuilder.ts`](../apps/web/src/roads/roadBuilder.ts), [`apps/web/src/openData/gsiPlateauLoader.ts`](../apps/web/src/openData/gsiPlateauLoader.ts)）**:
  - 従来の直線セグメントのみの道路網に加え、国土地理院 道路中心線（`experimental_rdcl`）のポリライン座標列をもとに `THREE.CatmullRomCurve3` で滑らかに補間する `RoadBuilder.buildPolylineSegment()` を実装。
  - 以下の4本の曲線道路コリドーをオープンデータから生成し、車道リボンメッシュ・歩道・縁石（3Dテクスチャ適用）・破線レーンマーク・水たまりシェーダー・分割ボックス物理コライダー・車内ナビ曲線描画を統合：
    1. **さくら坂・渋谷ストリーム南ループ（渋谷区道・曲線区間）** (`533935-shibuya-rdcl-sakuragaoka-curve`)
    2. **明治通り（並木橋〜恵比寿 S字曲線区間）** (`533935-shibuya-rdcl-meiji-south-curve`)
    3. **明治通り（宮下公園〜原宿 曲線区間）** (`533935-shibuya-rdcl-meiji-north-curve`)
    4. **内堀通り・皇居外苑パレスサイド曲線区間** (`533946-rdcl-kokyo-gaien-curve`)
- **デフォルト走行エリアの渋谷化**:
  - 起動時のデフォルトエリアを `"shibuya"`（渋谷ストリーム前の明治通り北行き車線 `x = -745, z = -110`）に変更し、`?area=tokyo` 指定時または HUD / タイトル画面のエリア選択で東京駅・丸の内エリアへ切り替え可能とした。

## 4. 車内コックピット視界遮蔽の解消・タイトル画面＆ローディング表示・30fps パフォーマンス最適化

1. **車内ドライバー視点の視界遮蔽（埋まり）解消（[`blender/scripts/generate_vehicle_model.py`](../blender/scripts/generate_vehicle_model.py), [`apps/web/src/vehicle/carModel.ts`](../apps/web/src/vehicle/carModel.ts)）**:
   - ドライバーカメラ（`x = -0.38, y = 1.15, z = 0.08`）の直前・周辺で視界に干渉していたダッシュボード上端（`y = 0.99m → 0.91m`）、メーターフード（`y = 1.075m → 0.985m`）、ステアリングコラム＆リム位置、運転席シートバック＆ヘッドレスト位置（後退配置）、およびセンター12.3インチナビディスプレイ位置（`y = 1.01m → 0.955m`）を Blender 側と Three.js 側の双方で改修し、車内視点でパーツが埋まらずクリアな前方視界と計器・ナビ視認性を両立させた。
2. **タイトル画面・ローディングプログレスバーの実装（[`apps/web/index.html`](../apps/web/index.html), [`apps/web/src/main.ts`](../apps/web/src/main.ts), [`apps/web/src/core/i18n.ts`](../apps/web/src/core/i18n.ts)）**:
   - フルスクリーン・グラスモーフィズムのタイトルオーバーレイ（`#title-screen-overlay`）を実装し、6段階の初期化工程（物理エンジン → 都市オープンデータ → 3D建築＆道路 → 車両＆コックピット → 空・雲・大気シェーダー → 準備完了 100%）をリアルタイム表示するプログレスバー、開始エリア選択（渋谷 [デフォルト] / 東京駅・丸の内）、言語切替（JA / EN / ZH）、および「ドライブを開始 (START DRIVE)」ボタン（`Enter` / `Space` キー対応）を追加した。
3. **30fps 以上で安定プレイするための描画パイプライン最適化（[`apps/web/src/main.ts`](../apps/web/src/main.ts), [`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts), [`apps/web/src/vehicle/carModel.ts`](../apps/web/src/vehicle/carModel.ts)）**:
   - 街灯ポール・ガードレール・道路標識等の小プロップの `castShadow` を無効化してシャドウパスのドローコールを大幅削減。
   - ルームミラー（背面カメラ）レンダーパス時に `renderer.shadowMap.autoUpdate = false` でシャドウマップ再生成を抑止し、`mirrorCamera.far` を `90m` に最適化。
   - メイン太陽光のシャドウマップ更新周期を4フレームに1回へ間引き、さらに FPS が `32fps` を下回った際に自動でピクセル比（DPR）とミラー更新頻度を動的調整する Adaptive Resolution Governor を実装した。


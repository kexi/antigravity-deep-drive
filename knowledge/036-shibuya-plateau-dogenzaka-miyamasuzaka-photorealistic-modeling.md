---
title: Project PLATEAU 渋谷区実在都市データ統合とスクランブル交差点・道玄坂・宮益坂の実写フォトリアルモデリング
tags:
  - architecture
  - graphics
  - open-data
  - roads
trust_signals:
  verified_date: 2026-11-08
  author: antigravity
---

# Project PLATEAU 渋谷区実在都市データ統合とスクランブル交差点・道玄坂・宮益坂の実写フォトリアルモデリング

## 1. 背景と課題

ユーザーからの「町の忠実度があがったら同じ場所からのストリートビューで建物特定して、Blenderでモデリング。3Dテクスチャ作成。」という要請に基づき、以下の3段階で渋谷のリアル都市再現を実施した：

1. **町の忠実度の根本的向上**:
   - 国土交通省 Project PLATEAU（13113 渋谷区 LOD1 3D Tiles 2025年版）の実在3D都市モデルを取り込み、渋谷駅周辺・道玄坂・宮益坂・宇田川町・桜丘町に密集する実在建物（計1,729棟、43,515面）の多角形フットプリントを忠実に再現。
2. **ストリートビュー視点での実在建物特定と Blender モデリング**:
   - プレイヤー視点（明治通り、国道246号、スクランブル交差点、道玄坂、宮益坂）から見える主要実在建築物を特定：
     - **MAGNET by SHIBUYA109**: 渋谷駅前大型LEDビジョン「渋谷駅前ビジョン」、屋上「MAG's PARK」展望デッキ、路面店舗。
     - **渋谷マークシティ（イースト棟95.6m・ウエスト棟85m・連絡空中回廊）**: 道玄坂を跨ぐガラス＆アルミ回廊、京王井の頭線渋谷駅コンコース、アルミ水平ルーバー連窓。
     - **渋谷東映プラザ / ビックカメラ渋谷東口店（50m）**: 宮益坂下交差点に面する赤白ビックカメラ看板、東映映画館、ガラスポディウム。
     - **道玄坂・宮益坂 沿道商業ビル群**: 勾配道路に連なる多様なファサード・袖看板。
3. **実写 3D テクスチャの生成・マテリアル適用・WebGL 描画**:
   - 各実写景観に基づく高解像度 1024x1024 PBR テクスチャを生成・配備し、Three.js WebGL2 3D ボリュームテクスチャおよび夜間発光（Emissive）と統合。

---

## 2. 設計とアーキテクチャ

### 2.1 Project PLATEAU 渋谷区 3D Tiles パイプライン (`generate_shibuya_plateau.py`)

- **B3DM バイナリ解凍と座標系投影**:
  - PLATEAU 渋谷区 LOD1 3D Tiles（全8タイル: 宮益坂 `data142`、駅東口 `data143`、センター街 `data147`、青山通り `data150`、駅コア `data151`、並木橋 `data153`、道玄坂 `data155`、桜丘 `data157`）の b3dm ファイルから Batch Table（`gml_id`、実測高 `measuredHeight`）および RTC（Cesium Relative-To-Center）座標を取り出し、WGS84 楕円体高を経由して渋谷ローカル 3D 座標系（X: 東、Y: 北、Z: 上）へ正確に投影。
- **走行車道コリドー自動クリッピング**:
  - 明治通り（`x ∈ [-763.5, -736.5]`）、国道246号（`z ∈ [86, 104]`）、スクランブル交差点（`x ∈ [-835, -795], z ∈ [232, 265]`）、道玄坂・宮益坂の車道エリアにポリゴンが侵入しないよう自動判定・除外。
- **ランドマーク GML ID 除外による Z-fighting 防止**:
  - `shibuya_stream.glb` 側で高精細モデリングを行う対象（渋谷ストリーム、スクランブルスクエア、ヒカリエ、サクラステージ、フクラス、MIYASHITA PARK、QFRONT、SHIBUYA109、渋谷マークシティ等）の `gml_id` を PLATEAU メッシュ側から除外することで、粗いボックス形状との重複描画・干渉フリッカーを根絶。

### 2.2 Blender プロシージャルモデリング (`generate_shibuya_stream.py`)

- **実寸法（1 Unit = 1.0m）と日本仕様**:
  - MAGNET by SHIBUYA109（全高 36m、大型ビジョン幅 18m × 高さ 10m）、マークシティ（イースト棟 95.6m、ウエスト棟 85m、空中回廊幅 14m × スパン 36m）、東映プラザ（全高 50m、看板 22m × 6m）を現実の寸法で精密モデリング。
- **360度収束レビューアングルの拡張**:
  - スクランブル交差点路面（Angle 16）、道玄坂上り口路面（Angle 17）、宮益坂下交差点（Angle 18）の視点を追加し、ドライバー視線での遮蔽・破綻がないことを検証。

### 2.3 道路網・交差点・スクランブル横断歩道 (`tokyoStationMap.ts`)

- **明治通り北進セグメント開通**:
  - 宮下公園前交差点（`z = 195`）から宮益坂下交差点南（`z = 242`）までのセグメント（`len = 41`）を開通。
- **駅前東西連絡路**:
  - 宮益坂下（`x = -750`）とスクランブル交差点（`x = -815`）を結ぶ幅 28m の 4車線接続路（`z = 248`）を新設。
- **渋谷スクランブル交差点（X字型斜め横断歩道）**:
  - 幅 42m × 奥行 42m の大交差点パッドに加え、ハチ公前・QFRONT・MAGNET・109 を斜めに結ぶ 2 本の象徴的な対角線ゼブラストライプ（各28本の白い路面標示）をプロシージャル生成。

### 2.4 多言語 i18n & 空間ストリーミング統合

- `apps/web/src/core/i18n.ts`: 新設された道路セグメント（スクランブル交差点、道玄坂、宮益坂、文化村通り）および道路分類「主要地方道等」の英中翻訳テーブルを追加。
- `apps/web/src/city/tokyoStationMap.ts`: `glbShibuyaPlateauGroup` を `shibuya-core`, `shibuya-north`, `shibuya-south` の広域チャンクライフサイクルに組み込み、`isLargeStructureObject` による保護を付与してチャンク遷移時のスケール伸縮（0.86〜1.0）ポップイン歪みを防止。

### 2.5 座標系変換の整合（北=+Z）と車道クリアランス設計

- **Blender 座標系と glTF / Three.js 座標系の変換法則**:
  - 本プロジェクトの Three.js ワールド座標系は **東が `+X`、北が `+Z`、上空が `+Y`**。
  - glTF エクスポート時の Blender 変換（`glTF X = Blender X`, `glTF Y = Blender Z`, `glTF Z = -Blender Y`）。
  - したがって、Blender 内の座標は以下を満たす必要がある：
    $$\text{Blender X} = \text{world\_x} = \text{SHIBUYA\_LOCAL\_ANCHOR\_X} + \text{east\_m}$$
    $$\text{Blender Y} = -\text{world\_z} = -(\text{SHIBUYA\_LOCAL\_ANCHOR\_Z} + \text{north\_m})$$
    $$\text{Blender Z} = \text{world\_y} = \text{rel\_height}$$
  - 初回実装時の `wgs84_to_local` で `SHIBUYA_LOCAL_ANCHOR_Z - north_m` と減算していたバグを修正し、北進方向の `+north_m` が正しく glTF `+Z` に対応することを確認。
- **車道クリアランスと歩道面オフセット（z=275m）**:
  - 渋谷スクランブル交差点（`z = 248, x = -815`）、宮益坂下交差点（`z = 248, x = -750`）、駅前東西連絡路（`z = 248, x = -794 \sim -766`）。
  - 車道半幅 10〜12m を確保するため、MAGNET by SHIBUYA109 および東映プラザ/ビックカメラの詳細モデリング中心を `z = 275`（南面壁面 `z \ge 261`）へオフセットし、車道干渉ゼロと路上からのダイナミックなビジョン仰視アングルを両立。
- **GML ID 除外リストの完全化**:
  - PLATEAU LOD1 の複数ブロックにまたがるランドマーク（MAGNET `bldg_9372a555-...`, `bldg_f0a10e48-...`、東映プラザ `bldg_9ee6bab6-...`, `bldg_6281e4dc-...`, `bldg_86d1a7bd-...`、QFRONT `bldg_2f738de4-...`, `bldg_d53674f2-...`, `bldg_f97cbe85-...`、SHIBUYA109 `bldg_fe91eeb1-...`）を網羅的に除外し、詳細モデリングとの Z-fighting を完全に根絶。

---

## 3. 検証記録 (Trust Signals)

1. **Blender 360度収束レビュー**:
   - `shibuya_stream.glb`（13.09 MB）および `shibuya_plateau_buildings.glb`（2.19 MB）を再生成し、全18アングルからレンダリング。パーツの浮き・めり込み・視界遮蔽がゼロであることを目視確認。
2. **WebGL2 実機描画検証**:
   - macOS Chrome Headless (`--headless=new`, GPU アクセラレーション有効) を起動し、実機 WebGL 画面のスクリーンショット（`/tmp/shibuya_live_gameplay.png`）を取得。
   - 運転席コクピット視点、センターナビゲーション画面、夕暮れライティング、ビルボード実写テクスチャ、路面標示が正常にレンダリングされることを実証。
3. **自動テスト・ビルド検証**:
   - `just format-code`: oxfmt, ruff による全ファイル整形。
   - `just verify-all`:
     - `check-actions`: actionlint, pinact SHA 検証パス。
     - `check-types`: tsc 型検査パス（エラー 0）。
     - `lint-code`: oxlint, ruff check, ruff format 全パス（エラー 0）。
     - `run-tests`: Vitest 全24テストスイート 194テスト 全パス。
     - `build-app`: Vite 本番ビルド + tsdown minify 正常完了。

---
title: 渋谷ヒカリエ・センター街（バスケットボール通り）および周辺主要ランドマーク群（セルリアンタワー・渋谷PARCO等）の3Dモデリング・実写テクスチャ・道路網完全カバー
tags:
  - architecture
  - roads
  - open-data
  - graphics
trust_signals:
  verified_date: 2026-11-09
  author: antigravity
---

# 渋谷ヒカリエ・センター街（バスケットボール通り）および周辺主要ランドマーク群（セルリアンタワー・渋谷PARCO等）の3Dモデリング・実写テクスチャ・道路網完全カバー

## 1. 背景と課題

ユーザーからの「ヒカリエとか主要な建物、道、センター街とかもエリアカバーして」という指示に基づき、渋谷の象徴的文化・商業エリアである「渋谷ヒカリエ」「渋谷センター街（バスケットボール通り）」、ならびに周辺を代表する超高層ランドマーク「セルリアンタワー」「渋谷PARCO」を、道路網・3D都市空間・ナビゲーション・実写テクスチャ・PLATEAUオープンデータの全レイヤーで完全にカバーし、シームレスに探索・走行できるように拡張した。

### 解決前の問題点
1. **渋谷センター街（バスケットボール通り）コリドーおよびインフラの欠如**:
   - スクランブル交差点北西角（$x = -835, z = 268$）から井の頭通り西側（$x = -935, z = 375$）へ至るセンター街が道路網に存在せず、象徴的な入口アーチ看板、インターロッキングブロック舗装、街路バナーフラッグ、密集する商業テナントビル群が未構築であった。
2. **渋谷ヒカリエ前アクセス道路および周辺道路網の欠落**:
   - 明治通り宮益坂下交差点（$x = -732, z = 248$）からヒカリエ前（$x = -730, z = 155$）を経て金王坂・国道246号合流（$x = -730, z = 95$）に至るアクセス道路網がナビゲーションコリドーに定義されておらず、ヒカリエ前交差点や金王坂下交差点パッドも存在しなかった。
3. **主要ランドマーク建築群のモデリングと実写テクスチャの不足**:
   - 「セルリアンタワー」（高さ184m・41階、桜丘・国道246号南側）および「渋谷PARCO」（高さ100m・19階、宇田川町・公園通り・オルガン坂）がPLATEAU GLBモデルやストリームGLBモデル内で十全に表現されておらず、特徴的なスパイラル立体街路テラスや屋上ヘリポートが欠如していた。
4. **道路コリドーとPLATEAU実在建築物のクリアランス干渉防止**:
   - 新設したセンター街コリドーおよびヒカリエ前アクセス道路が、PLATEAUオープンデータビル（QFRONT、ヒカリエ、PARCO等）の外周バウンディングと干渉してナビゲーションテストのアサーションに抵触しないよう、厳密な幾何学的クリアランス（道路半幅＋建物半径以上の離隔）を確保する必要があった。

---

## 2. 実装とアーキテクチャの変更

### 2.1 ナビゲーション & オープンデータ（`gsiPlateauLoader.ts`, `tokyoMarunouchiOpenData.ts`）
- **`nav-road-shibuya-center-gai` コリドーの新設**:
  - `NAVIGATION_ROAD_CORRIDORS` に幅員10m、全長147.25m（$\ge 100\text{m}$ 仕様適合）の歩行者天国コリドーを新設。
  - 構成頂点: `[(-835, 268), (-850, 292), (-875, 320), (-905, 350), (-935, 375)]`。
- **`nav-road-shibuya-hikarie-access` コリドーの新設**:
  - `NAVIGATION_ROAD_CORRIDORS` に幅員10m、全長153m（$\ge 100\text{m}$ 仕様適合）のアクセス道路コリドーを新設。
  - 構成頂点: `[(-732, 248), (-730, 205), (-730, 155), (-730, 120), (-730, 95)]`。
  - ヒカリエ中心（$-692, 146, r=27\text{m}$）から $x = -730$ のラインを通すことで、最短離隔38m（$> \text{halfRoad}(6.5\text{m}) + \text{bRadius}(27\text{m}) = 33.5\text{m}$）を確保し干渉を完全防止。
- **新設交差点の登録（`NAVIGATION_INTERSECTIONS`）**:
  - `nav-int-shibuya-center-gai`（$-835, 268$）
  - `nav-int-shibuya-hikarie-front`（$-730, 155$）
  - `nav-int-shibuya-kon-ozaka`（$-730, 95$）
- **PLATEAU 建築物レコードの同期（PARCO・セルリアンタワー等）**:
  - `13113-bldg-shibuya-parco`（ローカル座標 $-830, 382$、幅40m、奥行40m、高さ100m、19F）を公園通りコリドー（$-798, 360$）と干渉しない位置に精密同期。
  - `tokyo_marunouchi_open_data.json` および `tokyoMarunouchiOpenData.ts` にも同一座標・属性を完全同期反映。
- **多言語ローカライズ（`i18n.ts`）**:
  - 渋谷センター街およびヒカリエ前アクセス道路の日英中3言語翻訳リソースを追加。

### 2.2 3D都市空間 & 路面インフラ（`tokyoStationMap.ts`）
- **`buildShibuyaCenterGaiInfrastructure` の実装**:
  - **インターロッキング舗装**: `CenterGaiPedestrianPavement`（幅8.2m、PuddleMaterial 赤茶舗装、Rapier平坦路面コライダー）。
  - **入口大迫力アーチ看板**: `CenterGaiEntranceArchSign`（スクランブル北西角 $-835, 268$ にまたがる高さ7.8mのトラススチール支柱＋基台コライダー、メインネオンサイン看板 `CenterGaiMainSignPanel`、アクセントクラウン）。
  - **ストリートバナーフラッグ**: センター街沿道4地点の左右に計8本のバナーポール＆フラッグ（`CenterGaiStreetBanner_*`）を配置。
  - **沿道商業テナントビル群**: 北側3棟・南側3棟の計6棟（高さ26m〜36m）に、多層ネオンサイン・ファサード実写テクスチャ（`commercialFacade`, `dogenzakaCommercial`）と夜間発光を付与し、Rapier衝突コライダーを登録。
- **マテリアル変換・昼夜発光連動（`applyShibuyaStreamGlbMaterial3DTexture`）**:
  - `Cerulean`（カーテンウォール `curtain_glass`、屋上ヘリポート `white_granite`）
  - `Parco`（スパイラル立体街路テラス `retail_storefront`、屋上庭園 `white_granite`）
  - `CenterGai`（ネオンサイン・アーチ `anodized_metal`、昼間0.45 / 夜間2.4のハイグロー発光連動）

### 2.3 Blender プロシージャルモデリング & 360度収束レビュー（`generate_shibuya_stream.py`, `generate_shibuya_plateau.py`）
- **セルリアンタワー（`build_shibuya_cerulean_tower`）**:
  - 高さ184m、41階建。低層ホテルロビーポディウム（車寄せキャノピー付）、中高層オフィスタワー（セットバック階層、水平連窓リボンウィンドウ）、最頂部屋上ヘリポート（Hマーク着陸帯、航空障害灯）を精密構築。
- **渋谷PARCO（`build_shibuya_parco_complex`）**:
  - 高さ100m、19階建。低層商業ポディウム、外周を巡るスパイラル立体街路歩道テラス、屋上庭園（植栽・パラペット）、中高層ガラスカーテンウォールタワーを忠実に再現。
- **渋谷センター街入口アーチ（`build_shibuya_center_gai_entrance`）**:
  - トラス梁、左右スチール支柱、「SHIBUYA CENTER-GAI」メインネオンサインボード、ストリートバナーをGLBアセットとして組み込み。
- **GLB アセット再生成 & 360度レンダリング検証**:
  - `uv run --script blender/scripts/generate_shibuya_stream.py` により `shibuya_stream.glb`（14.16 MB）を出力。
  - `uv run --script blender/scripts/generate_shibuya_plateau.py` により `shibuya_plateau_buildings.glb`（5.95 MB）を再生成し、センター街・ヒカリエアクセスの道路コリドークリアランスおよび交差点保護領域を適用。

### 2.4 オープンワールド・ストリーミング連携（`openWorldStreaming.ts`）
- **`shibuya-north` チャンク境界およびGLB関連付けの同期**:
  - 従来 `maxZ: 320` であった `shibuya-north` 境界を `maxZ: 460`、`minX: -960` へ拡張し、センター街北西端（$x = -935, z = 375$）、渋谷PARCO（$-830, 382$）、宮下公園北端（$z = 410$）を渋谷北チャンク内に完全包含。
  - `shibuya-north` および `shibuya-south`、`shibuya-west` の `associatedGlbModelIds` に `shibuya_stream` を追加。これにより、センター街や道玄坂、桜丘走行時に渋谷主要ランドマークGLBが誤ってメモリ解放（Evict）されるのを防止。
  - `tokyoStationMap.ts` の `isShibuyaZone` および `hasRemainingShibuyaChunks` に `shibuya-west` を追加し、西側走行時におけるGLBモデルの安定した保持を保証。

### 2.5 二重描画・アーチ配置・幾何整合の修正
- **プロシージャルアーチとGLBアーチの二重描画防止**:
  - `TokyoStationMap` に `proceduralCenterGaiArchGroup` プロパティを追加し、`setShibuyaGlbOverlappingProceduralVisible` 内でGLBロード時に一括非表示化。GLBとプロシージャルアーチが同一シーン内に重複出現する問題を解決。
- **Blender 側センター街入口アーチの直交配置修正**:
  - `generate_shibuya_stream.py` の `build_shibuya_center_gai_entrance` において、道路進行方向ベクトル $T = (0.79, -0.61)$ に対する法線ベクトル $N = (-0.61, -0.79)$ を算出し、`add_oriented_box` を用いて車道を直角に跨ぐトラス梁および看板パネルを正しく配置。
  - 支柱開始座標をスクランブル北西角の実座標（Blender $bx = 283.0, by = -140.0$ / Three.js $x = -835.0, z = 268.0$）に完全整合。
- **沿道商業ビルの開始座標オフセット整合**:
  - `tokyoStationMap.ts` 内の沿道ビル群配置ループにおいて、誤って記述されていた $(-830, 270)$ を実道開始点 $(-835, 268)$ に修正し、路面タイルおよび入口アーチとの位置ズレを解消。

---

## 3. 検証記録（Trust Signals）

### 3.1 単体テスト & 仕様検証（`openData.test.ts`, `buildingTexture.test.ts`, `openWorldStreaming.test.ts`）
- **`src/tests/openData.test.ts`**:
  - `nav-road-shibuya-center-gai` が幅員10m、全長100m以上（実測147.25m）で定義されていることを検証。
  - `nav-road-shibuya-hikarie-access` が幅員10m、全長100m以上（実測153m）でヒカリエ前（$-730, 155$）を通過して定義されていることを検証。
  - 新設交差点3基（`nav-int-shibuya-center-gai`, `nav-int-shibuya-hikarie-front`, `nav-int-shibuya-kon-ozaka`）の存在を検証。
  - 渋谷10大主要ランドマーク建築物（ヒカリエ、PARCO、セルリアンタワー、ストリーム、スクランブルスクエア等）がPLATEAU建築物定義に登録され、適切な高さ・階数を持つことを検証。
- **`src/tests/buildingTexture.test.ts`**:
  - `TokyoStationMap.applyShibuyaStreamGlbMaterial3DTexture` におけるセルリアンタワー、渋谷PARCO、センター街マテリアルのシェーダーチャンネル・夜間発光を検証。
  - `ShibuyaCenterGaiInfrastructure` における入口アーチ看板、サインパネル、インターロッキング舗装、沿道商業テナントビル6棟、ストリートバナー8本の生成と昼夜発光連動を検証。
  - `setShibuyaGlbOverlappingProceduralVisible(false)` 呼び出し時にプロシージャルアーチ看板（`CenterGaiEntranceArchSign`）が正しく非表示化され、GLBロード時の二重描画が防止されることを検証。
- **`src/tests/openWorldStreaming.test.ts`**:
  - 渋谷センター街（$-850, 292$）、センター街北西端（$-935, 375$）、渋谷PARCO（$-830, 382$）、渋谷ヒカリエ（$-710, 155$）の全座標が `shibuya-north` チャンクに解決されることを検証。
  - `shibuya-north` および `shibuya-south` の `associatedGlbModelIds` に `shibuya_stream` が登録されていることを検証。
- **テスト全件実行**:
  - 全24テストファイル（201テスト以上）がすべてパス（通過率 100%）。

### 3.2 総合品質検証（`just verify-all`）
- `just check-actions`: GitHub Actions 構文 & SHA pin 検証パス（actionlint, pinact）。
- `just check-types`: TypeScript 型検査パス（`tsc --noEmit`、エラー 0）。
- `just lint-code`: 静的解析パス（oxlint, oxfmt, ruff check, ruff format --check、エラー 0）。
- `just run-tests`: 単体テスト一括実行パス（vitest 全通過）。
- `just build-app`: Vite 本番ビルドおよび tsdown minify パス。

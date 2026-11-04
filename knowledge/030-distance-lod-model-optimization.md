---
title: 遠方3Dモデルの距離ベース多段階LOD（Level of Detail）軽量化アーキテクチャ
tags:
  - architecture
  - graphics
  - roads
trust_signals:
  verified_date: 2026-11-04
  author: antigravity
  verification:
    - Vitest 単体テスト (src/tests/openWorldStreaming.test.ts 内の遠方3Dモデル多段階LOD検証3スイートを含む全テスト合格)
    - Chrome DevTools MCP による window.__DEEP_DRIVE_STREAMING__.getLodStats() 実機テレメトリ検証（渋谷・東京駅エリアにおける LOD0 / LOD1 / LOD2 / Culled 遷移およびランドマークGLB⇄軽量プロキシ自動切替確認）
    - just format-code && just verify-all による型検査・Lint・単体テスト・本番ビルドの完全パス確認
---

# 遠方3Dモデルの距離ベース多段階LOD（Level of Detail）軽量化アーキテクチャ

## 1. 背景と課題

[`OpenWorldStreamingSystem`](../apps/web/src/city/openWorldStreaming.ts) による9チャンク空間ストリーミングによって未到達エリアのメモリは解放されるが、アクティブチャンク内（半径 `280m〜410m`）には依然として多数の高精細3Dモデルが存在する。
従来の実装では、描画距離内に入ったオブジェクトは `10m` 先であっても `300m` 先であっても **フルディテール（`LOD0`）かつ `castShadow = true`** で描画されていたため、以下の不要なGPUドローコール・頂点シェーダー・シャドウマップ負荷が発生していた：

1. **高層ビル群（Project PLATEAU 28棟＋渋谷14棟）**: 1棟あたり14本のカーテンウォール垂直マリオン（`mullionXMesh` / `mullionZMesh`）、1階ガラスピロティ（`storefrontMesh`）、百尺基壇コーニス（`corniceMesh`）、水平ファサード帯、屋上ヘリポート・航空障害灯が遠方でもすべて描画されていた。
2. **ランドマークGLB（`tokyo_station.glb` / `shibuya_stream.glb`）**: 数万ポリゴン＋3Dプロシージャルテクスチャを持つ高精度Blender GLBモデルが、ディテールを視認できない `185m` 以遠でもそのまま描画されていた。
3. **イチョウ街路樹（`street_tree.glb` 48本以上）**: 遠方の街路樹でも高ポリゴンGLBインスタンスや6本の副枝メッシュ（`branchMesh`）がフル描画されていた。
4. **ガードレール・信号機・路面付属物**: ガードレール1スパンあたり数十個のブラケット・ボルト・デリネーター反射板・袖ビーム・支柱キャップや、信号機の制御機箱・端子箱・取付金具・歩行者押ボタン箱、マンホール・グレーチング・点字ブロックが遠方でも描画されていた。

---

## 2. 距離ベース多段階LOD（`LOD0` / `LOD1` / `LOD2` / `Culled`）の設計

[`TokyoStationMap.updateDistanceCulling`](../apps/web/src/city/tokyoStationMap.ts)、[`RoadProps`](../apps/web/src/roads/roadProps.ts)、[`JapaneseRoadBuilder`](../apps/web/src/roads/roadBuilder.ts) にわたり、カメラ／自車位置からの最短AABB距離に応じた **4段階の階層的LODシステム** を実装した。

### 2.1 オブジェクト種別ごとの距離しきい値と軽量化内容

| アセット分類 | `LOD0` (`high`: フル精度 + 影あり) | `LOD1` (`medium`: 中距離軽量化・影OFF) | `LOD2` (`low`: 遠景シルエットのみ・影OFF) | `Culled` (完全非表示) |
| :--- | :--- | :--- | :--- | :--- |
| **ランドマーク建築** (`tokyo_station.glb` / `shibuya_stream.glb`) | `<= 185m`<br>高精度Blender GLBモデル本体を表示 | `185m < dist <= 235m`<br>GLBを非表示化し、軽量プロシージャル駅舎/渋谷ストリームProxyへ自動切替（`lodDetailTier="high"` 装飾は非表示） | `235m < dist <= 1100m`（および未ロード・Evict済みチャンク時）<br>軽量プロシージャルProxyの主要塊（赤レンガ躯体・ドーム屋根 / 高層ガラスコア）のみ表示、`castShadow = false` | `> 1100m` |
| **高層ビル群・大型水辺構造物** (PLATEAU 丸の内・大手町・渋谷 / 皇居内濠・渋谷川) | `<= 135m`<br>全メッシュ（マリオン14本・1階ピロティ・百尺コーニス・水平帯・航空障害灯）表示、`castShadow = true` | `135m < dist <= 235m`<br>垂直マリオン14本・1階ピロティ・コーニス（`lodDetailTier="high"`）を非表示、`castShadow = false` | `235m < dist <= 1100m`（および未ロード・Evict済みチャンク時）<br>水平帯・航空障害灯（`lodDetailTier="medium"`）も非表示。**基壇・高層コア・屋上の3メッシュのみ**描画（`castShadow = false`） | `> 1100m` |
| **イチョウ街路樹** (`createGinkgoTree`) | `<= 85m`<br>Blender `street_tree.glb` クローン（または全枝付きフォールバック）表示、`castShadow = true` | `85m < dist <= 165m`<br>GLBクローンを非表示化し、軽量プロシージャル木（幹＋副枝＋樹冠）へ切替、`castShadow = false` | `165m < dist <= 260m`<br>6本の副枝メッシュ（`lodDetailTier="medium"`）も非表示化し、**主幹＋樹冠の2メッシュのみ**描画 | `> 260m` |
| **防護柵（ガードレール）** (`RoadProps.applyGuardrailSlotLod`) | `<= 80m`<br>Blender `guardrail.glb` またはフル構成（Wビーム＋袖ビーム＋支柱＋キャップ＋ブラケット＋ボルト＋反射器） | `80m < dist <= 165m`<br>GLB・袖ビーム・ブラケット・ボルト・デリネーター・支柱キャップを非表示化し、**Wビーム＋円柱支柱のみ**描画 | `> 165m`<br>支柱グループも非表示化し、**連続Wビーム単一メッシュ（1メッシュ）のみ**描画 | 道路チャンク解放時 |
| **信号機** (`createTrafficLight`) | `<= 80m`<br>フランジ・制御機箱・端子箱・アーチブレース・金具・歩行者押ボタン箱を含むフルモデル | `80m < dist <= 165m`<br>微小付属物（`lodDetailTier="high"`）を非表示化し、主柱・アーム・3色灯器・矢印灯器・歩行者灯器のみ保持 | `> 165m`<br>下部補助パイプ・矢印灯器・歩行者灯器（`lodDetailTier="medium"`）も非表示化し、**主柱＋メイン灯器＋3色LEDレンズのみ**保持 | 道路チャンク解放時 |
| **道路微細付属物** (点字ブロック・マンホール・グレーチング・標識・デリネーター) | `<= 75m`<br>点字ブロック・マンホール・グレーチング（`lodDetailTier="high"`）を含む全プロップ表示 | `75m < dist <= 160m`<br>点字ブロック・マンホール・グレーチングを非表示、道路標識・デリネーター（`lodDetailTier="medium"`）は表示 | `> 160m`<br>沿道小型標識・デリネーターも非表示化し、路面・車線標示・縁石・歩道のみ維持 | 道路チャンク解放時 |
| **街灯・御影石ボラード** (`createStreetLamp` / `buildGraniteBollards`) | `<= 85m` (ボラードは `<= 55m`)<br>ベースフランジ・頂部キャップ・反射帯を含む全メッシュ表示 | `85m < dist <= 160m` (ボラードは `55m..115m`)<br>フランジ・キャップ・反射帯を非表示 | `160m < dist <= 220m`<br>街灯ブラケットアームも非表示化し、ポール＋発光グローブのみ維持 | 街灯 `> 220m`<br>ボラード `> 115m` |

---

## 3. 実装のポイント

### 3.1 `userData.lodDetailTier` による宣言的サブメッシュタグ付け
- 各ビルダー（[`tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts)、[`roadProps.ts`](../apps/web/src/roads/roadProps.ts)、[`roadBuilder.ts`](../apps/web/src/roads/roadBuilder.ts)）でメッシュ生成時に `mesh.userData.lodDetailTier = "high"`（近距離のみ表示）または `"medium"`（中距離まで表示）を付与する。
- これにより、別々のLOD用ジオメトリを重複生成してメモリを消費することなく、単一のシーングラフ階層上でサブメッシュの `visible` と `castShadow` を切り替えるだけで **頂点数・ドローコール・シャドウパス負荷を段階的に削減** できる。

### 3.2 道路セグメント内の個別プロップ距離判定（`applyRoadSegmentSubPropsLod`）
- 直線道路セグメントや曲線道路セグメントは全長が `100m〜300m` に及ぶため、道路グループ全体のAABB距離だけでは「手前のガードレールと200m先のガードレール」を区別できない。
- そのため、自車から `165m` 以内にある道路セグメントについては [`applyRoadSegmentSubPropsLod`](../apps/web/src/city/tokyoStationMap.ts) がセグメント直下の各ガードレールスロット・信号機・マンホール・標識のワールド座標（`localPos` を道路の `rotation.y` で回転変換した位置）と自車位置の距離を個別に評価し、手前のガードレールは `LOD0`、同じ道路の120m先のガードレールは `LOD1`、さらに奥は `LOD2` へと滑らかに遷移させる。

### 3.3 変更差分スキップとテレメトリ公開（`getLodStats`）
- 各オブジェクトおよびサブグループには `userData.appliedLodTier` をキャッシュし、前フレームと同じLODティアである場合は `traverse` 走査自体をスキップする（`O(1)` 早期リターン）。
- 現在のLOD内訳（`visibleObjects`, `lod0HighCount`, `lod1MediumCount`, `lod2LowCount`, `culledByDistanceCount`, `simplifiedSubMeshCount`, `landmarkProxyActiveCount`）は `cityMap.getLodStats()` および `window.__DEEP_DRIVE_STREAMING__.getLodStats()` からリアルタイムに取得・検証できる。

### 3.4 遠方スカイライン維持（未ロード・Evict済みチャンクにおける大型構造物の `LOD2` シルエット常駐）
- 高層ビル（高さ `100m〜230m`）や大型ランドマーク（全長 `330m` の東京駅赤レンガ駅舎、高さ `180m` の渋谷ストリーム）が `maxDrawDistance`（`280m〜380m`）や空間チャンクのアンロード（`unloadedChunkIds`）で突然消滅すると、大通り（国道246号・行幸通り・日比谷通り）の見通し線上で地平線の都市スカイラインが空白になり不自然になる。
- そのため、[`CameraController`](../apps/web/src/core/cameraController.ts) の遠方クリップ面（`camera.far`）を `600m` から `1200m` へ拡張したうえで、大型構造物（`isLargeStructureObject`: PLATEAU ビル群、プロシージャル駅舎・渋谷ストリームProxy、皇居お堀・渋谷川水路、頭上案内標識ガントリー）はチャンクが未ロード／Evict済みであっても `visible = true` のまま維持し、強制的に **`LOD2`（`low`: 1棟あたり基壇・高層コア・屋上の3ボックスのみ、`castShadow = false`）** に固定して最大 `1100m`（`largeStructureMaxDist`）まで描画する。
- 一方、チャンクが Evict された際の高ポリゴンGLB（`tokyo_station.glb`, `shibuya_stream.glb`, `street_tree.glb` クローン）は従来通り `.dispose()` してメモリ解放し、小型プロップ（街路樹・街灯・ボラード・小型標識）は厳格にカリングすることで、メモリ予算とフレームレートを維持しつつ遠景の都市シルエットを途切れなく描画する。

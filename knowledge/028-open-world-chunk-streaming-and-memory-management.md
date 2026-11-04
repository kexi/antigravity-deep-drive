---
title: オープンワールド型空間チャンクストリーミングとメモリバジェット管理アーキテクチャ
tags:
  - architecture
  - graphics
  - ui
trust_signals:
  verified_date: 2026-11-03
  author: antigravity
  verification:
    - Vitest 単体テスト (src/tests/openWorldStreaming.test.ts 全8ケースおよび全20ファイル・158テスト合格)
    - Chrome DevTools MCP による渋谷初期ロード (6/9 Chunks, 154/195MB)・国道246号連続走行・東京駅⇄渋谷ワープ・スマホChrome高/中/低画質・失敗シミュレーション再試行の実ブラウザ検証
    - just format-code && just verify-all による型検査・Lint・テスト・本番ビルドの完全パス確認
---

# オープンワールド型空間チャンクストリーミングとメモリバジェット管理アーキテクチャ

## 1. 背景と設計目的

渋谷（`x ≈ -850`）から国道246号・青山通り（`x ≈ -550..-350`）を経て東京駅・丸の内・皇居外苑・有楽町（`x ≈ -250..+450`）に至る広域都市空間において、すべての高精細GLBランドマーク（[`tokyo_station.glb`](../apps/web/public/models/tokyo_station.glb)、[`shibuya_stream.glb`](../apps/web/public/models/shibuya_stream.glb)、[`street_tree.glb`](../apps/web/public/models/street_tree.glb) クローン群）および数百棟の建物・道路設備を一括で初期ロード・常駐させると、初回起動時の待ち時間増加やスマホChrome環境でのGPU/JSヒープ圧迫・フレームスパイクを招く。

そこで、オープンワールドゲームと同様の **空間チャンク分割（9チャンク）・現在地優先ローディング（Playable First）・進行方向に応じたバックグラウンド先読み（Directional Lookahead Prefetch）・距離およびメモリバジェットに基づく動的解放（LRU/Distance Eviction）・リトライ付きタイトル/ワープUI統合** を [`apps/web/src/city/openWorldStreaming.ts`](../apps/web/src/city/openWorldStreaming.ts) および [`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts) に導入した。

---

## 2. 空間チャンク分割（9チャンク構成）

都市空間全体を以下の9つのAABB空間チャンク（`WorldChunkId`）に隙間なく分割し、各建物・道路セグメント・街路樹・街灯・信号機・GLBランドマークを座標に基づいて所属チャンクへ自動バインドする：

1. `shibuya-core`: 渋谷ストリーム・明治通り中央（`x: -920..-610, z: -115..115`、`shibuya_stream.glb` 所属）
2. `shibuya-south`: 渋谷南・並木橋・桜丘ループ（`x: -920..-610, z: -320..-115`）
3. `shibuya-north`: 渋谷北・スクランブルSQ・宮下公園（`x: -920..-610, z: 115..320`）
4. `aoyama-west`: 国道246号・青山通り西（`x: -610..-465, z: -260..340`）
5. `aoyama-east`: 国道246号・青山通り東（`x: -465..-320, z: -260..340`）
6. `otemachi-west`: 大手町・永代通り・丸の内西（`x: -320..-120, z: -200..420`）
7. `marunouchi-core`: 東京駅赤レンガ・行幸通り・丸の内中央（`x: -120..125, z: -200..235`、`tokyo_station.glb` 所属）
8. `kokyo-north`: 皇居外苑・和田倉門・内堀通り（`x: -120..125, z: 235..460`）
9. `yurakucho-east`: 有楽町・馬場先門・鍛冶橋通り東（`x: 125..520, z: -200..460`）

---

## 3. 主要メカニズム

### 3.1 優先起動ローディング（Playable First）
- [`TokyoStationMap`](../apps/web/src/city/tokyoStationMap.ts) 初期化時に `{ deferGlbLoads: true }` を指定し、全エリアのGLBを一斉にフェッチするのではなく、初期スポーン位置（デフォルト渋谷、またはURLクエリ指定座標）の優先チャンクに紐づくGLB・道路・建物から順次ロードする。
- 必須チャンクの読み込みが完了した時点で `#start-drive-btn` を有効化し、遠方チャンク（例：渋谷スタート時の東京駅・皇居・有楽町）は `unloaded` のまま即座にドライブを開始できる。

### 3.2 進行方向コーン＆速度ベクトルによるバックグラウンド先読み
- [`computeChunkPriorityScore`](../apps/web/src/city/openWorldStreaming.ts) にて、車両の現在座標 `(vehicleX, vehicleZ)`、速度ベクトル `(velocityX, velocityZ)`、車体向き `headingAngleRad` から `lookaheadSeconds` 秒後の到達予測座標を算出する。
- チャンク境界ボックス（AABB）への最短距離と進行方向内積（`forwardAlignment`）を組み合わせ、走行方向前方のチャンク（例：渋谷から国道246号を東へ走る際は `aoyama-west` → `aoyama-east` → `otemachi-west` → `marunouchi-core`）の優先度スコアを引き上げ、1フレームあたりのタイムスライス予算（`frameSliceBudgetMs` / `maxChunksPerFrame`）内で段階的にバックグラウンド有効化する。

### 3.3 ポップイン抑止とプロシージャルLODプロキシ連携
- チャンクが有効化される際、`transitionAlpha` を `0 -> 1` へフレーム経過で滑らかに補間し、[`TokyoStationMap.setWorldChunkTransition`](../apps/web/src/city/tokyoStationMap.ts) が建物グループのYスケール（`0.92 -> 1.0`）をスムーズに遷移させる。
- さらに、高精細GLB（東京駅赤レンガ駅舎・渋谷ストリーム）がチャンク解放中または非同期ロード中の間は、軽量なプロシージャルLODプロキシ建物を自動表示し、GLB展開完了と同時にシームレスに入れ替えることで、建物の突然の出現・消失（ポップイン）を抑止している。

### 3.4 メモリ使用量監視と動的解放（Eviction）
- [`OpenWorldStreamingSystem.enforceMemoryBudgetAndEvict`](../apps/web/src/city/openWorldStreaming.ts) が毎フレームおよびワープ時に以下を検査する：
  1. `unloadRadiusM`（ワープ時は `activeRadiusM * 1.15`）を超えて離れたチャンクの解放。
  2. 推定メモリ使用量（`estimatedMemoryUsedMb`）が `memoryBudgetMb` を超えている場合、または常駐チャンク数が `maxResidentChunks` を超えている場合、現在チャンク以外の最も優先度スコアが低いチャンクから順に解放。
- [`TokyoStationMap.evictWorldChunk`](../apps/web/src/city/tokyoStationMap.ts) が呼ばれたチャンクでは、所属オブジェクトを非表示化するだけでなく、遠方ランドマークGLB（`tokyo_station.glb` / `shibuya_stream.glb`）や街路樹GLBクローンのジオメトリ・マテリアル・テクスチャを [`disposeGlbHierarchy`](../apps/web/src/city/tokyoStationMap.ts) で明示的に `.dispose()` してメモリを回収する。再度そのエリアへ接近・ワープした際にはオンデマンドで再ロードされる。

### 3.5 スマホChrome・画質設定（高・中・低）への適応とリトライ機構
- [`detectMobileChromeEnvironment`](../apps/web/src/city/openWorldStreaming.ts) と [`resolveStreamingBudgetProfile`](../apps/web/src/city/openWorldStreaming.ts) により、デスクトップ／スマホChrome × 画質（`high` / `medium` / `low`）の6プロファイルで `activeRadiusM`（210m〜410m）、`memoryBudgetMb`（78MB〜195MB）、`maxResidentChunks`（3〜7）、`frameSliceBudgetMs`（1.8ms〜4.8ms）を自動調整する。
- チャンク読み込みエラー発生時は指数バックオフで最大 `maxAutoRetries` 回自動再試行し、それでも失敗した場合はタイトル画面（`#loading-retry-btn`）および上部ストリーミングバナー（`#streaming-banner-retry-btn`）にエラー内容と「再試行 (RETRY)」ボタンを表示してワンクリックで復旧できる。

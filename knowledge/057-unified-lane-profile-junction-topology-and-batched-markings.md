---
title: 統一車線プロファイル・交差点トポロジー自動クリッピング・バッチ路面標示アーキテクチャ
tags:
  - architecture
  - roads
  - graphics
trust_signals:
  verified_date: 2026-11-27
  author: antigravity
  verification: "just format-code && just verify-all (Vitest 26 files incl. laneSystem.test.ts city-wide invariant audit) + live browser preview (?debugLanes=1 in Shibuya & Marunouchi)"
---

# 統一車線プロファイル・交差点トポロジー自動クリッピング・バッチ路面標示アーキテクチャ

## 背景・課題

従来の車線描画システムは、直線道路（`RoadMarkings` / `JapaneseRoadBuilder.buildSegment`）、曲線道路（`JapaneseRoadBuilder.buildPolylineSegment`）、交差点（`createIntersectionMarkings`）の 3 系統でそれぞれ独立した実装と手書きの除外ロジックを持っていた。その結果、以下の構造的課題が生じていた。

1. **SSOT 欠如による標識・路面矢印の食い違い**: 片側 2 車線の直線道路では `RoadMarkings` が `["right", "straight-left"]` を生成する一方、`JapaneseRoadSigns.createLaneDirectionSign`（標識令 327 の 7）や曲線道路（明治通り）は `["straight-right", "straight-left"]` を生成していた。
2. **手書き `markingExclusionZones` への依存**: 渋谷エリアの交差点開口ごとに中心座標と半径を手動調整しており、道路追加や交差点拡張のたびに白線侵入や抜け漏れリスクがあった。
3. **ドローコール・マテリアル・ジオメトリ複製コスト**: 曲線道路ごとに `new THREE.MeshStandardMaterial` を新規作成し、横断歩道ストライプも 1 本ずつ独立メッシュ化＋`drapeObjectOverElevation` によるジオメトリ複製を行っていた。
4. **日本固有の高度な車線表現の不足**: 幹線交差点アプローチの右折ポケット（中央ゼブラ導流帯＋右折専用レーン）、交差点内の曲線右折誘導破線アーク、細街路の路面「止まれ」標示、および将来の AI トラフィック／車載ナビ車線案内向けの構造化車線グラフが未整備だった。

## 設計・アーキテクチャ

新設モジュール [`apps/web/src/roads/lanes/`](../apps/web/src/roads/lanes/) に以下 7 モジュールを分離し、直線・曲線・交差点・標識を単一のデータモデルと描画基盤へ統合した。

1. **OpenDRIVE 風・弧長セクション付き車線プロファイル (`laneSchema.ts`, `laneProfile.ts`, `roadLaneCatalog.ts`)**
   - `RoadLaneProfileSchema`（Zod 検証付き）を SSOT とし、通常の対称道路（`lanesPerDirection`）は自動展開しつつ、上下非対称・一方通行・右折ポケット＋中央ゼブラ導流帯（`zebra_chevron`）・細街路一時停止（`hasStopText`）を宣言的カタログ（`ROAD_LANE_CATALOG`）から構築する。
   - **車道外縁幅の不変性保証**: 右折ポケット生成時（`createRightTurnPocketLanes`）も `roadCrossSection.ts` が定める `halfDriveableWidth` を変更せず、中央分離帯／導流帯の絞り込みと直進車線幅微調整（最小 2.75m 保証）によって歩道・縁石・沿道建築物との干渉を構造的に防止する。
   - 進行方向矢印は `resolveDefaultLaneArrow` / `resolveDriverLeftToRightArrows` を唯一の真実源とし、路面矢印（`RoadMarkings.createLaneArrowMarking`）と規制標識（`JapaneseRoadSigns.createLaneDirectionSign`）を 100% 同期する。
2. **交差点トポロジーと自動クリッピング (`junctionTopology.ts`)**
   - `resolveJunctionTopology` により、直交 4 叉路だけでなく渋谷の斜交・Y 字・5 叉路を含む全交差点の任意角度アーム・安全横断歩道半幅（`maxCrosswalkHalfSpan`）・2 次ベジェ右折誘導アーク（`turnGuideArcs`）を単一モデルで算出する。
   - `computeClippedMarkingIntervals` が各交差点の `boundaryPolygon` および交差コリドーに対して 1m サンプリング＋5 回二分法で長手白線を自動クリッピングし、交差点内部への白線侵入をゼロにする。
3. **共有マテリアル＆3D 地形直接評価バッチング (`laneMarkingGeometry.ts`, `roadMarkings.ts`)**
   - `MarkingGeometryBatcher` が生成時点で直接 `elevationSampler(x, z)` を評価し、横断歩道・中央ゼブラ導流帯・右折誘導アーク・実線／破線リボンを共有 3D ガラスビーズペイントマテリアル（`RoadMarkings.getWhitePaintMaterial()` / `getYellowPaintMaterial()`, `side: THREE.DoubleSide`）上でバッチ生成する。
   - 速度制限ペイント（`30/40/50`）および新規追加した法定白色路面文字「止まれ」（`createStopTextRoadMarking`）の `CanvasTexture` マテリアルをキャッシュ化しメモリ重複を削減した。
4. **構造化車線グラフ・都市全体幾何監査・デバッグ可視化 (`laneGraph.ts`, `laneAudit.ts`)**
   - `TokyoStationMap.getLaneGraph()` が全直線・曲線道路の 3D 車線中心線（隣接車線 ID・接続交差点 ID 付き）と交差点右折／直進接続アークを `LaneGraph` として公開し、`window.__DEEP_DRIVE_LANE_GRAPH__` および URL クエリ `?debugLanes=1` の軽量 3D ワイヤーフレームオーバーレイ（`buildLaneDebugOverlayGroup`）で利用可能にした。
   - `auditCityLaneSystem` により、Vitest（`apps/web/src/tests/laneSystem.test.ts`）から渋谷＋丸の内全都市の「交差点侵入ゼロ・3D 標高追従・標識 SSOT 一致・車線グラフ健全性」を自動検証する。

## 検証結果（Trust Signals）

- **単体・統合テスト**: `apps/web/src/tests/laneSystem.test.ts` を追加し、既存 25 テストファイルを含む全 26 ファイル（`just verify-all`）が全件グリーンであることを確認。
- **都市全体幾何監査**: 渋谷 DEM5A 起伏地形および東京駅丸の内の全道路・全交差点に対し `auditCityLaneSystem` 違反件数 0 を確認。
- **実画面ブラウザ検証**: ローカルプレビュー（渋谷・丸の内の通常表示および `?debugLanes=1`）で右折ポケット導流帯、交差点右折誘導破線アーク、細街路「止まれ」標示、および 3D 車線グラフオーバーレイの描画整合を目視確認。

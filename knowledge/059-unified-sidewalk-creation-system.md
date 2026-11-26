---
title: 統一歩道作成システム・共有マテリアルキャッシュ・交差点切下げスロープ・集水桝・歩道ネットワーク SSOT
tags:
  - architecture
  - roads
  - graphics
  - physics
trust_signals:
  verified_date: 2026-11-27
  author: antigravity
  verification: "just format-code && just verify-all (Vitest 28 files incl. sidewalkSystem.test.ts) + live browser preview (Marunouchi & Shibuya)"
---

# 統一歩道作成システム・共有マテリアルキャッシュ・交差点切下げスロープ・集水桝・歩道ネットワーク SSOT

## 背景・課題

[055-road-and-sidewalk-architecture-overhaul.md](./055-road-and-sidewalk-architecture-overhaul.md) で道路断面・片側クリッピング・交差点隅切り歩道の基礎が整っていたが、歩道作成システム全体として以下の課題が残存していた。

1. **歩道・縁石・側溝マテリアルの大量複製**: `buildSegment`・`buildPolylineSegment`・`buildIntersection` ごとに `new PuddleMaterial`・`curbMat`・`gutterMat` を個別生成しており、都市全体で 140 個超の `PuddleMaterial` と 280 個超の縁石／側溝マテリアルが複製され、毎フレームの天候 uniform 同期とドローコール負荷を増大させていた。
2. **交差点隅切り歩道の切下げスロープ欠落**: `buildIntersectionCornerSidewalks` が `rampZones = []` 固定だったため、交差点横断歩道手前に 15cm の段差壁が残存していた。
3. **点字警告ブロックの斜面不整合と排水設備の欠如**: 横断歩道前の点字警告ブロックが水平板だったため切り下げ斜面の車道側でわずかに浮きが生じ、また日本の都市歩道に不可欠な L 型側溝内の雨水集水桝グレーチングが存在しなかった。
4. **曲線防護柵のドローコール過多と歩道ネットワーク SSOT の欠如**: 曲線ガードレールの支柱・反射体が 2.5m ごとに個別メッシュ化されており、さらに歩道ポリゴンを空間クエリ・自動監査できる構造化グラフ（`SidewalkNetwork`）が未整備だった。

## 設計・アーキテクチャ

新設モジュール [`apps/web/src/roads/sidewalks/`](../apps/web/src/roads/sidewalks/) に以下 6 モジュールを構築し、`JapaneseRoadBuilder`・`TokyoStationMap`・`main.ts` へ統合した（`roadBuilder.ts` の重複歩道・防護柵実装約 560 行を削減）。

1. **Zod スキーマ＆歩道ネットワーク SSOT (`sidewalkSchema.ts`, `sidewalkCatalog.ts`)**:
   - 道路構造令準拠の断面ゾーニング（L 型側溝・面取り縁石・施設帯・有効歩行空間・民地境界幅）と、地区別プリセット（丸の内御影石・銀座プロムナード・渋谷インターロッキングブロック・皇居外苑・東京都標準コンクリート）を定義。
   - 生成した全直線歩道・曲線歩道・交差点隅切り・T 字閉鎖辺を `SidewalkNetwork`（ポリゴン・歩行者スパイン・面積・切下げ数・点字ブロック数・集水桝数）として一元登録。
2. **共有マテリアルキャッシュ (`sidewalkMaterials.ts`)**:
   - `SidewalkMaterialLibrary` が舗装スタイル別 `PuddleMaterial`（最大 3 個）・縁石・L 型側溝・集水桝グレーチング（鋳鉄スリットテクスチャ）・防護柵ビーム／反射体を共有キャッシュ化し、`TokyoStationMap.puddleMaterials` を 140 個超から 15 個以下へ圧縮。
3. **高精度歩道ジオメトリ＆バッチ化 (`sidewalkGeometry.ts`)**:
   - **交差点隅切り切下げスロープ (`buildUpgradedIntersectionCornerSidewalks`)**: 横断歩道接続辺を `0.15m -> 0.02m` へ滑らかに切り下げ、隅切りスラブ三角形の重心補間で点字警告ブロックを実高さへ密着配置。
   - **斜面密着 JIS T 9251 点字警告ブロック (`buildSlopedTactilePadGeometry`)**: 直線・曲線双方で縁石側〜建物側の実斜面高さ（`+5.5mm`）へ全頂点を一致させ、浮き・めり込みを解消（離散 2.4m パッド制約を維持）。
   - **バッチ雨水集水桝グレーチング (`buildBatchedCatchBasinGeometry`)**: 切下げスロープ直前直後および 20〜24m 間隔で L 型側溝内へ埋め込み、片側 1 ドローコールへ統合。
   - **バッチ曲線ガードレール (`buildBatchedCurvedGuardrailGroup`)**: 全ビーム・支柱・反射体を片側最大 3 メッシュへ統合。
4. **空間クエリ＆都市全体監査 (`sidewalkSystem.ts`, `sidewalkAudit.ts`)**:
   - `SidewalkSystem.isPointOnSidewalk(x, z)` / `findNearestSidewalk(x, z)` と開発者フック `window.__DEEP_DRIVE_SIDEWALKS__` を提供。
   - `auditSidewalkSystem` がマテリアル共有上限・歩道天面法線正立・非有限座標ゼロ・点字ブロック離散サイズ・直線歩道重複ゼロ・都市カバレッジを自動検証。

## 検証結果（Trust Signals）

- **自動テスト**: [`apps/web/src/tests/sidewalkSystem.test.ts`](../apps/web/src/tests/sidewalkSystem.test.ts) を追加し、`just format-code && just verify-all`（全 28 テストファイル）が全件通過、`auditSidewalkSystem` 違反 0 件・共有舗装 `PuddleMaterial` 3 個以内・曲線ガードレール片側 3 メッシュ以内を確認。
- **実機ブラウザ目視検証**: ローカルプレビューにて丸の内（和田倉門交差点・行幸通りの御影石歩道・隅切り切下げ・集水桝・点字ブロック）および渋谷（スクランブル交差点〜公園通りのインターロッキング歩道・バッチ防護柵・傾斜追従）を目視確認。

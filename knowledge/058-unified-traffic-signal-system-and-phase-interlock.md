---
title: 統一交通信号作成システム・交差点トポロジー連動配置・排他フェーズ制御
tags:
  - architecture
  - roads
  - graphics
trust_signals:
  verified_date: 2026-11-27
  author: antigravity
  verification: "just format-code && just verify-all (Vitest 27 files incl. trafficSignalSystem.test.ts) + live browser preview (Marunouchi Wadakuramon & Shibuya Scramble)"
---

# 統一交通信号作成システム・交差点トポロジー連動配置・排他フェーズ制御

## 背景・課題

従来の信号機作成処理（`RoadProps.createTrafficLight` および `JapaneseRoadBuilder.buildProps`）には、視覚品質・法規整合・性能の 3 面で以下の課題があった。

1. **交差点信号の欠落と途中区間の誤配置**: `buildIntersection` には信号機が 1 基も生成されず、行幸通り×日比谷通り（和田倉門交差点）等に信号機が存在しなかった。一方で直線道路の `buildProps` は `length < 120m` で南側横断歩道がない短区間にも架空の信号機を立てていた。
2. **青信号固定・青＋右折矢印の違法同時点灯**: すべての信号機が `activeSignal: "green"` 固定で交差軸どうしが同時青になっており、さらに `showArrowSignal: true` 時は青信号と同時に青緑右折矢印が常時点灯していた。
3. **遠方視認性の低下とマテリアル複製**: `removeAttachedLights` で `PointLight` を除去した後に残る LED レンズが `toneMapped: true` かつ低輝度（`emissiveIntensity: 1.65`）だったため遠方から黒いシルエットに見え、さらに 1 基ごとに 6〜8 枚の `CanvasTexture` を複製していた。

## 設計・アーキテクチャ

新設モジュール [`apps/web/src/roads/signals/`](../apps/web/src/roads/signals/) に以下 6 モジュールを構築し、`RoadProps`・`JapaneseRoadBuilder`・`TokyoStationMap`・`main.ts` へ統合した。

1. **Zod スキーマと法規準拠アスペクト (`signalSchema.ts`)**:
   - 車両信号を `"green" | "yellow" | "red" | "red_right_arrow"`、歩行者信号を `"green" | "green_blink" | "red"` としてモデル化し、青信号＋右折矢印の同時点灯を型レベルで排除。
2. **共有 LED キャッシュ＆光学グロウハロー (`signalMaterials.ts`, `trafficSignalBuilder.ts`)**:
   - `TrafficSignalMaterialLibrary` が全車両／矢印／歩行者 LED の点灯・消灯マテリアルと地点名プレートを共有キャッシュ化（都市全体で 16 マテリアル以下）。
   - 前面正立 `CircleGeometry` レンズ（`toneMapped: false`, `emissiveIntensity: 2.65`）＋加算合成グロウハロー（`AdditiveBlending`）により、`PointLight` 負荷ゼロで 150m 先からも昼夜鮮明に視認可能。
   - 道路幅員に応じた適応アーム長（`2.9m / 4.1m / 5.0m`）と交差点角の 2 方向歩行者灯器オプション（`hasDualPedestrianHeads`）を導入。
3. **交差点トポロジー連動・日本式遠方左歩道配置 (`signalPlacement.ts`)**:
   - `JunctionTopology` の任意角度アームから `outDir = (sin a, cos a)`, `leftDir = leftNormal2D(outDir)` を用いて遠方左歩道（交差点パッド外・車道外・接続道路歩道スラブ上）の支柱座標とドライバー正対ヨー角を自動算出し、丸の内・銀座・皇居外苑の全主要交差点へ信号機＋物理コライダーを配置。
   - 渋谷の既存交差点信号群も `alignSignalYawToRoadOverhang` ＋ `resolveSignalIntersectionBinding` で車道側へのアーム張り出し向きと最寄り `JunctionTopology` を自動補正し、スクランブル交差点を含めて排他サイクルへ統合。あわせて曲線道路（`buildPolylineSegment`）で左右の `lightYaw` が 180° 逆転していた既存バグも修正した。
4. **排他インターロック付きリアルタイム制御器と自動監査 (`trafficSignalController.ts`, `signalAudit.ts`)**:
   - `TrafficSignalController` が主軸（`axis_a`）・交差軸（`axis_b`）・全赤クリアランス（`allRedSec`）・右折矢印（`red_right_arrow`）・2Hz 歩行者青点滅（`green_blink`）・渋谷スクランブル全歩行者青フェーズをゼロアロケーションで毎フレーム駆動。
   - `auditTrafficSignalSystem` が全交差点の 0〜110s シミュレーション排他検証・違法矢印点灯ゼロ・単灯発光整合・マテリアル共有上限・渋谷 DEM5A 接地標高・車道側アーム張り出し方向（`arm_away_from_road`）を自動検査する。

## 検証結果（Trust Signals）

- **自動テスト**: `apps/web/src/tests/trafficSignalSystem.test.ts` を追加し、全 27 テストファイル・231 テスト（`just verify-all`）が全件グリーン、全 277 基に対する `auditTrafficSignalSystem` 違反 0 件を確認。
- **実画面ブラウザ検証**: ローカルプレビューにて丸の内・和田倉門交差点（`X: 0, Z: 250`）および渋谷スクランブル交差点で目視確認。初回検証の渋谷スクリーンショットから旧コードのハードコード `rotY` が 180° 反転してアームが歩道側へ張り出していた不整合を検出し、`alignSignalYawToRoadOverhang`・`buildPolylineSegment` 修正・`arm_away_from_road` 監査追加後に再検証して解消を確認した。

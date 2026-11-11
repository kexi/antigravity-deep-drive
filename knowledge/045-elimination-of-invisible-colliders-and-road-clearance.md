---
title: "道路網における「見えない壁」（透明コライダー・交差点貫通ガードレール・重複ビル・残留物理形状）の完全根絶と道路空間クリアランス設計"
tags: [physics, roads, open-data]
trust_level: verified
date: "2026-11-10"
author: "Antigravity Agent"
summary: "走行中に何もない空間で車両が激突・急停止・跳ね上がる「見えない壁」の物理的・幾何学的根本原因を網羅的に究明し完全根絶。スプライン道路端部の交差点開口ガードレール・縁石コライダートリム、交差点直撃ビルの敷地外退避、GLB重複ビルの物理コライダー動的無効化連動、首都高橋脚・頭上標識の動的歩道オフセット、旧直線道路セグメントの信号機・街灯スタンプ抑制を実装。全19道路コリドーおよび全実走行ルートにおいて車道障害物衝突ゼロ（CLEAR）を達成。"
---

# 道路網における「見えない壁」（透明コライダー・交差点貫通ガードレール・重複ビル・残留物理形状）の完全根絶と道路空間クリアランス設計

## 1. 背景と課題（「見えない壁もあるな」の根本原因）

渋谷エリアおよび広域道路網の走行中、何もない空間で車両が激突して急停止・跳ね上がる「見えない壁（Invisible Wall）」が複数箇所で報告された。Rapier 3D 物理エンジンの全 1,592 個の立体障害物コライダーと全 19 道路コリドーの走行車線領域、およびクラウンセダン（実車寸法: 全長 4.72m × 全幅 1.84m × 全高 1.43m）の実走行軌跡 OBB（Oriented Bounding Box）を用いた網羅的交差シミュレーションを実施した結果、以下の **7つの幾何学的・物理的根本原因** を特定した。

1. **道玄坂上交差点直撃ビル（`exp-bldg-shoto-heights`）**:
   - 幅 48m の巨大ビル「松濤レジデンスハイツ」が `x = -1080, z = 140`（道玄坂上交差点の中心）に建っており、道玄坂・玉川通り西進・神泉仲通りの全車両を物理的に塞いでいた。
2. **スプライン道路の端部ガードレール・縁石コライダーの交差点貫通**:
   - `roadBuilder.ts` の `buildPolylineSegment` において、路面ポリラインの全長にわたってガードレール（高さ 0.85m）および歩道縁石（高さ 0.15m）の物理直方体コライダーを生成していた。
   - スプライン道路が交差点（宮益坂下交差点、道玄坂下、スクランブル交差点など）に合流・横断する際、端部のガードレールが交差点を直角または斜めに貫通し、横断車線の走行車両が透明なガードレールに激突していた。
3. **GLB ロード時のプロシージャル重複ビルのコライダー残留**:
   - 渋谷ストリーム、スクランブルスクエア、ヒカリエ、サクラステージ、セルリアンタワーなどのランドマークは GLB モデルがロードされるとプロシージャルメッシュ（Mesh）は `visible = false` で非表示化される。
   - しかし、Rapier の直方体コライダー（RigidBody / Collider）は削除も無効化もされずワールドに残存。GLB モデルの精緻な外形とプロシージャル直方体コライダーの微小な形状差（数メートル）が、道路や歩道上で「何もない空間に激突する見えない壁」となっていた。
4. **旧直線道路セグメントによる架空信号機・街灯コライダースタンプの車道貫通**:
   - 外苑東通り（x = -380, len = 568）や内堀通り直線セグメント（x = 0, z = 606）などの旧グリッド道路が `hasTrafficLights: true` を持っていた。
   - 直線道路生成処理が交差点でもない地点（長さの 25% 地点など）に自動生成した信号機支柱（x = -371.4, z = 96.5）や制限速度標識（x = 13.2, z = 387.1）が、新設されたスプライン道路（国道246号連絡路、内堀通りカーブ区間）の車道中央に突き刺さっていた。
5. **広域街路樹・街灯ループの無条件生成による車道侵入**:
   - 丸の内の日比谷通り（z = 250 - 14.5 = 235.5）や内堀通り（z = 365 ± 11.5）の街路樹・街灯ループが `x = -450 .. +450` まで無条件に等間隔生成されていた。
   - 西側（x = -450 .. -400）では宮益坂（都道413号: x = -480 .. -400, z = 242 .. 232）の車道内に街路樹の幹（y = 1.8）や街灯柱（y = 2.5）が突き刺さり、皇居外苑（|x| >= 160）では内堀通りカーブ車道内に街路樹・街灯が直撃していた。
6. **首都高3号渋谷線橋脚コライダーの車道食い込み**:
   - 首都高高架橋脚の配置オフセットが旧直線グリッド時代の固定値（`z = 95 ± 14.5`）のままだったため、カーブする玉川通り西進（`z = 108`）や国道246号の車道内に橋脚コライダーが突き刺さっていた。
7. **桜丘さくら坂合流口の玉川通りガードレール閉塞**:
   - さくら坂（`nav-road-shibuya-sakurazaka-loop`）が玉川通り西進（`nav-road-shibuya-tamagawa-west`）に合流する地点（x = -940, z = 115）において、玉川通り側の南側ガードレールが連続して敷かれていたため、合流口が塞がれていた。

---

## 2. 解決策と実装アーキテクチャ

### 2.1 スプライン道路端部の交差点開口トリム（`isInIntersectionTrim`）
`apps/web/src/roads/roadBuilder.ts` の `buildPolylineSegment` において、交差点パッドと接続する端部（`segMidArc < startMarkingTrim - 0.5` または `segMidArc > totalSplineLength - endMarkingTrim + 0.5`）では、歩道縁石コライダー（`swColDesc`）およびガードレールコライダー（`railColDesc`）の生成を完全にスキップ。路面コライダー（`roadCol`）のみを滑らかに接続配置することで、交差点開口部を完全にフラットかつ衝突フリーにした。

```typescript
// 交差点開口トリム（端部ではガードレール・縁石コライダーを生成しない）
const isInIntersectionTrim =
  segMidArc < startMarkingTrim - 0.5 ||
  segMidArc > totalSplineLength - endMarkingTrim + 0.5;

if (!isInIntersectionTrim) {
  if (hasSidewalks) {
    // 歩道縁石コライダー生成
  }
  if (config.hasGuardrails) {
    // ガードレールコライダー生成
  }
}
```

### 2.2 GLB重複ビルの物理コライダー動的連動（`setShibuyaGlbOverlappingProceduralVisible`）
`apps/web/src/city/tokyoStationMap.ts` に `proceduralGlbOverlappingColliders` 配列を追加。GLB 表示切り替えと連動して `col.setEnabled(showProcedural)` を実行し、GLB モデル表示中はプロシージャル側の直方体コライダーを完全無効化。GLB モデルの物理境界（または GLB メッシュ）のみが有効となるように是正した。

```typescript
public setShibuyaGlbOverlappingProceduralVisible(visible: boolean): void {
  // メッシュの表示切り替え
  for (const child of this.proceduralGlbOverlappingGroup.children) {
    child.visible = visible;
  }
  // 物理コライダーの完全連動（GLB表示時は直方体コライダーを即座に無効化）
  for (const col of this.proceduralGlbOverlappingColliders) {
    col.setEnabled(visible);
  }
}
```

### 2.3 首都高橋脚・頭上案内標識の動的歩道オフセット
- **首都高橋脚**: スプライン道路のカーブ形状（玉川通り西進・国道246号連絡路）に合わせて、橋脚位置を車道外側歩道（北側 `localZ = 28.0`、南側 `localZ = -14.5 / -10.0`）へ逃がす動的オフセットを適用。横梁（`crossBeam`）の長さも自動追従。
- **明治通り頭上案内標識（`overhead_guide_shibuya_246_shutoko`）**: カンチレバー支柱が東側車線内に侵入していた問題を、`position: [-744.5, 0.0, 62.0]`, `spanWidth: 22.0` に適正化し、支柱を東側歩道上（`x = -733.5`、車道端から 5.2m 外側の完全な安全地帯）に配置。

### 2.4 旧直線セグメント・街路樹・街灯ループの境界適正化
- `Gaien-Higashi-dori`（x = -380）、`Route-246-Aoyama-dori-Main`（x = -324）、`Uchibori-dori-East-Otemon`（x = 0）の `hasTrafficLights: false` 化および重複区間の短縮。
- 日比谷通り・内堀通りの街路樹・街灯ループを丸の内都心ブロック（`x = -240 .. +240`）に厳密限定し、宮益坂や皇居外苑カーブ車道への侵入を完全遮断。
- 玉川通り西進（`nav-road-shibuya-tamagawa-west`）のガードレールを無効化（歩道縁石のみで自然に分離）し、さくら坂（`nav-road-shibuya-sakurazaka-loop`）からの合流口を開口。

---

## 3. 検証結果（Verification）

網羅的物理検証スクリプト（`scratch/detect_invisible_walls.ts`）を実行し、全19道路コリドーおよび主要7走行ルートにおける物理判定を実施した。

### 3.1 全 19 道路コリドー 障害物スキャン結果
- **総コライダー数**: 1,454 個
- **検査コリドー数**: 19 路線（明治通り、スクランブル連絡路、道玄坂、玉川通り西進、神泉仲通り、文化村通り、公園通り、センター街、国道246号、さくら坂、宮益坂、内堀通り等）
- **結果**: **ALL 19 CORRIDORS PERFECTLY CLEAR! ZERO INVISIBLE WALLS!**（車道侵入障害物: 0 件）

### 3.2 実車（クラウンセダン）OBB 走行軌跡衝突テスト結果
- `明治通り北上 -> 宮益坂下交差点左折 -> スクランブル交差点`: **0 collision hits (CLEAR)**
- `スクランブル交差点 -> 道玄坂西進登坂`: **0 collision hits (CLEAR)**
- `道玄坂上交差点 -> 玉川通り西進 -> 神泉町 -> 山手通り`: **0 collision hits (CLEAR)**
- `スクランブル交差点 -> センター街北西進`: **0 collision hits (CLEAR)**
- `スクランブル交差点 -> 公園通り北進 (PARCO・区役所方面)`: **0 collision hits (CLEAR)**
- `スクランブル交差点 -> 文化村通り (東急本店方面)`: **0 collision hits (CLEAR)**
- `宮益坂東進登坂 (渋谷駅東口 -> 宮益坂上 -> 表参道方面)`: **0 collision hits (CLEAR)**
- **CI/CD 全自動検証**: `just verify-all`（ActionLint, Pinact, TypeScript, Oxlint, Vitest 202テスト全件合格, tsdown Minify 本番ビルド）全工程通過。

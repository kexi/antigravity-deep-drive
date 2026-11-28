---
title: 交差点歩道の完全連続化・L字外周歩道・T字端キャップクリッピング・任意角度歩道コネクタ設計
tags:
  - architecture
  - roads
  - graphics
  - physics
trust_signals:
  verified_date: 2026-11-28
  author: antigravity
  verification: "just format-code && just verify-all (Vitest 30 files incl. sidewalkSystem.test.ts, roadSystem.test.ts, roadInfrastructure.test.ts, shibuyaConnectivity.test.ts) + city-wide sidewalk endpoint gap audit + live browser preview (Marunouchi & Shibuya)"
---

# 交差点歩道の完全連続化・L字外周歩道・T字端キャップクリッピング・任意角度歩道コネクタ設計

## 背景・課題

統一歩道作成システム（[059-unified-sidewalk-creation-system.md](./059-unified-sidewalk-creation-system.md)）の構築後も、全 58 交差点を対象とした定量的ギャップ監査により、以下 5 系統の交差点歩道切断（計 145 箇所：直線 24 箇所＋曲線 121 箇所）が検出された。

1. **渋谷 19 交差点および外苑東斜交 2 交差点の隅切り歩道未生成と巨大矩形除外ボックスによる穴あき切断**:
   - 渋谷エリアの全 19 交差点と外苑東通り斜交 2 交差点（`(-380, 98)` / `(-380, 400)`）で `hasCornerSidewalks: false` が設定されていたうえ、それら 26m〜44m の軸平行矩形がそのまま `sidewalkExclusionBoxes` に投入されていたため、T 字路の非合流側（セルリアンタワー前・山手神泉・神宮前・宮益坂上）や単一路線通過部（神泉町・神南一丁目・渋谷橋・さくら坂上）の連続歩道まで 11m〜26m にわたり切断されていた。
2. **T 字合流コリドーの半球状エンドキャップ突き抜け**:
   - `computePerSideCorridorIntervals` のポリライン距離計算が終端から半径 `halfWidth` の半球状に判定していたため、山手通り×玉川通り（`(-1625, 740)`）等で支線の終端が本線の中心線を越えて対向側歩道まで切断していた。
3. **直交 L 字交差点（2 アーム）の外周歩道欠落**:
   - `buildUpgradedIntersectionCornerSidewalks` が T 字路（3 アーム）の閉鎖辺しか処理しておらず、六本木（`(-380, -350)`）・半蔵門（`(-350, 850)`）・竹橋（`(0, 850)`）・汐留（`(650, -750)`）の L 字外周 2 辺が完全に途切れていた（23m〜34m 欠落）。また単一アーム終端（`(156, 850)`）および皇居外苑×内堀通り（`(0, 365)`）、和田倉門西・楠公通りアプローチ（`(-23.5, 250)`）の 21m 区間も歩道が欠落していた。
4. **接続道路と交差点パッドの幅差による外縁切断＆接続端スロープ段差**:
   - 東京駅前（`(0, 5)`）の日比谷通り南延伸（片側歩道外縁 16m vs パッド半幅 13m）や銀座（`(156, 5)`）で歩道外縁が切れており、さらに交差点コーナーの切下げスロープが接続端（`arc = 0 / totalLen`）まで食い込むケースでは縁石高さに段差が生じていた。
5. **斜交・Y 字・5 差路・曲線×直線合流部の隅切り・連続接続機構の不在**:
   - 渋谷スクランブル交差点・宮益坂下・渋谷駅東口・109 前 Y 字路・道玄坂上・PARCO 前・井の頭通り×明治通り・ヒカリエ連絡路・内堀通り×永代通り等の非直交合流点で歩道端同士を繋ぐ仕組みが存在しなかった。

## 設計・実装

1. **T 字端キャップ長手余白判定＆交差歩道クリアランス（[`apps/web/src/roads/roadCrossSection.ts`](../apps/web/src/roads/roadCrossSection.ts), [`apps/web/src/roads/types.ts`](../apps/web/src/roads/types.ts)）**:
   - `minDistanceSqToCorridorRibbon` でポリライン全体の最近接点が先頭セグメント前方・末尾セグメント後方の `endCapMargin`（既定 1.5m）を越える場合は非干渉と判定し、T 字合流支線が本線の対向側連続歩道を切断する現象を根絶。
   - 交差コリドーへ `sidewalkClearance` を持たせ、交差側のみ互いの歩道外縁でクリーンに停止させ重複（Z-fighting）を防止。
   - `sidewalkExclusionBoxes` からは直交隅切り交差点のみを残し、渋谷の巨大矩形除外を撤廃。
2. **直交交差点の完全対応（[`apps/web/src/roads/sidewalks/sidewalkGeometry.ts`](../apps/web/src/roads/sidewalks/sidewalkGeometry.ts)）**:
   - **L 字外周連続カーブ歩道 (`IntersectionSidewalkEdge_OuterBend`)**: 2 アーム直交交差点の外周 2 辺を滑らかな R カーブ縁石＋L 型側溝＋`THREE.ShapeUtils.triangulateShape` による `+Y` 正立法線スラブ＋集水桝＋安全コライダーで連続接続。
   - **単一アーム終端ラップ＆幅差ポケット拡張**: 1 アーム終端の両側歩道および、接続道路幅が交差点パッドを超える箇所（東京駅前 `(0, 5)`・銀座 `(156, 5)`）の空きポケット拡張を実装（先頭頂点を建物側外角頂点とする `polygonXZ[0]` 規約を維持）。
   - **切下げスロープ接続端クランプ**: コーナー切下げゾーンのすりつけ端が `arc = 0 / totalLen` から最低 8cm 内側に収まるようクランプし、接続端縁石高さ 0.15m を厳守。
3. **任意角度交差点歩道コネクタ（`SidewalkTerminal` / `buildArbitraryAngleSidewalkBridge` / `SidewalkSystem.connectOpenJunctionSidewalks`）**:
   - 全直線歩道・曲線歩道・直交交差点コーナー/エッジの開放端を `SidewalkTerminal`（縁石点・歩行面内端・外縁点・外向き接線・外向き法線）として自動登録。
   - 各交差点ターゲット周囲の未接続端末を偏角順にソートし、**カイラリティ不変式（`cross(outwardDir, toOuterDir) > 0` → `< 0`）** の組だけを抽出することで車道横断を構造的に不可能にしつつ、凸コーナー（二次ベジェ隅切り＋`triangulateShape`）、T 字連続辺（三次エルミート）、外周屈曲カーブ、スクランブル交差点等の保護円外周リム弧を自動選択して L 型側溝・面取り縁石・3D 地形追従スラブ・集水桝を一括生成（Pass 1）、さらに直線×曲線継ぎ目等の微小ギャップを直接ステッチ（Pass 2）。
   - `tokyoStationMap.ts` にて `Intersection_-23.5_250`（`depth: 32` 統一＋南連続歩道・北隅切り有効化）および `Intersection_0_365`（内堀通り北接続）を修正し、`connectOpenJunctionSidewalks` を全渋谷交差点・109 Y 字・外苑東斜交・無パッド合流点へ適用。

## 検証結果（Trust Signals）

- **全都市ギャップ監査**: 交差点近傍の未接続歩道端を **145 箇所（直線 24・曲線 121）→ 10 箇所（うち 4 箇所は歩道幅 0 のセンター街歩行者天国入口、1 箇所は皇居外苑広場入口）** へ劇的削減。`auditSidewalkSystem` 違反 0 件、共有舗装 `PuddleMaterial` 2 個・総マテリアル 5 個を維持。
- **自動テスト**: `just format-code && just verify-all` 全 30 テストファイル合格（[`sidewalkSystem.test.ts`](../apps/web/src/tests/sidewalkSystem.test.ts) に和田倉門西・東京駅前幅差ポケット・L 字外周連続歩道・渋谷 T 字非合流側連続性・任意角度コネクタの回帰テストを追加、`shibuyaConnectivity.test.ts`・`roadSystem.test.ts`・`roadInfrastructure.test.ts` 全件合格）。

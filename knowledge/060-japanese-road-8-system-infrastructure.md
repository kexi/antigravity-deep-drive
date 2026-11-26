---
title: 日本の道路全8系統インフラ統合アーキテクチャ（照明・防護安全・路面インフラ・沿道ファニチャー・統合監査）
tags:
  - architecture
  - roads
  - graphics
  - physics
trust_signals:
  verified_date: 2026-11-27
  author: antigravity
  verification: "just format-code && just verify-all (Vitest 29 files incl. roadInfrastructure.test.ts) + live browser preview (Marunouchi & Shibuya)"
---

# 日本の道路全 8 系統インフラ統合アーキテクチャ

## 背景・課題

車線（`lanes/`）・交通信号（`signals/`）・歩道（`sidewalks/`）の 3 系統を統一モジュール化した後も、日本の都市道路を構成するその他の附属物（街灯・ボラード・カーブミラー・地上変圧器・消火栓・植樹桝・バス停・郵便ポスト・案内板・パーキングメーター・ベンチ）は個別メソッド内でのマテリアル複製や未整備状態が残っていた。

## 全 8 系統アーキテクチャ（`apps/web/src/roads/`）

1. **`lanes/`**: 車線プロファイル・交差点トポロジー・`LaneGraph`・バッチ路面標示・`auditCityLaneSystem`
2. **`sidewalks/`**: 歩道断面・共有 `PuddleMaterial`・交差点切下げスロープ・斜面密着点字ブロック・バッチ集水桝・`SidewalkNetwork`・`auditSidewalkSystem`
3. **`signals/`**: 交通信号機・排他フェーズ制御・遠方左歩道配置・アーム張り出し監査・`auditTrafficSignalSystem`
4. **`roadSignSystem.ts` + `auditRoadSignSystem`**: 全 15 種日本道路標識・組付健全性監査
5. **`lighting/`（新設）**:
   - `RoadLightingSystem` / `RoadLightingMaterialLibrary` により、地区別 3 様式（丸の内黒鋳鉄 2 灯ランタン・幹線道路 LED コブラ照明灯・渋谷モダン街路灯）を共有ジオメトリ＆最大 8 マテリアルへ集約。
   - `PointLight` をシーングラフへ一切追加せず、`setNightFactor` で昼・夕暮れ・夜間の LED 発光輝度と加算グロウハローを O(1) 同期。
6. **`barriers/`（新設）**:
   - `BarrierSystem` / `BarrierMaterialLibrary` により、丸の内御影石ボラード・渋谷反射車止めポール・**道路反射鏡（カーブミラー：橙色フード＋凸面鏡＋注意板）**・視線誘導標を共有キャッシュで管理。
7. **`utilities/`（新設）**:
   - `RoadUtilitySystem` / `RoadUtilityMaterialLibrary` により、**東京都下水道桜マンホール**・**通信電力ハンドホール**・**無電柱化地上変圧器（TEPCO パッドマウント地上機器）**・**赤ポール消火栓標識**・**街路樹植樹桝（御影石枠＋鋳鉄ツリーサークルグレーチング）** を構築。
8. **`furniture/`（新設）**:
   - `StreetFurnitureSystem` / `StreetFurnitureMaterialLibrary` により、**都営バス／東急バス停留所**・**日本の赤い郵便ポスト（〒）**・**街区／地下鉄案内サイン**・**時間制限パーキングメーター**・**都市歩道ベンチ** を `SidewalkNetwork` 連動の歩道施設帯へ安全配置（車道非侵入・交差点外・既存支柱離隔・地形密着）。
9. **`infrastructure/`（新設）**:
   - `JapaneseRoadInfrastructure` が全 8 系統を統括し、`getFullSummary()`・`auditAll(scene)` およびブラウザ開発フック `window.__DEEP_DRIVE_ROAD_SYSTEMS__` を提供。

## 検証結果（Trust Signals）

- **自動テスト**: [`apps/web/src/tests/roadInfrastructure.test.ts`](../apps/web/src/tests/roadInfrastructure.test.ts) を追加し、`just format-code && just verify-all`（全 29 テストファイル）通過、全 8 系統一括監査 `auditAll` 違反 0 件を確認。
- **実機ブラウザ検証**: ローカルプレビューにて丸の内・和田倉門周辺および渋谷エリアで、地区別街灯・街路樹植樹桝・カーブミラー・地上変圧器・消火栓・都営/東急バス停・郵便ポスト・パーキングメーター・ベンチの歩道上接地と昼夜調光を目視確認。

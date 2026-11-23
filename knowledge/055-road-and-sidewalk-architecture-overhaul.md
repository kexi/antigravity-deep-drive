---
title: 道路作成システム・歩道断面幾何学・交差点隅切りの統合刷新
tags:
  - architecture
  - graphics
  - physics
  - roads
trust_signals:
  verified_date: 2026-11-19
  author: antigravity
  reviewed_by: just format-code + just verify-all (25 test files / 216 tests) + scene geometry audit
---

# 055: 道路作成システム・歩道断面幾何学・交差点隅切りの統合刷新

## 1. 背景と課題

ユーザーからの「道路作成システムって不十分だよね。歩道も正確でないし。修正して」という指摘を受け、プロジェクト全体の道路・歩道生成パイプラインを監査した結果、以下の構造的欠陥が判明した：

1. **直線道路 (`buildSegment`) と曲線道路 (`buildPolylineSegment`) の断面・仕様乖離**:
   - 直線道路で `medianWidth > 0` が無視され車道幅・中央分離帯が生成されない一方、曲線道路では `medianWidth` を含む実幅で生成されていた。
   - 直線歩道が単純 `BoxGeometry` (`roughness: 0.9`) であり、`sidewalkWidth` のまま歩道内に縁石を取り込むため実歩道幅と視覚・物理境界が一致せず、道路際 L 型側溝や排水勾配、バリアフリー切り下げスロープ、目地シェーダーが存在しなかった。
2. **曲線歩道クリッピングと渋谷路線の歩道欠損**:
   - 従来の歩道クリッピングが中心線対称（左右両側を同時に削除）であったため T 字路等で反対側歩道まで消滅し、さらに `nav-road-shibuya-inokashira-organ` / `nav-road-shibuya-sakurazaka-loop` / `nav-road-shibuya-hikarie-access` では `sidewalkWidth: 0` にフォールバックして歩道が消失していた。
   - 曲線道路に JIS T 9251 点字警告ブロックが無く、曲線ガードレールも横断歩道位置で開口していなかった。また曲線車線境界白破線が 18m 黄色進路変更禁止実線区間に重複描画されていた。
3. **交差点接続ギャップ・重複・Corner Sidewalks の欠落**:
   - 直線道路と交差点パッドの接続に `0.5m〜3.0m` のギャップ／食い込みが複数箇所存在し、直交歩道コーナー同士の重複、`Intersection_-380_250` の二重配置、0 アームの孤立 `Intersection_-180_-150` も残存していた。
   - 交差点四隅に隅切り R 歩道・T 字路閉鎖辺の連続歩道が存在せず、角が車道アスファルトのまま露出していた。
4. **AssetManagerUI / ランタイム反映の未結線**:
   - 道路アセット編集 UI で `solid_white` 中央線や歩道・横断歩道・点字ブロック・ガードレールの個別切替ができず、`onApplyRoadToScene` も影更新のみだった。

---

## 2. 設計と実装概要

### 2.1 統一断面 SSOT ＆ プロファイルジオメトリ (`apps/web/src/roads/roadCrossSection.ts`, `types.ts`)

- `computeRoadCrossSection` / `getSideCrossSection` を導入し、車道半幅 (`halfDriveable = lanes * laneWidth + shoulderWidth + medianWidth * 0.5`)、コンクリート L 型側溝 (`0.24m`)、面取り縁石 (`curbWidth = 0.20m`, `curbBevel = 0.045m`)、横断排水勾配 (`1.5%` = `0.015`) を直線・曲線双方の単一真実源 (SSOT) とした。
- **バリアフリー切り下げ (`evaluateCurbRampHeight`)**: 横断歩道前後 (`halfWidth = 2.2m`, `transitionLength = 1.2m`) で縁石高を `0.15m -> 0.02m` へ滑らかに切り下げ、底面 `y = baseY` で接地させ浮きをゼロ化。
- **`buildLGutterRibbonGeometry` / `buildProfiledCurbRibbonGeometry` / `buildProfiledSidewalkRibbonGeometry`**: 直線 (`buildStraightRoadFrames`) および曲線 (`CatmullRomCurve3` centripetal 0.5, 上限 360 分割) の双方で共通の断面リボンを生成。

### 2.2 歩道舗装・縁石・道路シェーダー強化 (`puddleShader.ts`, `japaneseRoadMaterial.ts`, `roadBuilder.ts`)

- `PuddleMaterial` に `uSidewalkPavingMode` (`1: granite_slab`, `2: interlocking_brick`, `3: concrete_tile`) と `vPavingUv` / `evaluateSidewalkPaving` を実装し、目地・微細凹凸法線・雨水溜まり暗化を付与。
- `JapaneseRoadBuilder.applyCurb3DTexture` が `vUv` ではなく `vCurbUv` を使って 60cm 伸縮目地を描くよう統一し、L 型側溝にも専用コンクリートマテリアルを適用。
- `JapaneseRoadMaterial` の側溝水たまり・街灯帯ラテラル位置を `uRoadWidth * 0.5` スケール連動へ変更。

### 2.3 片側独立クリッピング ＆ 曲線道路標示・防護柵刷新 (`roadCrossSection.ts`, `roadBuilder.ts`)

- **`computePerSideCorridorIntervals`**: 左右独立に 3 点の横方向プローブ (`innerOffset`, `mid`, `outerOffset`)・交差コリドー・交差点/直線道路車道 AABB (`sidewalkExclusionBoxes`)・広場除外円 (`sidewalkExclusionZones`)・急カーブ内側自己折返し (`prog <= 0.05`) を判定し、二分探索で境界を精密切り出しする。これにより T 字路反対側の歩道を維持しつつ他車道侵入を防止。
- 曲線道路において `inokashira-organ` (`2.2m`), `sakurazaka-loop` (`2.0m`), `hikarie-access` (`2.0m`) の歩道を復活させ、曲線上にも横断歩道前 JIS 点字警告ブロック (`CurvedTactileWarning_`) を設置。
- 曲線ガードレール (`CurvedGuardrail_`) が横断歩道・除外区間と同期して開口するよう統一し、反射体マテリアルを適用。さらに曲線白破線区間計算から 18m 黄色進路変更禁止実線区間 (`CurvedMarking_YellowNoLaneChange_`) を除外して重複描画を解消。

### 2.4 交差点自動アーム解決・隅切り R 歩道・接続整合 (`roadBuilder.ts`, `tokyoStationMap.ts`)

- `tokyoStationMap.ts` にて直線・曲線すべての道路登録後 (Section P 後) に `curvedRoadCorridors` と `pendingIntersections` を順番に構築するパイプラインへ再編。
- 全交差点パッドを自動スキャンして N/S/E/W 接続アーム（直線道路、centripetal 曲線道路、隣接パッド辺接触）を解決し、`buildIntersectionCornerSidewalks` により四隅の隅切り R カーブ歩道・縁石・L 型側溝・点字ブロック・T 字閉鎖辺連続歩道・安全コーナーコライダー (`groundBodyY` 補正込み) を一括生成。
- 重複 `Intersection_-380_250`、0 アーム孤立 `Intersection_-180_-150` を撤廃し、直線〜交差点のギャップ・食い込み (`Route-246-Aoyama-dori-Main`, `Chuo-dori-North-Kanda`, `Harumi-dori-Ginza`, `Shimbashi-Shiodome-Avenue`, 昭和通り 4 交差点 `width: 42`, `(-23.5, 250)`) を厳密整列。

### 2.5 `AssetManagerUI` ＆ ランタイム反映 (`assetManagerUI.ts`, `main.ts`, `tokyoStationMap.ts`)

- 道路エディタに `solid_white` 中央線および `hasSidewalk`, `hasCrosswalks`, `hasTactilePaving`, `hasGuardrails` の編集 UI を追加し、`drawRoadCrossSectionPreview` を歩道タイル目地・L 型側溝・縁石・点字ブロック・ガードレール・立体分離帯・黄色進路変更禁止線対応へ刷新。
- `TokyoStationMap.applyRoadDefinitionOverride(road)` と `onApplyRoadToScene` を結線し、車道幅 uniform 更新や歩道・標示・防護柵・分離帯の即時表示切替と構造化ログ出力を実装。

---

## 3. 検証結果（Trust Signals）

- **単体・結合テスト (`pnpm --filter web test` / `vitest run`)**: 25 ファイル / 216 テスト全合格（[`roadSystem.test.ts`](../apps/web/src/tests/roadSystem.test.ts) の新規検証 2 件および [`shibuyaConnectivity.test.ts`](../apps/web/src/tests/shibuyaConnectivity.test.ts) を含む）。
- **都市全体ジオメトリ監査スクリプト実測**:
  - 交差点総数 `54`、重複交差点 `0`、0 アーム孤立交差点 `0`。
  - 直線道路 (`67` 本) と交差点パッド間のエッジ誤差 (`0.05m〜3.5m`) `0` 件。
  - 直線歩道 (`134` 本) 同士の重なり `0` 件。
  - 交差点隅切り R 歩道 `104` 箇所・T 字閉鎖辺連続歩道 `10` 箇所・コーナー天面法線 (`+Y > 0.9`) `1248 / 1248` (`100.0%`)。
  - 曲線点字警告ブロック `76` 箇所・交差点コーナー点字警告ブロック `192` 箇所。
  - 曲線全 19 路線のうち歩道対象 17 路線（`scramble` / `center-gai` を除く）すべてで左右歩道生成を確認（渋谷復活 3 路線を含む）。
- **品質ゲート**: `just format-code` および `just verify-all` により整形・型検査・Lint・全テスト・本番ビルドの通過を確認。

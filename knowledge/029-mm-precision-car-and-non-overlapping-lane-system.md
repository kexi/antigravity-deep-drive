---
title: ミリ単位（1mm = 0.001m）車両3Dモデリングと非重複車線・横断歩道レンダリングシステム
tags:
  - roads
  - graphics
  - architecture
trust_signals:
  verified_date: 2026-11-04
  author: antigravity
  verification:
    - "blender --background --python blender/scripts/create_car.py && blender --background --python blender/scripts/verify_car_mm.py (0 floating parts, sub-millimeter intersection verified)"
    - "Blender MCP execute_blender_code with blender/scripts/generate_guardrail.py -> apps/web/public/models/guardrail.glb (7622 verts, 6384 faces) + 360-degree 6-angle review"
    - "just format-code && just verify-all (20 test files / 168 tests passed, including 2D XZ bounding-box non-overlap tests, Q/E/Z turn signal tests, and guardrail corner-cube retroreflector shader tests)"
    - "Chrome DevTools MCP visual verification of Shibuya (Meiji-dori 6-lane), Tokyo Station (Gyoko-dori 4-lane), Q/E/Z turn signals, and guardrail retroreflectors"
---

# ミリ単位（1mm = 0.001m）車両3Dモデリングと非重複車線・横断歩道レンダリングシステム

## 1. 背景と課題

1. **ルームミラー・内装パーツのミリ単位接合**:
   - 従来の車両モデル（`create_car.py` および `carModel.ts`）では、フロントガラス内面やルーフヘッダーの曲率（クラウンキャンバー）に対してルームミラー台座（`RearviewMirrorBase`）やミラーアーム（`RearviewMirrorStay`）の座標が概算指定されていたため、斜め視点やドライバー視点でバックミラーが宙に浮いて見える問題があった。
2. **車線描画の網羅性と横断歩道・車線の重複排除**:
   - 片側3車線道路（明治通り・日比谷通り等）で第3車線（外側の左折・直進車線 `localX = ±8.75m`）に進行方向矢印やダイヤマーク（`◇`）、最高速度標示が描画されていなかった。
   - 横断歩道・停止線・中央導流帯（ゼブラゾーン）・交差点パッドの四隅・曲線道路接続部において、縦断方向の車線（中央線・車線境界破線・路肩外側線）や交差点誘導ドットが横断歩道と重なる箇所が存在した。
   - 初期スポーン座標（渋谷 `x = -746.5`、東京駅 `x = 3.5`）がいずれも道路中心から `+3.5m`（白破線の車線境界線上）になっていた。

---

## 2. ミリ単位（`1mm = 0.001m`）車両モデリング設計

- [`blender/scripts/create_car.py`](../blender/scripts/create_car.py) に `mm(val_mm)` ヘルパーを導入し、実寸 JDM 3ナンバーセダン（全長 `4720mm` × 全幅 `1840mm` × 全高 `1430mm`、ホイールベース `2820mm`）の座標系をミリ単位で定義。
- **ルーフ・フロントガラス内面へのルームミラー完全接合**:
  - ルーフ前端ヘッダー内面（`z = 1368mm`）とフロントガラス内面（`y = -280mm..0mm, z = 1362mm..1382mm`）に直結する台座 `RearviewMirrorBase`（天面 `z = 1380mm` でルーフライナーへ `12mm` 貫入接合）および角度付きステー `RearviewMirrorStay`（ボールジョイント `y = -325mm, z = 1282mm` まで連続接続）を造形。
  - [`apps/web/src/vehicle/carModel.ts`](../apps/web/src/vehicle/carModel.ts) の Three.js 側動的ミラーグループ（`RearviewMirrorGroup`）でも、フロントガラス取付ベースパッド（`y = 1.356m, z = -0.352m`）・ルーフヘッダー接合フランジ（`y = 1.366m, z = -0.332m`）・二軸ボールジョイント付き斜めステーをミリ単位で構築し、どの角度から見ても宙に浮かない構造を保証。

---

## 3. 車線レイアウト計算（`computeRoadLaneLayout`）と非重複レンダリング

- [`apps/web/src/roads/roadMarkings.ts`](../apps/web/src/roads/roadMarkings.ts) に `computeRoadLaneLayout` を実装：
  - 片側 `1〜3+` 車線の各車線（`laneIndex`, `direction: "inbound" | "oncoming"`, `centerX`, `innerBoundaryX`, `outerBoundaryX`, `arrowType`, `rotationY`）を一元算出。
  - 各横断歩道中心 `cwZ` に対して `[cwZ - 5.2m, cwZ + 5.2m]`（停止線外端 `±4.025m` からさらに `1.175m` のクリアランス）および道路セグメント両端 `1.5m` を縦断ライン除外区間（`crosswalkExcludeZRanges`）として統合マージ。
  - 停止線（`StopLine`）は中央線から `0.25m`、路肩線から `0.25m` の内側マージンを取り、横断歩道ゼブラ（`CrosswalkStripe`）も路肩線から `0.45m` 内側に収めることで、縦断ラインとの接触をゼロにした。
- **交差点パッド（`createIntersectionMarkings`）の四隅非重複化**:
  - 南北横断歩道（`IntersectionCrosswalkNS`）と東西横断歩道（`IntersectionCrosswalkEW`）の横幅上限を `Math.min(carriagewayW * 0.5 - 0.45, edgeOffset - cwDepth * 0.5 - 0.65)` でクランプし、交差点の四隅で直交する横断歩道同士が重ならないようにした。
  - 交差点内の誘導ドット破線（`IntersectionGuideDot`）は主道路方向のみかつ横断歩道内端から `1.4m` 以上内側・中央ダイヤから `1.6m` 以上外側の安全領域にのみ配置。
- **曲線道路（`buildPolylineSegment`）の始終端トリム**:
  - [`apps/web/src/roads/roadBuilder.ts`](../apps/web/src/roads/roadBuilder.ts) の曲線道路標示リボン（中央線・路肩線・破線）の始終端を `3.2m`（破線は `6.0m`）トリムし、接続先の直線道路の横断歩道や交差点パッドと重ならないようにした。
- **走行車線中央への初期スポーン修正**:
  - [`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts) の初期スポーン位置を、渋谷（明治通り・片側3車線）は第2車線中央 `x = -744.75`（`localX = +5.25m`）、東京駅（行幸通り・片側2車線）は第1車線中央 `x = 1.75`（`localX = +1.75m`）へ修正。

---

## 4. ウインカー（`Q` 左 / `E` 右 / `Z` ハザード）＆フラッシャーリレー音システム

- **キーボード割り当てとミラー視線プリセットの共存**:
  - [`apps/web/src/core/inputManager.ts`](../apps/web/src/core/inputManager.ts) にて、`Q` 単押しを左ウインカー（`"left"` トグル）、`E` 単押しを右ウインカー（`"right"` トグル）、`Z` をハザードランプ（`"hazard"` トグル）に割り当て。
  - 従来の左右ドアミラー視線プリセットは `Shift+Q`（`left_mirror`）および `Shift+E`（`right_mirror`）に割り当て、WASD 操舵中の直感的なウインカー操作とミラー視線ショートカットを両立。
- **3D 外装アンバーLED・JIS右ウインカーレバー・12.3インチメーター連動**:
  - [`apps/web/src/vehicle/carModel.ts`](../apps/web/src/vehicle/carModel.ts) に `TurnSignalLamps`（前後バンパー＆左右ドアミラーのアンバーLEDストリップ）を構築し、UN R48 規格準拠の毎分約88回（半周期 `0.34s` ON / `0.34s` OFF）で点滅。
  - JIS規格の右ステアリングコラムレバー（`TurnSignalStalk_R`）が左折時は上（`rotation.z = -0.40 rad`）、右折時は下（`rotation.z = +0.04 rad`）にチルトし、12.3インチデジタルメータークラスターの `◀` / `▶` インジケーターおよび Web Audio フラッシャーリレー音（[`EngineAudioSystem.triggerTurnSignalClick`](../apps/web/src/audio/engineAudioSystem.ts) のカチッ・コチッ音）、旋回完了後のステアリングオートキャンセルと完全同期。

---

## 5. 日本の道路交通法・道路標識、区画線及び道路標示に関する命令（標識令）への完全準拠

1. **進路変更禁止（規制標示 102の2・道路交通法第26条の2第2項・第30条）の黄色実線**:
   - [`apps/web/src/roads/roadMarkings.ts`](../apps/web/src/roads/roadMarkings.ts) の `computeRoadLaneLayout` および `createLaneDividers` を拡張し、片側2車線以上の道路（`lanesPerDirection >= 2`）では横断歩道・停止線の手前アプローチ区間（最大 `30m`）に黄色実線の車線境界線（`LaneDivider_SolidYellow`, `userData.isNoLaneChangeYellow = true`）を、それ以外の通常区間には白破線（`LaneDivider_Dash`, `userData.isNoLaneChangeYellow = false`）を、左側通行の進行方向（自車 `+Z` 進行は `x > 0`、対向 `-Z` 進行は `x < 0`）に合わせて描画。
2. **路面最高速度標示（規制標示 105・標識令別表第6）の白色化**:
   - 標識令別表第6に基づき、`createSpeedLimitRoadMarking` の路面数字ペイント（`40` / `50`）を法定の白色（`#f8fafc`, `white-paint` 3Dテクスチャ, `userData.paintColor = "white"`）に統一。
3. **交差点四方向アプローチの左側通行停止線（指示標示 203・道路交通法第43条）**:
   - `createIntersectionMarkings` にて、南北・東西の各交差点流入車線（左側通行アプローチ半幅のみ）の横断歩道手前 `0.65m` に白実線の停止線（`IntersectionStopLine_NS_*`, `IntersectionStopLine_EW_*`）を配置し、横断歩道と重ならないことを自動テストで保証。
4. **車線数連動の進行方向別通行区分標識（327の7）と路線別地点名・通称名標識（114-A / 119-A）**:
   - [`apps/web/src/roads/roadSigns.ts`](../apps/web/src/roads/roadSigns.ts) の `createLaneDirectionSign` および [`apps/web/src/roads/roadSignSystem.ts`](../apps/web/src/roads/roadSignSystem.ts) を拡張し、2車線道路（`直進・左折 | 右折`）と 3車線道路（明治通り等：`直進・左折 | 直進 | 右折`）の双方に対応。
   - [`apps/web/src/roads/roadBuilder.ts`](../apps/web/src/roads/roadBuilder.ts) の `resolveRoadSignLocalizedLabels` により、渋谷エリア（明治通り・青山通り R246・稲荷橋通り・並木橋通り・宮下公園通り・さくら坂）と東京駅丸の内エリア（行幸通り・日比谷通り・内堀通り・永代通り・鍛冶橋通り・丸の内仲通り）の各路線に応じた信号機地点名板（`114-A`）と通称名標識（`119-A`）を自動付与。
   - [`apps/web/public/config/assets.yml`](../apps/web/public/config/assets.yml) の `no_entry_plaza`（車両進入禁止 303）および `stop_marunouchi_entry`（一時停止 330）を車道中央から左側通行の左歩道端・進行方向正対角度へ再配置。

---

## 6. ガードレール・視線誘導標（デリネーター）のコーナーキューブ再帰反射（Retroreflector）システム

1. **Blender 3D モデル（`guardrail.glb`）の日本の標準視線誘導標（DEL）2系統化**:
   - [`blender/scripts/generate_guardrail.py`](../blender/scripts/generate_guardrail.py) を更新し、支柱天端の丸型両面視線誘導標（`add_delineator_unit`: 表面アンバー `DelineatorAmber` / 裏面ホワイト `DelineatorWhite`、3本おき配置）に加え、日本の道路（JIS G 3444 / 視線誘導標設置基準）で広く採用されている **Wビーム中央谷部（`z_center = 0.630m`, `x = 0.098m..0.146m`）の台形両面デリネーター（`add_wbeam_trough_reflector`）** を全支柱位置に追加造形し、[`apps/web/public/models/guardrail.glb`](../apps/web/public/models/guardrail.glb) を再生成・360度6アングルで検収。
2. **コーナーキューブ（マイクロプリズム）＆ガラスビーズ再帰反射シェーダー（`uRoadPropMode == 8`）**:
   - [`apps/web/src/roads/roadProps.ts`](../apps/web/src/roads/roadProps.ts) の `applyRoadProp3DTexture(mat, "retroreflector")` にて、単なる常時定数発光（フラットな `emissive`）ではなく、入射光（左右ツインヘッドライト `uHeadlightPosL` / `uHeadlightPosR` および車両進行方向 `uVehicleForward`）の方向へ強い光束を返す **再帰反射光学モデル** を実装。
   - **マイクロプリズム六角ハニカム格子と距離連動スパークル**:
     - `vPropWorldPos` から約 `3.6mm` ピッチの六角ハニカム格子（`honeycombLattice`）と 3D ボリュームテクスチャ（`uPropVolumeTex`）による微細プリズムファセットきらめき（`microSparkle`）を合成。
   - **観測角・入射角に応じたダイナミック輝度変調**:
     - `#include <emissivemap_fragment>` で `totalEmissiveRadiance` を変調し、ヘッドライト照射コーン外やオフアングルでは控えめなベース反射（約 `0.14x〜0.45x`）に抑えつつ、ヘッドライト光軸・カメラ視線と正対した際には最大約 `6.8x` の高輝度再帰反射とホットコアのプリズム閃光を発生させる。
     - [`apps/web/src/roads/roadSigns.ts`](../apps/web/src/roads/roadSigns.ts) の路側視線誘導標（`createDelineatorPost`）および [`apps/web/src/main.ts`](../apps/web/src/main.ts) の毎フレーム車両ヘッドライト同期（`RoadProps.syncRetroreflectorEnvironment`）と統合し、中距離 LOD（`"medium"`）でも反射板が消えないよう `RoadProps.applyGuardrailSlotLod` を改善。

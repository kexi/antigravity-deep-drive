---
title: 3Dボリュームテクスチャ生成・Rapierレイキャスト車両物理・高精度3Dモデリング刷新・Blender公式MCP導入
tags:
  - graphics
  - physics
  - architecture
  - roads
trust_signals:
  verified_date: 2026-11-01
  author: antigravity
  environment: Blender 5.2.2 LTS CLI & Official blender-mcp, Three.js r182 (WebGL2 sampler3D), @dimforge/rapier3d-compat DynamicRayCastVehicleController, Vitest, Chromium Playwright
---

# 3Dボリュームテクスチャ生成・Rapierレイキャスト車両物理・高精度3Dモデリング刷新・Blender公式MCP導入

## 1. 数学的3Dトーラス周期ボリュームテクスチャ (`Data3DTexture` / `sampler3D`)

[`apps/web/src/textures/procedural3DTexture.ts`](../apps/web/src/textures/procedural3DTexture.ts) を拡充し、3次元トーラス $T^3$ 上で境界（$0.0 \leftrightarrow 1.0$）が数学的に完全連続となる周期的 3D Perlin FBM・異方性 3D ノイズ・周期的 3D Worley クラックノイズを実装した。

- **生成される 4 種の 3D ボリュームテクスチャ**:
  1. `generateAsphalt3DTexture`: アスファルト砕石粒度 (R)・3D Worley クラック (G)・舗装補修パッチ (B)・水たまり盆地深度 (A)。`JapaneseRoadMaterial` および `PuddleMaterial` (`uRoadVolumeTex`) に統合。
  2. `generateFoliageBark3DTexture`: イチョウ葉クラスタ＆葉脈密度 (R)・異方性縦溝樹皮ハイト (G)・コケ＆葉色個体差 (B)・SSS 透過＆キャビティ AO (A)。`GinkgoFoliageMaterial` および `TreeBarkMaterial` (`uFoliageBarkVolumeTex`) に統合。
  3. `generateArchitecture3DTexture`: 東京駅赤レンガ焼成ムラ (R)・丸の内白御影石結晶グレイン (G)・皇居お堀切込接ぎ石垣目地 (B)・雨水風化 AO (A)。`TokyoStationMap` の建築石材・レンガ・お堀石垣シェーダー (`uArchVolumeTex`) に統合。
  4. `generateFog3DTexture`: 雨煙・大気ボリュメトリックフォグ用 `RedFormat` 3D 密度場。
- **Blender 3D プロシージャル PBR マテリアル生成**:
  - [`blender/scripts/generate_3d_pbr_textures.py`](../blender/scripts/generate_3d_pbr_textures.py) にて `JapaneseRoadPBR_3D`, `GinkgoFoliagePBR_3D`, `GinkgoBarkPBR_3D`, `TokyoStationBrickGranitePBR_3D` の 4 種の 3D ノードツリーを構築し、`blender/output/road_3d_material.blend` に保存。

## 2. Blender 公式 MCP Server (`blender_mcp`) の導入

- Blender Lab 公式リポジトリ (`https://projects.blender.org/lab/blender_mcp.git`) を `/Users/kei/ghq/projects.blender.org/lab/blender_mcp` に配置。
- Blender 5.2.2 LTS アドオン登録および `~/.local/bin/blender-mcp` CLI ラッパーを作成し、`~/.gemini/config/mcp_config.json` に `"blender-mcp"` サーバーを登録。`just start-blender-mcp` でバックグラウンド起動可能にした。

## 3. Rapier 3D 公式 `DynamicRayCastVehicleController` による4輪車両物理

[`apps/web/src/physics/vehicle.ts`](../apps/web/src/physics/vehicle.ts) における従来の単一剛体 `applyImpulse` / `applyTorqueImpulse` 手書き近似を廃止し、`@dimforge/rapier3d-compat` 組込みの **`world.createVehicleController(this.rigidBody)` (`DynamicRayCastVehicleController`)** に全面移行した。

- **4輪レイキャストサスペンション**:
  - 4輪それぞれのサスペンション自然長 (`0.32m`)・バネ剛性 (`38.0`)・減衰係数 (`4.2` / `4.8`)・最大ストローク (`0.24m`)・タイヤ摩擦スリップ (`2.4`) を設定。
  - レイキャストフィルタ predicate で自車シャシーコライダーを除外し、路面との正確な接地判定とサスペンション伸縮長 (`wheelSuspensionLength`) を毎フレーム算出。
- **車体姿勢（ピッチ・ロール）とホイールストロークの3Dモデル同期**:
  - [`apps/web/src/vehicle/carModel.ts`](../apps/web/src/vehicle/carModel.ts) で車体剛体のクォータニオン（加減速時のノーズダイブ／スクワット、旋回時のロール）および 4 輪それぞれのサスペンション上下変位・ステアリング舵角・車輪スピン角をリアルタイム同期。

## 4. 360度全方向（8方位）レンダリングレビューと3Dモデリング精度の抜本的改善

Blender 5.2.2 LTS の EEVEE レンダラーで各モデルを **0°, 45°, 90°, 135°, 180°, 225°, 270°, 315° の 8 アングル**から 360 度撮影・検査し、特定された視覚的欠陥をすべて解消した。

1. **車両モデル (`blender/scripts/generate_vehicle_model.py` -> `car.glb` 216 KB)**:
   - **ホイール外蓋塞がりの解消**: `add_cylinder(..., cap_ends=True)` によってホイールの外側が平坦な円盤で塞がりスポークとブレーキが隠れていた問題を、中空リングバレル (`add_hollow_tube_x`) + 奥側ダークインナープレートに変更し、10本立体ツインスポークと奥のドリルドローター＆レッドキャリパーが全角度から鮮明に見えるように修正。
   - **ワイパーの前方空中飛び出しの解消**: ワイパーブレードが `-Y`（車両前方）へ伸びてフロントガラスを突き抜けていた問題を解消し、カウル下端 (`Y=-1.26, Z=0.89`) に沿って `-X` 方向へ寝かせてガラス曲面に密着配置。
   - **ルーフ後端〜ファストバックリアガラス・Cピラーの連続化**: ルーフ天板が C ピラーより後方まで張り出して段差になっていた問題を解消し、ルーフ後端 (`Y=0.72, Z=1.365`) からトランク前縁 (`Y=1.74, Z=0.89`) まで C ピラー間に 3D 曲面スモークリアガラス (`WindowGlass`) を張ることで段差のないクーペシルエットを実現。
   - **前後ライトのフラッシュ露出＆インナーフェンダー追加**: フロントノーズ・リアパネル内部に埋没していたラップアラウンド LED ヘッドライトと一文字貫通型 LED テールバーを外表面にフラッシュ露出させ、タイヤ裏の透けを防ぐホイールハウス遮光ライナーとキャビンフロア・ドアトリムを追加。
2. **イチョウ街路樹モデル (`blender/scripts/generate_street_tree.py` -> `street_tree.glb` 750 KB)**:
   - **フラットな十字板カードの廃止**: 45°・135° 等から見た際にトゲのような直線影を生んでいた平面交差カード (`add_biloba_leaf_card`) を全廃し、3D イチョウ葉房パフ (`add_organic_leaf_puff`: 520 個) と 35 個の高分割ローブによる立体樹冠へ刷新。
   - **下枝分岐の可視化と 360 度対称の根元保護枠**: 樹冠の開始高さを `Z=2.95m` に引き上げて `Z=2.05m〜3.5m` の主枝・副枝の分岐構造が全方向から自然に見えるようにし、同心円スリット入り鋳鉄製ツリーガード＆御影石縁石を構築。
3. **東京駅丸の内駅舎モデル (`blender/scripts/generate_tokyo_station.py` -> `tokyo_station.glb` 1.63 MB)**:
   - **中央棟と南北ウィング棟の 5m ギャップ解消**: 中央棟 (`Y=-20..+20`) と南北ウィング棟 (`Y=±25..±70`) の間に空いていた 5m の隙間を、`Y=±18..±71` の連続ウィング構造に改めることで完全解消。
   - **360度全方向（正面・背面・側面・八角ドーム全8面）のディテール統一**: 正面 (`-X`) だけでなく背面 (`+X`)・側面 (`±Y`) にも白御影石水平バンド・ピラスター・アーチ窓・両面ドーマー窓・大時計付きペディメントを配置。南北八角ドーム塔は全 8 面の法線方向に整列したアーチ窓・コーナー双柱・連続ドームリブ・オクルス窓を備えた構造に刷新。
4. **丸の内高層ビル群＆交差点ガードレール修正 (`apps/web/src/city/tokyoStationMap.ts`)**:
   - 丸ビル・新丸ビル等に **丸の内百尺（31m）石積み商業ポディウム + 路面ショーウィンドウ + 軒蛇腹コーニス + セットバック高層カーテンウォール + 垂直アルミマリオン列 + 屋上メカニカルルーバー冠部 + 航空障害灯** を実装。
   - 東西交差道路（丸の内中央通り・日比谷通り）のガードレールが行幸通りの南北車線を横断して塞いでいた問題を修正（交差道路の `hasGuardrails: false` 化）。

## 5. 実景画像比較に基づく日本の道路標識・路面標示・丸の内ストリートファニチャーの拡充

実際の東京駅丸の内駅前広場・行幸通り・日比谷通り交差点の風景とレンダリング画像を照合し、不足していた以下の道路標識・路面ペイント・街路付属物を追加実装した：

1. **道路標識 (`JapaneseRoadSigns` / [`apps/web/src/roads/roadSigns.ts`](../apps/web/src/roads/roadSigns.ts))**:
   - **駐車禁止 (316) / 駐停車禁止 (315) + 補助標識プレート (`createNoParkingSign`)**: 赤枠青丸斜線標識と下部の白地補助標識（「終日」「ここまで」等）。
   - **転回禁止 (313) (`createNoUTurnSign`)**: 交差点手前のUターン禁止標識＋補助標識。
   - **一方通行 (326-A) (`createOneWaySign`)**: 青地白矢印長方形標識＋「自転車を除く」補助標識。
   - **進行方向別通行区分 (327の7) (`createLaneDirectionSign`)**: 交差点手前の青地3車線（直進＋左折・直進・右折）レーン案内標識。
   - **交差点名標識（地点名標識 114-A） (`createIntersectionNameSign` / `createIntersectionNamePlateMesh`)**: 信号機アームおよび交差点柱に設置される白地青枠「東京駅丸の内中央口」「行幸通り前」「和田倉門」プレート。
   - **視線誘導標（デリネーター）＆黄黒ゼブラ反射標示板 (`createDelineatorPost`)**: 中央分離帯端・交差点端の安全施設。
   - **オーバーヘッド大型案内青看板 (108-A) の両面化＆上部外照式照明ランプ追加**: 走行方向（`+Z` 皇居・和田倉門方面行き）のドライバーから正面が見えるように `assets.yml` / `defaultAssetsYaml.ts` の座標と向きを最適化。
2. **路面標示 (`RoadMarkings` / [`apps/web/src/roads/roadMarkings.ts`](../apps/web/src/roads/roadMarkings.ts) & [`apps/web/src/roads/roadBuilder.ts`](../apps/web/src/roads/roadBuilder.ts))**:
   - **横断歩道予告ダイヤマーク（◇：指示標示 210） (`createCrosswalkDiamondMarking`)**: 横断歩道手前の車線中央に連続配置。
   - **車線別進行方向矢印ペイント (`createLaneArrowMarking`)**: 直進矢印（↑）、直進＋左折矢印（↰↑）、右折矢印（↱）。
   - **路面最高速度ペイント (`createSpeedLimitRoadMarking`)**: 車線上の「40」「50」縦長ペイント標示。
   - **導流帯（ゼブラゾーン） (`createZebraZoneMarking`)**: 交差点手前の中央ゼブラ帯。
3. **丸の内・行幸通りストリートファニチャー ([`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts))**:
   - **白御影石ボラード（車止め石柱） (`buildGraniteBollards`)**: 行幸通り歩道境界に並ぶドーム頭頂＋ブロンズ黒装飾帯付きの御影石ボラード列。
   - **丸の内伝統の2灯式黒鋳鉄クラシカル街灯 (`createStreetLamp`)**: フルート装飾台座と2灯ランタングローブ・笠を備えたクラシカル街灯。

## 6. 検証結果 (Trust Signals)

- `just model-assets && just generate-textures`: Blender 5.2.2 LTS CLI で全 GLB (`car.glb`, `tokyo_station.glb`, `street_tree.glb`) および `road_3d_material.blend` がエラーゼロで生成。
- 360度全方向レンダリング検証: `car`, `tree`, `station_center`, `station_dome` の各 8 アングル（計 32 枚）を Blender EEVEE でレンダリングし、すべての角度で破綻・浮遊パーツ・隙間・埋没がないことを視覚確認。
- `just format-code && just verify-all`: `roadSystem.test.ts`（新規道路標識・路面標示テスト追加）、`assetManager.test.ts`、`vehicle.test.ts`、`texture3d.test.ts` を含む全 11 テストファイル・45 テストがパス。
- Playwright 実機ブラウザ検証: コンソールエラー・警告 0 件で、車内視点・追従視点ともに追加された道路標識・路面ダイヤマーク・進行方向矢印・御影石ボラード・2灯式街灯が美しく描画されることを確認。

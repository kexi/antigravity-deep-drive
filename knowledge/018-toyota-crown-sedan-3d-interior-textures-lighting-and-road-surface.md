---
title: トヨタ クラウン セダン (AZSH32) 360度モデリング・車内3Dテクスチャ・キャビン＆4眼LEDヘッドライト光源・路面状態分離・ドライバー視点防振
tags:
  - graphics
  - physics
  - roads
  - architecture
trust_signals:
  verified_date: 2026-11-04
  author: antigravity
  verification_method:
    - Blender MCP (execute_blender_code / render_viewport_to_path) による 360度マルチアングル＋車内レンダリング収束レビュー
    - Google Street View 実写パノラマ（日比谷通り大手町交差点 panoid=sswNlshZHloTRzbinMy4RA / 日比谷通り panoid=2noNHSHmqeDeHpBMpFPyww / 和田倉門交差点 panoid=EYjFT0pvZZuvb7MWE8sDng / 行幸通り panoid=IaaeaUU12Z1sH-ffN2s2pQ）による案内標識（F型片持ち式単柱）および密粒度アスファルト路面の実地検証
    - Vitest 単体テスト全通過 (just verify-all)
    - Chrome DevTools MCP 実ブラウザによる昼・夕暮れ・夜間・雨天・晴天×雨上がりのコックピット視点（正面 [V]・ルームミラー [I]・右ミラー [E]・左ミラー [Q]）WebGL 実画面レンダリング検証
---

# トヨタ クラウン セダン (AZSH32) 3Dモデリング・車内3Dテクスチャ・光源・路面状態・ドライバー視点防振

## 1. トヨタ クラウン セダン (AZSH32 / KZSM30) 実寸モデリングと360度収束レビュー

- **実寸プロポーション（1 Unit = 1.0m）**:
  - 全長 `5.03m`（`z = -2.44m .. +2.34m`）、全幅 `1.89m`（`x = ±0.945m`）、全高 `1.47m`、ロングホイールベース `3.00m`（前輪 `z = +1.42m`、後輪 `z = -1.42m`）の FR 6ライト・ファストバックセダンとして [`blender/scripts/generate_vehicle_model.py`](../blender/scripts/generate_vehicle_model.py) で構築。
- **エクステリア造形**:
  - **ハンマーヘッド（Hammerhead）フロントフェイス**: 鋭く張り出したアッパーノーズ、横一文字シグネチャー LED デイタイムランニングランプ、片側4眼（計8眼）の超薄型 Bi-Beam LED プロジェクターランプ、アンダースプリッター一体型の大型台形バーチカル（縦基調）メッキスリットグリル。
  - **20インチ大径マルチスポークアルミホイール**: 15本細身のダークプレミアムメタリック・切削光輝スポークでブレーキディスク＆キャリパーを立体表現。
  - **リア一文字LEDテールランプ**: 全幅を貫くスリムな赤色LEDシグネチャーバーと中央王冠エンブレム。
- **360度＋車内マルチアングル収束レビュー**:
  - 第1回レンダリングで判明した「ホイールキャップによるスポーク遮蔽」「ドライバー視点での12.3インチセンターディスプレイ左端見切れ」「ルーフの影による車内インテリア暗転」を特定し、ホイールハブ小径化 (`r = 0.058m`)、センターディスプレイの右ハンドル運転席寄り配置 (`x = -0.132m`, 運転席向きチルト `+9.7°`)、車内2灯エリアライト追加を実施して第2回レンダリングで指摘事項ゼロに収束させた。

## 2. 車内内装（アイランドアーキテクチャー）3Dプロシージャルテクスチャ

- **Three.js `Data3DTexture` (`sampler3D uCrownInteriorVolumeTex`)**:
  - [`apps/web/src/textures/procedural3DTexture.ts`](../apps/web/src/textures/procedural3DTexture.ts) に `generateCrownInterior3DTexture(size = 32)` を実装。
  - 4チャンネル RGBA ボクセルに以下の4種類の車内質感をパッキングし、[`apps/web/src/vehicle/carModel.ts`](../apps/web/src/vehicle/carModel.ts) の `applyCrownInterior3DTexture()` で UV シームのない 3D ローカル座標 (`vCrownLocalPos`) からサンプリング：
    1. **R チャンネル (`wood`)**: 3D 異方性オープンポア杢目（ウッディブラウンの年輪導管と木目繊維、導管溝のマット感と木肌表面のセミグロスクリアコート）。
    2. **G チャンネル (`leather`)**: 3D Worley セルラーノイズによるセミアニリン本革ペブルシボ（ダッシュボード・ステアリング本革リム）。
    3. **B チャンネル (`perforated`)**: 3D 周期ディンプル格子によるパンチングレザー＆マイクロファブリック織り目（シート座面・背もたれ）。
    4. **A チャンネル (`satin`)**: 3D 異方性微細ヘアライン金属加飾（サテンシルバーベゼル・ステアリングスポーク）。
- **Blender 3D シェーダーノード連携**:
  - [`blender/scripts/generate_3d_pbr_textures.py`](../blender/scripts/generate_3d_pbr_textures.py) にも `build_3d_wood_grain_material` / `build_3d_leather_grain_material` / `build_3d_fabric_weave_material` を実装し、Blender ビューポートと GLB ベイクの両方で一貫した 3D 質感を保証。

## 3. 車内ライティングと4眼Bi-Beam LEDヘッドライト光源

- **車内キャビン専用ライティング (`setupInteriorLighting` / `setInteriorLighting`)**:
  - ルーフ天板やピラーによる車内黒潰れを防ぐため、GLB ロード時に `Interior` と `RearviewMirror` の `castShadow = false` を設定。
  - ルーフコンソール間接フィルライト (`cabinOverheadLight`) と、クラウン伝統の「行燈（あんどん）」をモチーフにした 64色マルチカラーアンビエントイルミネーション (`cabinAmbientLight`) を配置し、`TimeOfDay` × `WeatherCondition` に応じて色温度・輝度を自動制御。
- **4眼Bi-Beam LEDヘッドライト光源と自己遮蔽の解消 (`setupHeadlights` / `setHeadlights`)**:
  - **Why not**: 従来の `SpotLight` 座標 `(±0.65, 0.55, 2.15)` はフロントバンパー (`z = 2.15m 〜 2.34m`) の内部に埋まっており、車体メッシュ自身の `castShadow = true` によってヘッドライト光がバンパーの影で遮蔽されていた。
  - **How**:
    1. 左右メイン `SpotLight` をフロントノーズ先端・4眼レンズ表面すぐ外側の `(±0.66, 0.675, 2.38)` に配置し、`shadow.camera.near = 0.6`、照射距離 `115m`、照射角 `Math.PI / 3.1` に設定して自己遮蔽を根絶。
    2. ドライバー視点から手前〜中距離のアスファルト路面と車線をワイドに照らすロービーム補助 `SpotLight` (`headlightLowBeamLight`) を追加。
    3. 車外視点や路面鏡面反射からも「ヘッドライトの光源」が鮮明に視認できるよう、片側4眼（計8眼）の Bi-Beam LED プロジェクター発光レンズ、ハンマーヘッド横一文字 LED シグネチャーバー、およびボリューメトリック・ライトビームコーン (`headlightBeamConeGroup`) を構築。

## 4. 時間帯 × 天候 × 路面状態（RoadSurfaceCondition）の3軸直交分離

- **路面状態 (`RoadSurfaceCondition`: `dry` 乾燥 / `wet` 雨上がり・湿潤 / `puddle` 水たまり)**:
  - 「晴れだけど雨の後（晴天 × 雨上がり）」や「夕暮れ × 水たまり」「昼 × 完全乾燥」を自在に切り替えられるよう、[`apps/web/src/weather/weatherSystem.ts`](../apps/web/src/weather/weatherSystem.ts) に `currentRoadSurface` と `setRoadSurface()` を実装。
  - UI の `#road-surface-buttons`（乾燥 / 雨上がり / 水たまり）および `[G]` キーでリアルタイムに切り替えられ、[`apps/web/src/physics/vehicle.ts`](../apps/web/src/physics/vehicle.ts) のタイヤ摩擦係数（`frictionSlip`, `sideStiffness`）とも連動。

## 5. ドライバー視点（コックピットカメラ）の揺れ根絶と AVS フラットライド

- **3大揺れ原因の特定と解決**:
  1. **1フレーム遅延した `carGroup.matrixWorld` 参照の解消**:
     - `carModel.update()` で `position` / `quaternion` を更新した直後、および `cameraController.updateCockpitCamera()` の冒頭で必ず `carGroup.updateMatrixWorld(true)` を実行。これによりカメラと車内ダッシュボード・ステアリング・Aピラー間の1フレーム遅延ズレを完全にゼロにした。
  2. **カメラ単体への高周波サイン波加算の撤廃**:
     - カメラの `eyeWorld` だけに加算されていた `engineRumble` / `asphaltJitterY` / `asphaltJitterX` を撤廃し、運転席アイポイント `(-0.38, 1.13, 0.06)` に剛体同期。
  3. **クラウン AVS 高減衰サスペンション＆前庭動眼反射（VOR）視線安定化**:
     - [`apps/web/src/physics/vehicle.ts`](../apps/web/src/physics/vehicle.ts) で `AngularDamping = 3.8`、サスペンション減衰 `Compression = 6.4` / `Relaxation = 7.2` に高め、`smoothedVisualY` と `smoothedQuat`（Slerp）で可変フレームレート時の微小振動を平滑化。
     - [`apps/web/src/core/cameraController.ts`](../apps/web/src/core/cameraController.ts) で人間の前庭動眼反射（VOR）を模したピッチ・ロール視線安定化を適用し、車内インテリアとの相対ズレゼロと滑らかな前方視界を両立。

## 6. ビル背後の夕日によるレンズフレア貫通バグの解消（線形深度オクルージョン＆無限遠太陽射影）

- **原因**:
  1. **非線形デプスバッファ閾値 (`d >= 0.999`) の罠**:
     - `camera.near = 0.1`, `camera.far = 1000.0` の透視投影では、非線形深度値 $d = \frac{f}{f-n}(1 - \frac{n}{z_{\text{eye}}})$ により、距離 $100\text{m}$ 以上のビルすべてで $d \ge 0.9990$（例：距離 $110\text{m}$ の丸の内ビルディングで $d \approx 0.9991$）となる。そのため生の深度値で `d >= 0.999` を「空（遮蔽なし）」と判定すると、ビルの向こうに隠れた夕日でも `occlusion = 1.0` となりフレアが貫通していた。
  2. **有限座標 `[60, 42, 180]` の直接射影による視差ズレと `THREE.Lensflare` の重複**:
     - スカイドーム（`AtmosphericSky`）は無限遠の太陽方向単位ベクトルで太陽を描画しているのに対し、`LensFlarePass.updateSunPosition` と `dirLight` 子要素の `THREE.Lensflare` が有限ワールド座標 `(60, 42, 180)` を参照していたため、車両移動時に太陽位置とフレア位置の視差ズレが発生していた。
- **解決策**:
  - [`apps/web/src/shaders/lensFlare.ts`](../apps/web/src/shaders/lensFlare.ts) に `uCameraNear` / `uCameraFar` と `linearizeDepth(float d)` を追加し、`d >= 0.99995 && linearDepth >= uCameraFar * 0.95`（$950\text{m}$ 以上＝`depthWrite: false` のスカイドーム背景のみ）を空サンプルとして厳密判定。
  - `updateSunPosition(camera)` でカメラ位置から太陽方向単位ベクトルへ `camera.far * 0.9` 離れた無限遠相当座標を射影し、`weatherSystem.ts` 内の重複スプライト `this.lensflare.visible = false` に統一。

## 7. Google Street View 実写検証に基づくオーバーヘッド案内標識（F型片持ち式単柱）と3Dアスファルトテクスチャの修正

- **過去の誤りと訂正（Google Street View 実地検証）**:
  - **誤り**: 初回修正では「標識って片足しかないので実際の画像確認して修正」という指摘を「片足宙吊りバグなので両足（門型ガントリー `supportType = "portal"`）にして看板を2枚並べるべき」と誤解し、さらに `rotationY = Math.PI` 下でのローカルX座標とワールドX座標の符号関係を逆に解釈していた。
  - **Google Street View による事実確認**:
    - 東京駅丸の内周辺（日比谷通り・大手町交差点 `panoid=sswNlshZHloTRzbinMy4RA`、日比谷通り北向き `panoid=2noNHSHmqeDeHpBMpFPyww`、和田倉門交差点 `panoid=EYjFT0pvZZuvb7MWE8sDng`）の Google Street View 実写パノラマを取得・検証した結果、当該エリアの案内標識（108-A「方面及び方向」および108の2-E「進行方向別通行区分」）はすべて**門型（両足）ではなく、左側歩道端に1本の太い円筒支柱（単柱）のみが立つ「F型片持ち式単柱（片足）」**であることが確認された。
    - また、車両進行方向（`-Z` 北向き）に対して標識を `rotationY = Math.PI`（`+Z` 南向き正面）で配置する場合、ローカル座標 `localX` はワールド座標 `worldX = -localX` へ反転するため、左側歩道（`worldX = +9.6m`）に支柱を建てるには **`localX = -span / 2 = -9.6m`** に配置する必要がある。
- **F型片持ち式（`supportType = "cantilever"` 既定）の実写準拠造形 ([`apps/web/src/roads/roadSigns.ts`](../apps/web/src/roads/roadSigns.ts), [`apps/web/src/city/tokyoStationMap.ts`](../apps/web/src/city/tokyoStationMap.ts))**:
  1. **左側歩道1本柱（`GantryColumn_CantileverLeft`, `localX = -span / 2 = -9.6m` → `worldX = +9.6m`）**:
     - 左側歩道植樹帯外縁に単柱1本のみを建て、柱頭は上段水平アームのすぐ上（`columnHeight = 6.72m`）でフラットキャップにより終端（実写通り、看板より高く突き出さない）。狭幅員道路（`spanWidth < 6.0m`）指定時も `armExposeGap` を自動クランプし、対向歩道側へオーバーフローしない設計とした。
  2. **2本平行鋼管アーム（`GantryUpperBeam` `y = 6.52m` / `GantryLowerBeam` `y = 5.18m`）とサドルブラケット**:
     - 支柱内側面の上下アーム根元を縦型サドルブラケット（`CantileverSaddleBracket`）と上下リングバンドで剛結し、斜めトラスのないスッキリした2本平行鋼管アームで車道側へ張り出す。
     - 支柱から看板左端まで `1.9m` のアーム露出区間を設け、単一の青看板（`PrimaryGuideBoard`, `3.6m × 2.75m`, 中心 `localX = -5.9m` → `worldX = +5.9m`）を支持し、看板右端直後（`beamEndX = -3.96m`）でパイプエンドキャップにより終端させることで、看板の先へ空ビームが突き出さない実写通りのシルエットを再現。
  3. **大手町・和田倉門 108-A 青看板の忠実な描画と路側標識の支柱オフセット・歩道左右整合**:
     - 大手町交差点の 108-A 実写に合わせ、高彩度コバルトブルー（`#0052ac`）と角丸白枠、中央を貫く白い縦矢印（`↑`）、下部（`y = 580`）で交差する水平矢印（`← ——— →`）、交差部中央の角丸白地交差点名ピル（`[行幸通り]` / `[和田倉門]`）、都道404号六角形バッジ（`[404]`）、国道1号の逆おにぎり型バッジ（`drawRouteBadge`）、および水平矢印の上方に配置した左右方面地名・英語表記を実装。
     - 路側標識の円筒支柱を背面板の後ろ（`z = -0.06m`）へオフセットして標識表面への支柱貫通（縦縞アーティファクト）を解消するとともに、北向き（`+Z` 進行）車線に対する左歩道標識群を `worldX = +9.2m / +9.5m` へ統一。
- **密粒度アスファルト混合物（13mm）3D ボリュームテクスチャの刷新 ([`apps/web/src/textures/procedural3DTexture.ts`](../apps/web/src/textures/procedural3DTexture.ts), [`apps/web/src/roads/japaneseRoadMaterial.ts`](../apps/web/src/roads/japaneseRoadMaterial.ts))**:
  - **3次元周期的 Worley セルラーボロノイ砕石骨材と骨材間ボイドの 3D ボクセル生成 (`generateAsphalt3DTexture(64)`)**:
    - `worleyCellF1AndVoidPeriodic` による $F_1$ 砕石粒子プロファイルと $F_2 - F_1$ セル境界ボイドにより、ロードローラーで転圧された砕石の平坦な頂部プラトー（Rチャンネル）、骨材同士の噛み合わせ隙間ボイド＆クラック（Gチャンネル）、歴青アスファルトバインダー被膜と石英・長石の結晶反射（Bチャンネル）、および轍・水たまり盆地ハイト（Aチャンネル）を `Data3DTexture`（RGBA $64^3$）にエンコード。
  - **道路ローカル座標 (`vLocalRoadPos`) と重複排除済み4階層 3D シェーダーサンプリング**:
    - 頂点シェーダーで `vLocalRoadPos = transformed;` を伝播させ、東西道路（日比谷通り等）でもタイヤ摩耗帯（`tireTrackWear`）、縦断施工目地（`laneJoint`, `|x| = 0, 3.5, 7.0m`）、轍水たまり（`rutBasin`）が常に車線方向へ正しく伸びるように修正。
    - `<metalnessmap_fragment>` で `coordMicro`（砕石エッジ・石英結晶粒子）、`coordFine`（13mm〜20mm 主骨材粒子）、`coordCoarse`（骨材粒度偏析パッチ）、`coordMacro`（フィニッシャー施工うねり）の4階層 `voxelMicro..voxelMacro` と `puddleCoreMask`・`puddleRippleVec` を1回ずつ評価し、後続の `<normal_fragment_maps>` でその計算結果を再利用（中心再フェッチ4回と水たまり・波紋の再計算を排除し、合計10回の `sampler3D` ルックアップに最適化）。

## 8. ミリメートル（`1mm = 0.001m`）精度の接合監査：ルームミラー宙浮き解消・左右ドアミラーRHD視界整合・ステアリングコラム同軸化

- **車内ルームミラー（`RearviewMirror` / `RearviewMirrorGlass`）の宙浮き解消（`0.0mm` ギャップ結合）**:
  - **原因**: ルームミラー本体（ピボット `X = -0.140m, Y = -0.690m, Z = 1.232m`、上端 `Z = 1.270m`）の背面に短い水平ネック（`p1 = (-0.140, -0.742, 1.312)`）しかなく、フロントガラス内面（`Y = -0.742m` で `Z = 1.326m`）およびフロントルーフヘッダー／オーバーヘッドコンソール下端（`Z = 1.340m`）との間に `14mm〜28mm` の空中ギャップが生じていた。さらにドライバー視点（`Z = 1.130m`）からミラー上縁（`Z = 1.270m`）を見上げると、ミラー筐体背後に隠れた低いネックが死角となり、ミラー本体が完全に宙に浮いて見えていた。
  - **解決策 ([`blender/scripts/generate_vehicle_model.py`](../blender/scripts/generate_vehicle_model.py), [`apps/web/src/vehicle/carModel.ts`](../apps/web/src/vehicle/carModel.ts))**:
    1. フロントガラス内面（`Y = -0.920m .. -0.620m, Z = 1.224m .. 1.398m`）とルーフライナー前端（`Y = -0.650m .. -0.480m, Z = 1.340m .. 1.425m`）に `0.0mm` ギャップで密着する **Toyota Safety Sense 3.0 ADAS カメラセンサーポッド**（`X = -0.220m .. +0.060m, Y = -0.840m .. -0.635m, Z = 1.283m .. 1.420m`）およびガラス面セラミックドットマトリクス遮光バンド（`Z = 1.275m .. 1.418m`）をモデリング。
    2. ADAS ポッド底面およびルーフコンソール（`Z = 1.352m`）から下方へ突き出すマウントボス（`X = -0.140m, Y = -0.728m, Z = 1.296m .. 1.352m`）と、ミラー上縁より上から見えてミラー背面スパイン（`Z = 1.257m`）および背面ボールジョイント（`Z = 1.244m`）へ連続するアッパーステー（`p_roof_mount = (-0.140, -0.728, 1.324)` → `p_neck = (-0.140, -0.706, 1.278)` → `p_top_spine`）を構築。これにより正面・ルームミラー注視・接写のあらゆる角度から空中ギャップ `0.0mm` でルーフへ剛結され、かつミラー正面ベゼル上縁へステーが一切はみ出さない造形に収束させた。
- **左右ドアミラー（`SideMirror_R` / `SideMirror_L`）のヨー角スイープ整合と JDM RHD 左Aピラー死角回避**:
  - ドアミラーハウジングの内振りヨー角スイープ（右 `22.0°` / 左 `27.0°`）によるハウジング底面中心の移動量 `transform_mirror_pt(-side * 0.032, -0.026, -0.032)` を事前計算し、ドアベルトラインのデルタガセット（`Z = 0.876m`）からスイベルボス（`Z = 0.913m .. 0.935m`）を介してハウジング底面へ `0.0mm` ギャップで貫入させた。
  - 日本仕様の右ハンドル（運転席アイポイント `X = -0.380m, Y = +0.060m, Z = 1.130m`）において、助手席側の左ドアミラーを右と同じ `Y = -1.005m` に置くと左Aピラーおよび車内側アルカンターラ内張り（`Z = 0.962m` 断面で `Y = -1.15m .. -1.03m`）と視線が干渉するため、実車の右ハンドル車設計（UN R46 視界基準）に準拠して左ドアミラーピボットを `Y = -0.880m`（Three.js `z = +0.880m`）、内振りヨー角を `27.0°`、左ミラー視線プリセット（`[Q]`）を `yaw = +47°, pitch = -6°` に設定し、左Aピラーのケラレをゼロにした。
- **ステアリングホイールとステアリングコラム（`SteeringColumnAssembly`）の完全同軸化（`0.0mm` 偏心）**:
  - ステアリングホイール中心 `(-0.380, 0.900, 0.440)`・チルト角 `20°`（`0.35 rad`）の回転軸直線 `(x = -0.380, y = 0.900 - d * sin(0.35), z = 0.440 + d * cos(0.35))` 上に、`SteeringColumnAssembly` の基準点 `d = 55mm` → `(-0.380, 0.881, 0.492)`（チルト `0.35 rad`）および `car.glb` 内 `Interior` のコラムシュラウド（`d = 85mm .. 225mm`）を一致させ、ステアリング操舵時の偏心ブレと隙間を根絶した。

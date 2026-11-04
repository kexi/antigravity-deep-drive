---
title: Three.js フラグメントシェーダーにおける normalMatrix と metalnessFactor コンパイル不整合の解決
tags:
  - graphics
trust_signals:
  verified_date: 2026-11-01
  author: antigravity
  environment: Three.js r182 (WebGL2), Chromium Playwright
---

# Three.js フラグメントシェーダーにおける normalMatrix と metalnessFactor コンパイル不整合の解決

## 背景と問題の事象

GitHub Pages へのデプロイ後、本番環境で WebGL 描画が初期化途中で失敗し画面が真っ黒（Canvas がクリアされない状態）になる障害が発生した。
ブラウザのコンソールログ（Playwright MCP による調査）にて以下の WebGL コンパイルエラーが記録されていた:

```
THREE.WebGLProgram: Shader Error 1282 - Fragment shader is not compiled
ERROR: 'normalMatrix' : undeclared identifier
ERROR: 'metalnessFactor' : undeclared identifier
```

## 原因の分析

### 1. `normalMatrix` は Fragment Shader には存在しない

Three.js の組み込み uniform において、法線変換行列 `normalMatrix` (`mat3`) は **Vertex Shader 専用** である。
Fragment Shader のスコープでワールド法線やリップル法線をビュー空間（法線ベクトル）に変換しようと `normalMatrix` を直接参照すると、スコープ未定義となりシェーダーのコンパイルが失敗する。

- **解決策**: Fragment Shader 内ではカメラのビュー行列 `viewMatrix` (`mat4`) が組み込み uniform として利用可能である。したがって、`mat3(viewMatrix)` を用いて 3x3 回転成分を取り出し、`normalize(mat3(viewMatrix) * worldNormal)` としてビュー空間へ変換する。

### 2. `metalnessFactor` の宣言タイミングと include 順序

Three.js の `MeshStandardMaterial` のフラグメントシェーダーチャンクの include 順序は以下の通りである:

```glsl
#include <roughnessmap_fragment>  // float roughnessFactor = roughness; が宣言される
#include <metalnessmap_fragment>  // float metalnessFactor = metalness; が宣言される
```

以前の実装では、粗さ（roughness）と金属度（metalness）をまとめて水たまりや路面濡れに合わせて上書きするため、`#include <roughnessmap_fragment>` の直後に注入していた。
しかし、この時点ではまだ `metalnessFactor` が宣言されていないため、`ERROR: 'metalnessFactor' : undeclared identifier` が発生していた。

- **解決策**: 両方のファクターを変更する場合は、`#include <metalnessmap_fragment>` の直後に注入フックを配置する。この位置であれば `roughnessFactor` と `metalnessFactor` の双方が宣言済みであり、安全に上書きできる。

### 3. `cameraPosition` は ShaderMaterial の自動注入 uniform（明示宣言で再定義エラー）

Three.js の `ShaderMaterial` において、`cameraPosition` (`vec3`) は Three.js レンダラーが自動的にヘッダーに注入するビルトイン uniform である。
そのため、ユーザーの GLSL フラグメントシェーダーで `uniform vec3 cameraPosition;` を手動宣言すると `ERROR: 'cameraPosition' : redefinition` が発生する。

- **解決策**: ユーザー定義 uniform の名前を `uCameraPosition` に改名し、競合を防止する。

### 4. Blender glTF (`export_yup=True`) の前後軸変換と車内コックピット視界遮蔽

Blender の `bpy.ops.export_scene.gltf(export_yup=True)` は、Blender の Z-up 座標系 `(X, Y, Z)_blender` を Three.js の Y-up 座標系 `(X, Z, -Y)_threejs` に変換する。
そのため、Blender スクリプト側で車両前方を `+Y` としてモデリングすると、Three.js 上では `-Z` が前方（前後 180 度逆向き）となり、運転席シートの黒い背もたれ (`Y_blender = -0.45` -> `Z_three = +0.45`) がコックピットカメラ (`Z_three = -0.05`) の直前 50cm に配置され、画面全体を黒く塞いでいた。また、キャビン上部が中身の詰まったソリッド直方体だったため、カメラがメッシュ内部に埋まっていた。

- **解決策**:
  - `blender/scripts/generate_vehicle_model.py` で車両前方を `-Y_blender`（Three.js の `+Z`）、後方を `+Y_blender`（Three.js の `-Z`）に統一し、運転席背もたれをカメラ後方の `Z_three = -0.42..-0.45` に配置。
  - キャビン上部をソリッドボックスから「薄いルーフ天板 (`Y_three = 1.44`) ＋ 細い A/B/C ピラー」の中空構造に変更し、コックピットからの前方視界を完全に開放。
  - `blender/scripts/generate_tokyo_station.py` でも東京駅丸の内駅舎の表裏両面（`-Y` / `+Y`）の窓列・キーストーン装飾・中央大時計発光マテリアル (`ClockDial`)・車寄せ列柱を追加し、`just model-assets` で `car.glb` と `tokyo_station.glb` を再生成。
  - `blender/scripts/generate_3d_pbr_textures.py` にて Blender 5.2+ で非推奨となった `mat.use_nodes = True` の無条件代入を `has_node_tree = mat.node_tree is not None` ガード付きに変更し、`just generate-textures` 実行時の `DeprecationWarning` を解消。

### 5. Three.js `PCFSoftShadowMap` 廃止警告と Favicon 404 の解消

- Three.js r182+ で `THREE.PCFSoftShadowMap` が廃止され `THREE.PCFShadowMap` に統合されたため、`apps/web/src/main.ts` の `renderer.shadowMap.type` を `THREE.PCFShadowMap` に更新。
- `apps/web/index.html` にインライン SVG Data URI の `<link rel="icon">` を追加し、ブラウザ起動時の `/favicon.ico` 404 エラーを根絶。

## 修正対象

- `apps/web/src/roads/japaneseRoadMaterial.ts`: `normalMatrix` -> `mat3(viewMatrix)`, フック位置を `#include <metalnessmap_fragment>` へ変更
- `apps/web/src/shaders/puddleShader.ts`: `normalMatrix` -> `mat3(viewMatrix)`, フック位置を `#include <metalnessmap_fragment>` へ変更
- `apps/web/src/shaders/waterShader.ts`: `normalMatrix` -> `mat3(viewMatrix)`, フック位置を `#include <metalnessmap_fragment>` へ変更
- `apps/web/src/shaders/wetRoad.ts`: フック位置を `#include <metalnessmap_fragment>` へ変更
- `apps/web/src/shaders/depthFog.ts`: `cameraPosition` を `uCameraPosition` に改名し ShaderMaterial の再定義エラーを解消
- `apps/web/src/city/tokyoStationMap.ts`, `apps/web/src/vehicle/carModel.ts`: GLB モデルのロードパスを `assetManager.resolveAssetUrl()` 経由にし、GitHub Pages サブパスでの 404 を解消。プロシージャル車両キャビンも中空ルーフ化
- `blender/scripts/generate_vehicle_model.py`, `apps/web/public/models/car.glb`: 前後軸 (`-Y_blender -> +Z_three`) の整合と中空キャビン・細ピラー・ボンネット・スポイラー造形強化
- `blender/scripts/generate_tokyo_station.py`, `apps/web/public/models/tokyo_station.glb`: 東京駅丸の内駅舎の表裏窓列・大時計・車寄せ・角塔ドーム造形強化
- `blender/scripts/generate_3d_pbr_textures.py`: Blender 5.2+ `use_nodes` DeprecationWarning 解消
- `apps/web/src/assets/defaultAssetsYaml.ts`, `apps/web/public/config/assets.yml`, `apps/web/src/weather/weatherSystem.ts`: 天候プリセットの太陽位置（前方 `+Z` 側）および環境光・スカイドーム明度の改善
- 単体テストのモック GLSL (`puddleShader.test.ts`, `waterShader.test.ts`) にも `#include <metalnessmap_fragment>` を追加して検証整合性を担保

## 検証結果 (Trust Signals)

- `just model-assets` & `just generate-textures`: Blender 5.2.0 CLI にて警告ゼロで `car.glb` (140KB), `tokyo_station.glb` (355KB), `road_3d_material.blend` を生成完了
- `just run-tests`: 全 10 テストスイート 35 テストすべて成功
- `just verify-all`: 型チェック、Actionlint、Pinact、OxLint、テスト、ビルド、tsdown Minify すべて 0 警告 0 エラーで完了
- Gemini 3.8 Flash サブエージェントレビュー: プロダクションコード・テストコード・シェーダー・Blender スクリプトすべて指摘事項ゼロ（CONVERGED）を確認
- Playwright 実機レンダリング検証: `cockpit` / `chase` 視点および全 4 天候（`sunset`, `clear`, `rain`, `night`）でコンソールエラー 0 件・警告 0 件、鮮明な 3D 描画をスクリーンショットで確認済み

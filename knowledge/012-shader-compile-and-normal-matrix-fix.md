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

## 修正対象

- `apps/web/src/roads/japaneseRoadMaterial.ts`: `normalMatrix` -> `mat3(viewMatrix)`, フック位置を `#include <metalnessmap_fragment>` へ変更
- `apps/web/src/shaders/puddleShader.ts`: `normalMatrix` -> `mat3(viewMatrix)`, フック位置を `#include <metalnessmap_fragment>` へ変更
- `apps/web/src/shaders/waterShader.ts`: `normalMatrix` -> `mat3(viewMatrix)`, フック位置を `#include <metalnessmap_fragment>` へ変更
- `apps/web/src/shaders/wetRoad.ts`: フック位置を `#include <metalnessmap_fragment>` へ変更
- `apps/web/src/shaders/depthFog.ts`: `cameraPosition` を `uCameraPosition` に改名し ShaderMaterial の再定義エラーを解消
- `apps/web/src/city/tokyoStationMap.ts`, `apps/web/src/vehicle/carModel.ts`: GLB モデルのロードパスを `assetManager.resolveAssetUrl()` 経由にし、GitHub Pages サブパスでの 404 を解消
- 単体テストのモック GLSL (`puddleShader.test.ts`, `waterShader.test.ts`) にも `#include <metalnessmap_fragment>` を追加して検証整合性を担保
- 単体テストのモック GLSL (`puddleShader.test.ts`, `waterShader.test.ts`) にも `#include <metalnessmap_fragment>` を追加して検証整合性を担保

## 検証結果

- `just run-tests`: 全 10 テストスイート 35 テストすべて成功
- `just verify-all`: 型チェック、Actionlint、OxLint、テスト、ビルド、Minify すべて 0 警告 0 エラーで完了

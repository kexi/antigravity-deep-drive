---
title: 物理ベース大気散乱・3Dボリュメトリック雲・太陽・月・星空 空シェーダー (Atmospheric Dynamic Sky Shader)
tags:
  - graphics
trust_signals:
  verified_date: 2026-11-04
  author: antigravity
  test_command: just verify-all
  verification_status: verified
---

# 物理ベース大気散乱・3Dボリュメトリック雲・太陽・月・星空 空シェーダー (Atmospheric Dynamic Sky Shader)

## 1. 概要と背景

東京駅丸の内〜行幸通り・渋谷ストリームのオープンワールドドライブシミュレーターにおいて、時間帯（朝・昼・夕暮れ・夜間）× 天候（晴天・曇天・雨天）に応じた自然でドラマチックな空（太陽・月・3Dボリュメトリック雲・巻雲・恒星）を描画する `AtmosphericSky`（[`apps/web/src/shaders/skyShader.ts`](file:///Users/kei/ghq/github.com/kexi/antigravity-deep-drive/apps/web/src/shaders/skyShader.ts)）および `CLOUD_SHADER_GLSL`（[`apps/web/src/shaders/cloudShader.ts`](file:///Users/kei/ghq/github.com/kexi/antigravity-deep-drive/apps/web/src/shaders/cloudShader.ts)）を実装・改修した。

## 2. 過去の不具合（空シェーダー消失）の根本原因と解決策

### 2.1 Far クリップ平面によるスカイドーム 100% 消失バグ

- **原因**:
  - `AtmosphericSky` の球体ジオメトリ半径は都市全域を包囲する `2400m`（`new THREE.SphereGeometry(2400, 32, 16)`）である一方、メインカメラ（[`cameraController.ts`](file:///Users/kei/ghq/github.com/kexi/antigravity-deep-drive/apps/web/src/core/cameraController.ts)）の `far` は軽量化のため `600m`、バックミラー用リアカメラ（[`carModel.ts`](file:///Users/kei/ghq/github.com/kexi/antigravity-deep-drive/apps/web/src/vehicle/carModel.ts)）の `far` は `160m` に設定されていた。
  - 頂点シェーダーが通常の `gl_Position = projectionMatrix * viewMatrix * worldPosition;` であったため、カメラから距離 `2400m` にあるスカイドームの全頂点が `z_ndc > 1.0` となり、WebGL の Far 平面クリッピングによって **空・太陽・雲・星が 100% クリップされ、`scene.background` の単色背景しか見えていなかった**。
- **解決策**:
  - `AtmosphericSky` および `VolumetricCloudDome` の頂点シェーダーでクリップ座標の Z を `clipPos.w * 0.99999` に固定する無限遠スカイボックス投影を導入：
    ```glsl
    vec4 clipPos = projectionMatrix * viewMatrix * worldPosition;
    gl_Position = vec4(clipPos.xy, clipPos.w * 0.99999, clipPos.w);
    ```
  - これにより、カメラの `far` が `160m` でも `600m` でも絶対に Far クリップされず、かつ深度バッファ上の値 `depth = 0.999995` が [`DepthFogPass`](file:///Users/kei/ghq/github.com/kexi/antigravity-deep-drive/apps/web/src/shaders/depthFog.ts)（`depth >= 0.9999` で空と判定）および [`LensFlarePass`](file:///Users/kei/ghq/github.com/kexi/antigravity-deep-drive/apps/web/src/shaders/lensFlare.ts)（`d >= 0.99995` で遮蔽なしと判定）の閾値を厳密に満たす。
  - 併せて `mesh.frustumCulled = false`、`mesh.renderOrder = -1000`、`depthFunc: THREE.LessEqualDepth` を設定し、視線方向ベクトルも `normalize(vLocalPosition)` から算出することで、バックミラーのオフスクリーン描画でも視差歪みなく空と雲が映るようにした。

## 3. コア技術仕様

### 3.1 レイリー散乱・地平線大気減衰 (Rayleigh Scattering & Horizon Extinction)

視線方向ベクトル（`rayDir`）の高度角（`rayDir.y`）に基づき、天頂カラー（`uZenithColor`）から地平線カラー（`uHorizonColor`）へと滑らかに減衰する大気散乱グラデーションを計算。

### 3.2 太陽ディスク & ミー散乱コロナ光冠 (Mie Scattering Sun Disk & Aureole)

太陽方向ベクトル（`uSunPosition`）と視線ベクトルの内積を用い、太陽前方散乱による大気光冠（Aureole）、グロー、および雲の不透明度（`cloudLayer.a`）による物理オクルージョンを伴う太陽ディスクを描画。

### 3.3 プロシージャル月面・月の海クレーター & 月光コロナ (`evaluateLunarContribution`)

夜間（`night`）および薄暮（`sunset` / `morning`）において、天球上の月方向ベクトル（`uMoonPosition`）にリアルな月面と月光ハローを描画：

- **球面タンジェント投影と周辺減光 (Limb Darkening)**: 月円盤内の 2D 座標から仮想球面法線 $z = \sqrt{1 - r^2}$ を復元し、`pow(zSphere, 0.32)` で球体らしい周辺減光を表現。
- **月の海（Lunar Maria）と高地クレーター**: 多重スケール FBM（`mariaMacro`, `mariaDetail`, `craterMicro`）により、玄武岩質の暗い「月の海」と明るい高地・微細クレーターリムの陰影をプロシージャル生成。
- **大気月光コロナと夜間雲への月光散乱**: 氷晶による銀青色の月光ハロー（`moonHalo`, `moonCorona`）を描画するとともに、`evaluateVolumetricClouds` のライトマーチング方向を夜間は `moonDir` へ補間することで、夜雲の輪郭が月明かりで銀色に浮かび上がる。

### 3.4 3D ボリュメトリック・レイマーチング雲 & 高層巻雲 (`CLOUD_SHADER_GLSL`)

- 3D Perlin-Worley ボリュームテクスチャ（`uCloudVolumeTex`）を用いた可変ステップレイマーチング（高度 680m〜1850m）と、高度 5500m のドメインワーピング巻雲（すじ雲）レイヤーを統合。
- `WeatherSystem.applyPreset` 実行時にも `setEnvironment` を経由してボリュメトリック雲の全パラメータ（`cloudCoverage`, `cloudType`, `silverLiningIntensity`, `cirrusIntensity` 等）と月面パラメータが欠落せず完全同期されるよう統一。

## 4. 検証結果 (Trust Signals)

- **単体テスト**: `apps/web/src/tests/skyShader.test.ts` (6 tests passed) & `apps/web/src/tests/cloudShader.test.ts` (4 tests passed)
  - Far 平面クリップ防止設定（`gl_Position`, `frustumCulled: false`, `depthFunc: THREE.LEqualDepth`）
  - 太陽・月方向ベクトルの正規化（`setSunPosition`, `setMoonPosition`）と月面クレーター・月光コロナ GLSL 検証
  - 前方視界（`-Z`）への太陽・月配置および `WeatherSystem` の時間帯×天候連動
- **パイプライン**: `just format-code` & `just verify-all` すべてパス。

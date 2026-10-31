---
title: 物理ベース高度減衰・大気散乱 深度フォグ（Depth Fog）ポストプロセス
tags:
  - graphics
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
---

# 物理ベース高度減衰・大気散乱 深度フォグ（Depth Fog）ポストプロセス

## 概要

東京駅丸の内エリアおよび皇居周辺の長大空間において、高層ビル群や皇居のお堀、広大な行幸通りの遠近感と大気空気感を劇的に向上させるため、カメラ深度テクスチャ（Depth Buffer）を活用した物理ベースの高度減衰・ミー散乱ポストプロセス深度フォグを実装した。

## 技術仕様・アルゴリズム

1. **深度バッファからのワールド座標復元 (Depth to World Reconstruction)**:
   - カメラの射影逆行列（`cameraProjectionInverse`）とカメラのワールド変換行列（`cameraWorldMatrix`）を用いて、スクリーン UV と非線形深度値から各ピクセルのビュー空間座標およびワールド空間座標を完全に再構築。
   - スカイボックス（背景無限遠 `depth >= 0.9999`）のフォグ二重適用を自動除外。

2. **指数高度減衰フォグの視線積分 (Analytical Exponential Height Falloff)**:
   - 地上付近（道路面・お堀水面）に大気中の水分・微小浮遊粒子が滞留し、上空に向かって指数関数的（$\rho(y) = \rho_0 e^{-k y}$）に希薄化する大気モデルを採用。
   - カメラ位置からターゲット座標までの視線積分を解析解として導出:
     $$\tau = \int_0^L \rho(y(s)) ds = \frac{\rho_0}{k} e^{-k y_{\text{cam}}} \frac{1 - e^{-k \Delta y}}{\Delta y / L}$$
   - カメラとターゲットの標高差が極小のケース（$|\Delta y| \le 0.001$）では、ゼロ除算特異点を回避するため均一標高近傍近似解（$\tau = \rho_0 e^{-k y_{\text{cam}}} L$）に安定分岐。

3. **太陽光ミー散乱 (Mie In-Scattering / Henyey-Greenstein 位相関数)**:
   - 大気エアロゾル粒子による光の前方散乱を、Henyey-Greenstein 位相関数（非対称度パラメータ $g = 0.65$）を用いて計算。
   - 視線が太陽の方向を向いたとき（逆光時）、大気フォグが黄金色・茜色に温かく輝くインスキャッタリング効果を再現。

4. **ポストプロセスパイプライン直列統合**:
   - `Scene Render` $\to$ `DepthFogPass` (深度テクスチャ取得・大気散乱適用) $\to$ `MotionBlurPass` (速度感ブラー合成) $\to$ `Screen Output` の効率的なレンダリングチェーンを構築。

5. **天候システム (WeatherSystem) & YAML プリセット連携**:
   - 晴天（クリアブルー）、夕暮れ（茜色・黄金インスキャッタリング）、雨天（多湿高密度グレー）、夜間（深い月光ネイビー）と動的にパラメータ（色・密度・高度減衰率・太陽光ベクトル）を同期。

## 検証結果 (Trust Signals)

- **Vitest**: `src/tests/depthFog.test.ts` においてレンダーターゲット初期化、パラメータ動的更新、GLSL解析解・位相関数の存在を What として検証（全 8 テストファイル、全 25 テストパス）。
- **Pipeline**: `just verify-all`（`check-types`, `lint-code`, `run-tests`, `build-app`）全工程の正常終了を実証。

---
title: 三段階グラフィック品質プリセット（高 high / 中 medium / 低 low）の描画パイプライン制御設計
tags:
  - architecture
  - graphics
  - ui
trust_signals:
  verified_date: 2026-11-03
  author: antigravity
  verification_method:
    - Vitest 単体テストによるプリセット定義・URLクエリ解析・レンダーターゲット解像度計算・ボリュメトリック雲ステップ制御・WeatherSystem シャドウ/雨粒子スケーリング・CarModel ミラー反射間引きの検証
    - just format-code および just verify-all (oxlint / oxfmt / tsc --noEmit / vitest / vite build / minify) の全通過確認
---

# 三段階グラフィック品質プリセット（高 high / 中 medium / 低 low）の描画パイプライン制御設計

## 1. 背景と設計方針（Why not 単一の解像度スケーリングだけで済ませないか）

- 本シミュレーターは 3D ボリュメトリック雲レイマーチング、3段階ポストプロセス（深度フォグ・レンズフレア・モーションブラー）、車内3面ミラー（ルームミラー・左右ドアミラー）のリアルタイム反射レンダーターゲット描画、最大 8,500 個の GPU 雨滴・クラウンスプラッシュ、および 2048px シャドウマップを同時に駆動する。
- そのため、単に `renderer.setPixelRatio` だけを下げる方式では、フラグメントシェーダー内の 3D テクスチャ・レイマーチング反復回数やサブレンダーターゲット（ミラー反射・シャドウマップ）の頂点・ドローコール負荷が削減されず、モバイル GPU や省電力環境で十分なフレームレート向上が得られない。
- そこで「高 (`high`)」「中 (`medium`)」「低 (`low`)」の三段階プリセット（[`apps/web/src/core/graphicsQuality.ts`](../apps/web/src/core/graphicsQuality.ts)）を定義し、描画パイプライン全体の 7 軸を一括・直交的にスケーリングする設計とした。

---

## 2. 三段階プリセットのパラメータ設計（How）

| 制御項目 | 高 (`high`) | 中 (`medium`) | 低 (`low`) |
| :--- | :--- | :--- | :--- |
| 最大デバイスピクセル比 (`maxPixelRatio`) | `2.0` | `1.5` | `1.0` |
| ポストプロセス RT 解像度倍率 (`renderScale`) | `1.0` (100%) | `0.85` (85%) | `0.7` (70%) |
| 太陽光リアルタイムシャドウ (`shadowsEnabled` / `shadowMapSize`) | 有効 (`2048 × 2048` / PCFSoft) | 有効 (`1024 × 1024` / PCF) | 無効 (`castShadow = false`) |
| 3D ボリュメトリック雲 (`cloudMarchSteps` / `cloudSunSteps`) | `14` step / 太陽 `2` step | `8` step / 太陽 `1` step | `4` step / 太陽 `0` step (detail FBM 省略) |
| 雨滴ストリーク / クラウンスプラッシュ粒子数 | `8500` / `2600` | `4500` / `1200` | `1800` / `0` (スプラッシュ非表示) |
| 車内ミラー反射 RT 解像度 / 更新間隔 | `512×256` / 毎フレーム (`1`) | `256×128` / 2フレームに1回 (`2`) | `128×64` / 6フレームに1回 (`6`) |
| 光学レンズフレアパス / モーションブラー初期値 | 有効 / `ON` | 有効 / `ON` | バイパス / `OFF` |

### 2.1 ボリュメトリック雲シェーダーの光学的厚み補正（[`apps/web/src/shaders/cloudShader.ts`](../apps/web/src/shaders/cloudShader.ts)）

- レイマーチングの主ステップ数 `uCloudMarchSteps` を `14` → `8` → `4` に減らす際、1ステップあたりの進行距離が伸びないままだと雲層の上部までレイが届かず雲が薄く消えてしまう。
- そのため `stepScale = 14.0 / float(marchSteps)` を掛けてステップ長と消散係数積分をスケーリングし、少ないステップ数でも高画質時と同等の雲の光学的厚み（シルエットと陰影濃度）を維持している。
- さらに `uCloudSunSteps == 0`（`low` 品質）のときは高周波ディテール 3D Worley FBM の 2 回目の `sampler3D` フェッチと太陽方向ライトマーチングをスキップし、高度勾配による解析的自己陰影近似に切り替えることでフラグメントシェーダーの 3D テクスチャ帯域を大幅に削減している。

### 2.2 ポストプロセス中間レンダーターゲット転送の動的バイパス（[`apps/web/src/main.ts`](../apps/web/src/main.ts)）

- `high` / `medium` 品質（`postProcessLensFlare: true`）でユーザーがモーションブラーを `OFF` にした場合は、`lensFlarePass` の出力先を `motionBlurPass.renderTarget` ではなく画面（`null`）へ直接ルーティングし、不要なオフスクリーン描画と全画面コピーパスをバイパスする。
- `low` 品質（`postProcessLensFlare: false`）かつモーションブラー `OFF` のときは、`depthFogPass` の出力先を画面（`null`）へ直接ルーティングし、フルスクリーン・クアッドのレンダーターゲット転送 2 パス分を完全にバイパスする。

### 2.3 UI・キーボード・URL クエリ・構造化ログ連携

- **HUD ドロワー**: `#graphics-buttons`（`高` / `中` / `低` ボタン）および `#hud-graphics-badge`（`高 (HIGH)` / `中 (MEDIUM)` / `低 (LOW)`）。
- **モバイルクイックバー**: `#quick-graphics-btn`（`画質: 高` / `画質: 中` / `画質: 低`）の 1 タップでサイクル切替。
- **キーボードショートカット**: `[F]` キーで `high` → `medium` → `low` → `high` の順にサイクル切替。
- **URL クエリパラメータ**: `?graphics=high|medium|low`（または `?quality=high|medium|low`）による初期状態の指定。
- **構造化ログ**: `logger.withTrace("graphics", "graphics.change", ...)` により、`traceId` / `spanId` 付きで品質変更イベントを記録。

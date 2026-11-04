---
title: 深度バッファマスクによる車内インテリア除外モーションブラーと日本の道路交通法準拠プロップ改修
tags:
  - graphics
  - roads
  - ui
trust_signals:
  verified_date: 2026-11-04
  author: antigravity
  verification:
    - Vitest 単体テスト (src/tests/motionBlur.test.ts および src/tests/roadSystem.test.ts を含む全テストスイート合格)
    - Chrome DevTools MCP による実機確認（100km/h 高速走行時のコックピット視点でカーナビ・メーターが鮮明に保たれ、車外風景のみにモーションブラーが適用されることを確認）
    - just format-code && just verify-all による型検査・Lint・単体テスト・本番ビルドの完全パス確認
---

# 深度バッファマスクによる車内インテリア除外モーションブラーと日本の道路交通法準拠プロップ改修

## 1. 背景と課題（車内カーナビ・メーターへのモーションブラー問題）

従来の [`MotionBlurShader`](../apps/web/src/shaders/motionBlur.ts) は、画面中心 `uCenter = (0.5, 0.5)` からの 2D UV 距離 `dist = length(vUv - uCenter)` のみに依存するフルスクリーン・ラジアルブラーとして実装されていた。
このため、コックピット視点（ドライバー視点）で時速 `20 km/h` を超えて走行すると以下の物理的・視覚的矛盾が発生していた：

1. **相対速度ゼロの車内内装がブレる矛盾**: ドライバーの頭部（[`CameraController`](../apps/web/src/core/cameraController.ts)）と車内インテリア（11インチセンターカーナビ、12.3インチデジタルメータークラスター、ステアリングホイール、Aピラー、ダッシュボード）は車両と同じ慣性系で移動しているため、本来はドライバーに対する相対速度がゼロであり、どれほど高速で走行しても一切ブレてはならない。
2. **画面下部・周辺ほどブラーが強まる逆転現象**: 2D ラジアルブラーは画面中央から離れるほど `dist` が大きくなるため、画面下部〜左下に位置するカーナビ画面やメーターパネルに最も強いブラーがかかり、走行中に地図や速度表示がぼやけて視認性が低下していた。

---

## 2. 深度バッファ（`tDepth`）を用いた車内インテリア除外マスク設計

[`DepthFogPass`](../apps/web/src/shaders/depthFog.ts) が毎フレーム生成しているシーン深度テクスチャ（`depthFogPass.renderTarget.depthTexture`）を [`MotionBlurPass`](../apps/web/src/shaders/motionBlur.ts) へ接続し、ピクセルごとのカメラからの線形距離（メートル）に基づいた **車内除外・車外限定モーションブラー** を実装した。

### 2.1 フロントガラスの `depthWrite: false` との協調
- [`windshield.ts`](../apps/web/src/shaders/windshield.ts) において、フロントガラス・サイドウィンドウ・リアガラスのマテリアルは `transparent: true, depthWrite: false` で構成されている。
- したがって、ガラス越しに見える車外の道路・建築物・街路樹・空のピクセルには **車外オブジェクトの実際の深度（`> 3.0m`）** が `depthTexture` に記録されている。
- 一方、不透明メッシュで構成される車内インテリア（ステアリング `~0.45m`、センターカーナビ `~0.62m`、デジタルメーター `~0.65m`、ダッシュボード `~0.65m..0.85m`、Aピラー `~0.75m`、ボンネット `~1.0m..2.2m`）はすべて `depthWrite: true` であり、ドライバー視点からの線形距離が **`2.2m` 以下** となる。

### 2.2 線形深度変換と 2 段階の滲み防止（Bleeding Prevention）
[`MotionBlurShader.fragmentShader`](../apps/web/src/shaders/motionBlur.ts) に以下の 2 段階マスクを導入した：

1. **中心ピクセルの早期リターン**:
   - 非線形デプス値 `rawDepth` を `linearizeDepth(rawDepth)` でカメラからの線形距離 `linearDist`（m）へ変換し、`centerExteriorMask = smoothstep(uMaskNearDistance, uMaskFarDistance, linearDist)` を算出する（コックピット視点では `uMaskNearDistance = 2.2m`, `uMaskFarDistance = 3.0m`）。
   - `centerExteriorMask <= 0.001` のピクセル（車内インテリアおよび自車ボンネット）はサンプリングを行わず即座に `baseColor` を出力する。これによりカーナビやメーターの文字・地図が `100 km/h` 以上の高速走行時でも 100% 鮮明に保たれる。
2. **ブラーサンプル先ピクセルのマスク重み付け**:
   - 車外ピクセル（フロントガラス越しの路面など）をブラーさせる際、`sampleUv = vUv - stepVec * fi` がフロントガラス下端を超えてダッシュボードやカーナビ画面のピクセルを拾うと、車内の暗い色やナビの光が車外の路面に滲み出す（Ghosting / Halo アーティファクト）。
   - これを防ぐため、各サンプル点でも `sampleExteriorMask = computeExteriorMask(sampleUv)` を評価し、`weight *= sampleExteriorMask` とすることで、車内領域に入ったサンプルの寄与をゼロに切り落としている。

---

## 3. 日本の道路交通法に基づく道路標識・歩行者信号・横断歩道ガードレール改修

あわせて [`roadProps.ts`](../apps/web/src/roads/roadProps.ts) および [`roadBuilder.ts`](../apps/web/src/roads/roadBuilder.ts) において、以下の実写・法令準拠改修も完了している：

1. **ガードレール再帰反射板（デリネーター）シェーダー**: [`injectRetroreflectorShader`](../apps/web/src/roads/roadProps.ts) により、視線ベクトルと入射光の逆ベクトルの一致度（再帰反射ローブ）および車両ヘッドライトの円錐減衰を計算し、夜間・夕暮れ時に左側（白色）・右側（橙色）の反射器が遠方まで鮮やかに輝く表現を実装。
2. **道路標識の支柱配置・裏面遮光と角丸透過テクスチャ**:
   - 支柱が標識本体の前面にはみ出さないよう背面オフセット（`z = -0.05m`）へ配置し、本標識・補助標識ともに「表面デザイン＋アルミ裏面＋側面リム」の3マテリアル構成とすることで裏面からの透けを解消。
   - [`drawRoundedRect`](../apps/web/src/roads/roadProps.ts) による角丸クリッピングと `alphaTest: 0.5`、`depthWrite: true` により、円形・三角形・角丸矩形の外周に黒い四角い枠（半透明ブレンド境界）が浮き出る現象を根絶。
3. **歩行者用信号機の向き・日本仕様ピクトグラムテクスチャ**:
   - 横断歩道の対岸から横断歩行者へ正対する向き（左側歩道 `+π/2`、右側歩道 `-π/2`）へ修正。
   - 512×1024 Canvas による日本仕様の縦型2灯（上段：赤の立ち姿ピクトグラム、下段：青緑の歩行姿ピクトグラム＋LEDドットマトリクス＆サンバイザー）を実装。
4. **横断歩道開口部のガードレール自動分割**: [`buildGuardrailSection`](../apps/web/src/roads/roadBuilder.ts) にて横断歩道位置（`crosswalkZPositions`）の前後 `±3.8m` を開口部として自動分割し、各端部に巻き込み袖ビームと端末支柱を配置して歩行者動線を確保。

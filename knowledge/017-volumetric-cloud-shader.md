---
title: 3D Perlin-Worley ボリュメトリック・レイマーチング雲シェーダー (Volumetric Raymarching Cloud Shader)
tags:
  - graphics
  - architecture
trust_signals:
  verified_date: 2026-11-01
  author: antigravity
  test_command: just format-code && just verify-all
  verification_status: verified
---

# 3D Perlin-Worley ボリュメトリック・レイマーチング雲シェーダー (Volumetric Raymarching Cloud Shader)

## 1. 背景と課題（Why）

従来の [`skyShader.ts`](../apps/web/src/shaders/skyShader.ts) に内包されていた雲表現は、高度 1000m の単一2D平面に対する 3オクターブ 2D FBM ノイズの簡易マッピングであったため、雲塊の立体的な厚み（雲底のフラットな凝縮面とカリフラワー状に盛り上がる雲頂ドーム）、雲内部の自己遮蔽シャドウ、および積雲・層積雲・乱層雲（雨雲）の気象学的な形状差が表現できていなかった。

そこで SIGGRAPH Nubis (Guerrilla Games) 方式に基づく **3D Perlin-Worley ボリュームテクスチャ (`Data3DTexture` / `sampler3D`)** と **12ステップ・レイマーチング + 太陽方向ライトマーチング + 高層巻雲レイヤー** を備えた専用シェーダーモジュール [`apps/web/src/shaders/cloudShader.ts`](../apps/web/src/shaders/cloudShader.ts) を設計・実装した。

---

## 2. 技術設計（How & Why not）

### 2.1 4チャンネル 3D トーラス周期 Perlin-Worley ボリュームテクスチャ (`generateCloud3DTexture`)

- [`apps/web/src/textures/procedural3DTexture.ts`](../apps/web/src/textures/procedural3DTexture.ts) に `generateCloud3DTexture(size = 32)` を追加：
  - **R**: 3D Perlin FBM（周期4）と反転 3D Worley F1（周期4）を合成した Perlin-Worley 基本積雲密度。
  - **G**: 低周波反転 3D Worley F1（周期4：積雲のカリフラワー状ローブ構造）。
  - **B**: 中周波反転 3D Worley F1（周期8：雲塊輪郭のモコモコしたビルー侵食）。
  - **A**: 高周波反転 3D Worley F1 + 乱流 FBM（周期12：ちぎれ雲・フリンジの微細ディテール）。
- **Why not**: 2D テクスチャや非周期 3D ノイズでは、視線角度によって板ポリゴン感やリピート境界の切れ目が生じるため、3次元トーラス $T^3$ 上で数学的に完全周期化した `Data3DTexture` を用いた。

### 2.2 気象学的な垂直高度プロファイル (`sampleCloudHeightGradient`)

- 雲層内の正規化高度 $h \in [0, 1]$（`uCloudBottomAltitude` 〜 `uCloudTopAltitude`）と雲形パラメータ `uCloudType` に応じて3種の雲形を連続補間：
  - **積雲 (`uCloudType = 0.0`, Cumulus)**: 凝結高度で平らに揃った雲底と、中〜上層へ丸く盛り上がるドーム形状。
  - **層積雲 (`uCloudType = 0.5`, Stratocumulus)**: 中層に広がる厚みのあるうろこ雲・曇天雲層。
  - **乱層雲・積乱雲 (`uCloudType = 1.0`, Nimbostratus / Cumulonimbus)**: 低空（420m）から上空（1950m）のかなとこ雲まで垂れ込める重厚な雨雲。

### 2.3 二重ローブ Henyey-Greenstein 位相関数と Beer-Powder 多重散乱近似

- **Henyey-Greenstein 二重ローブ位相関数 (`cloudDualLobePhase`)**:
  - 強い前方ミー散乱ローブ（$g_f = 0.72$）による太陽周辺の強烈なシルバーライニング（銀縁輝き）と、後方散乱ローブ（$g_b = -0.32$）による順光時の白い雲肌の輝きを両立。
- **Beer-Lambert 法則 + Powder Sugar 効果 (`cloudBeerPowder`)**:
  - 太陽方向への2ステップ・ライトマーチングで求めた光学的厚み $\tau$ に対し、一次減衰 $\exp(-\tau)$ と二次多重散乱近似 $\exp(-0.35\tau)$、および Powder 項 $1 - \exp(-2.2\tau)$ を組み合わせ、ふっくらした積雲の立体陰影を再現。

### 2.4 高層巻雲・すじ雲レイヤー (`sampleCirrusCloudLayer`) と太陽・恒星の物理遮蔽

- 積雲層の上空（高度 5500m）にドメインワーピングを用いた異方性巻雲（すじ雲）レイヤーを重ね、多層的な空の奥行きを実現。
- [`apps/web/src/shaders/skyShader.ts`](../apps/web/src/shaders/skyShader.ts) にて、宇宙空間の恒星（Stars）とシャープな太陽円盤（`sunDisk`）を雲層の背後に配置し、雲の不透明度 `cloudLayer.a` に応じて物理的に遮蔽（オクルージョン）させつつ太陽コロナ光冠へ拡散させる構造とした。

---

## 3. 検証結果（Trust Signals）

- **単体テスト**:
  - [`apps/web/src/tests/cloudShader.test.ts`](../apps/web/src/tests/cloudShader.test.ts): `VolumetricCloudDome` の初期化、3D Perlin-Worley テクスチャバインド、GLSL 関数群、および `WeatherSystem` における時間帯×天候（夕暮れ×晴天、昼×曇天、夕暮れ×雨天）連動を検証。
  - [`apps/web/src/tests/texture3d.test.ts`](../apps/web/src/tests/texture3d.test.ts): `generateCloud3DTexture` の 4チャンネル `Data3DTexture` 生成と 3軸 `RepeatWrapping` を検証。
  - `just format-code && just verify-all` にて全 14 テストファイル・60 テストがパス、本番ビルド成功を確認。

---
title: 物理ベース大気散乱・プロシージャル動的雲・星空 空シェーダー (Atmospheric Dynamic Sky Shader)
tags:
  - graphics
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
  test_command: just run-tests
  verification_status: verified
---

# 物理ベース大気散乱・プロシージャル動的雲・星空 空シェーダー (Atmospheric Dynamic Sky Shader)

## 1. 概要と背景

東京駅丸の内〜行幸通り・皇居濠のオープンワールドドライブシミュレーターにおいて、時間帯や天候（晴天・夕暮れ・雨天・夜間）に応じた自然でドラマチックな空の表現を実現するため、プロシージャルな大気散乱スカイドームシェーダー（`AtmosphericSky`）を実装した。

## 2. コア技術仕様

### 2.1 レイリー散乱・地平線大気減衰 (Rayleigh Scattering & Horizon Extinction)
視線方向ベクトル（`rayDir`）の高度角 $\theta$（`rayDir.y`）に基づき、天頂カラー（`uZenithColor`）から地平線カラー（`uHorizonColor`）へと滑らかに減衰する大気散乱グラデーションを計算。
```glsl
float horizonFade = pow(1.0 - elevation, 2.5);
vec3 skyColor = mix(uZenithColor, uHorizonColor, horizonFade);
```

### 2.2 太陽ディスク & ミー散乱コロナ光冠 (Mie Scattering Sun Disk & Aureole)
太陽方向ベクトル（`uSunPosition`）と視線ベクトルの内積 $\cos\theta$ を用い、太陽前方散乱による大気光冠（Aureole）および強烈なグロー、物理的な広がりを持つ太陽ディスクをブレンド。
```glsl
float cosTheta = dot(rayDir, normalize(uSunPosition));
float sunAureole = pow(max(0.0, cosTheta), 8.0) * 0.45;
float sunGlow = pow(max(0.0, cosTheta), 64.0) * 1.5;
float sunDisk = smoothstep(0.9993, 0.9997, cosTheta);
vec3 sunContribution = uSunColor * (sunAureole + sunGlow + sunDisk * 4.0);
skyColor += sunContribution;
```

### 2.3 高度1000m プロシージャル動的雲 (3-Octave FBM Procedural Clouds)
地平線上空（高度1000mの仮想平面）とのレイ交差UV座標を算出し、3オクターブのフラクタル・ブラウン運動（FBM）ノイズによって動的な雲のうねりと流動を生成。
- 風向・風速オフセット（`uTime * uCloudSpeed`）による自然な流れ
- 太陽光の透過散乱（シルバーライニング）と雲底の影コントラスト
- 地平線付近のソフトフェードアウトにより遠景ビル群との境界を自然化

### 2.4 夜間恒星群と瞬き (Procedural Night Stars & Twinkling)
夜間モード時、ハッシュ格子に基づく疑似ランダム分布により微細な恒星を生成。
- 時間関数（`sin(uTime * 4.0 + ...)`）による大気ゆらぎ・シンチレーション（瞬き）
- 恒星ごとの温度差（青白色〜橙色）のスペクトルばらつき

### 2.5 ポストプロセス（深度フォグ）との調和
スカイドームメッシュは `side: THREE.BackSide` かつ `depthWrite: false` でレンダリング。
- 深度バッファには最遠値（`depth = 1.0`）が保持され、後段の `depthFog.ts` 内で `if (depth >= 0.9999)` 判定により空の上にフォグが不自然に二重上書きされるのを防止。
- スカイメッシュの位置は毎フレームカメラのワールド座標に追従（`mesh.position.copy(cameraPos)`）し、常に無限遠の球体として機能。

## 3. 天候システム (`WeatherSystem`) 連動

天候プリセットに応じた動的パラメータ補間：
- **Clear（晴天）**: 天頂＝スカイブルー (`0x0284c7`)、地平線＝温白水色 (`0xbae6fd`)、雲密度 0.30、星空 0.0
- **Sunset（夕暮れ）**: 天頂＝ディープパープル (`0x4c1d95`)、地平線＝橙茜色 (`0xf97316`)、雲密度 0.45、星空 0.05
- **Rain（雨天）**: 天頂＝スレートダーク (`0x1e293b`)、地平線＝灰雲色 (`0x475569`)、雲密度 0.85、星空 0.0
- **Night（夜間）**: 天頂＝漆黒 (`0x020617`)、地平線＝ディープネイビー (`0x0f172a`)、雲密度 0.25、星空 0.90

## 4. 検証結果 (Trust Signals)
- **テスト**: `apps/web/src/tests/skyShader.test.ts` (5 tests passed)
  - 初期化時のマテリアル属性（BackSide, depthWrite: false, uniforms）
  - カメラ追従・時刻進行
  - 太陽方向正規化
  - 動的パラメータ更新（`setParams`）
  - GLSL 内のレイリー・ミー・FBM雲・星空シェーダーアルゴリズム検証
- **パイプライン**: `just verify-all`（actionlint, pinact, tsc, oxlint, vitest, vite build）すべて 0 警告 0 エラーでパス。

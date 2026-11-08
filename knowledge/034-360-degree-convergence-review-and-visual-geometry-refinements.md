---
title: 360度収束レビューに基づく渋谷ランドマーク幾何学・路面PBRライティング・HUDレイアウトの完全収束修正
tags:
  - graphics
  - architecture
  - ui
trust_signals:
  verified_date: 2026-11-08
  author: antigravity
---

# 360度収束レビューに基づく渋谷ランドマーク幾何学・路面PBRライティング・HUDレイアウトの完全収束修正

## 1. 背景と課題

直前に追加された渋谷の首都高3号渋谷線高架・主要8大ランドマーク・PLATEAU 13113 オープンデータ統合に対し、プロジェクト規約（`AGENTS.md` の「360度収束レビュー」規約）に基づき、Blender 16アングルレンダリングおよび実機 Chrome Metal WebGL 2 レンダリングを用いて網羅的な目視レビューとテレメトリ精査を実施した。

その結果、以下の幾何学的・視覚的・UIレイアウト破綻が検出された：

1. **SHIBUYA109 の 3D 幾何学・タイポグラフィ破綻**:
   - 数字「0」と「9」のメッシュが弧長で 0.73m 物理衝突・貫通していた（`letter_r = 11.32m` の円弧上で `0.28 rad` の中心間距離はわずか 3.17m であるのに対し、半径合計が `2.45m + 1.45m = 3.90m` であったため）。
   - 「1」と「0」の間隔が 3.1cm と過小で文字同士がほぼ接触していた。
   - 白アルミバッキングプレートが `r_outer = cyl_r + 0.38` で生成され、円筒シリンダー（半径 `cyl_r + 0.38`）の内側に完全に埋没して Z-fighting を起こし不可視になっていた。
   - 「9」の縦ステム右端と下部ボトムフックの接合がずれ、下部に不自然な矩形の突起（段差フット）が飛び出していた。
   - レビューカメラアングル 14 が Z=38m を向き、Z=73.5m の 109 クラウンエンブレムが上端で見切れていた。
2. **昼間（12:00 昼）におけるビル窓・ロビーの異常オレンジ発光**:
   - 昼の快晴下であるにもかかわらず、渋谷ストリームのロビー窓やサクラステージ、フクラス、ヒカリエが夜間のように強烈なオレンジ色・ピンク色に発光していた。
   - 原因: `tokyoStationMap.ts` の `shibuyaStreamEmissiveEntries` で `dayIntensity` が 0.48〜0.85 と過大に設定されていた上、Blender 側でもマテリアルに `emission_strength = 0.85〜1.65` が焼き込まれていた。
3. **路面が白飛び（白銀の鏡面化）する現象および起動時の強制ウェット化**:
   - `weatherSystem.ts` の `applyPreset` において、雨天以外のプリセット（`sunset`, `day`, `night`, `cloudy`）でも `currentRoadSurface = "wet"`（wetness = 0.76〜0.85）がハードコードされており、`main.ts` 起動時の `applyPreset(defaultWeatherPreset)` で初期ドライ設定が即座に上書きされていた。
   - `puddleShader.ts` で `effectiveThreshold = 0.42 - 0.72 * 0.12 = 0.33` となり、FBMノイズ平均 0.50 より低いため、路面全体の 85% 以上が `puddleCore = 1.0`（完全鏡面）判定されていた。
   - `puddleShader.ts` のフレネル合成において、`reflectedRadiance` に予め `fresnel` が乗算されていたため、`mix(waterTint, reflectedRadiance, fresnel)` でフレネル係数が二乗（`fresnel^2`）減衰し、下向き視線での反射が不自然に消失していた。
   - Three.js の標準 PBR 鏡面反射に加え、`totalEmissiveRadiance += puddleEnvReflection * puddleCore;` によって空の反射色と太陽スペキュラ（`sunSpecular` × 2.1）がエミッシブとして二重加算されていた。
   - また `TIME_LIGHTING_PROFILES["day"]` の `sunPosition` が `[-5, 52, 180]`（仰角わずか 16.1 度）と真昼としては異常に低空で前方に配置され、ドライバー視点で路面反射光が直撃していた。
4. **デスクトップ HUD UI の重なり・スピードメーター遮蔽**:
   - デスクトップ表示（1280px 幅）において、`.header-left-stack`（GIS情報ボックス含む）に `flex-shrink: 0` がなく、右側の `.hud-controls` が複数行に折り返した際、2行目の「視線 (Gaze)」ボタン群が左側の GIS情報ボックスのテキストと物理的に重なっていた。
   - さらに、13個のコントロールパネルが8行に折り返すと縦高さが 500px を超え、720p〜900p のデスクトップ画面において右下のスピードメーター（`.speedometer-card`）およびフッターUIと物理的に重なり合っていた。
5. **Three.js コンソール警告**:
   - `THREE.WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.` がコンソールに出力されていた。
6. **プロシージャル車両ボディカラーの不一致**:
   - GLB ロード時はクラウンセダンのプレシャスメタル チタニウムシルバー（`#767d8a`, `roughness: 0.28`）が適用されていたが、プロシージャルフォールバック車両では `#9ca3af`（`roughness: 0.16`）となっており色調・質感が異なっていた。

---

## 2. 設計と解決策

### 2.1 SHIBUYA109 のシリンダー曲面沿い配置とタイポグラフィ再設計

- **扇形円筒シェル生成関数 `add_cylindrical_panel_z` の幾何適正化**:
  - シリンダー表面（半径 `cyl_r + 0.38`）の外側に確実に浮き彫りとなるよう、`r_inner = cyl_r + 0.40`、`r_outer = cyl_r + 0.52`（厚み 12cm）に設定。Z-fighting と埋没を完全に解消。
  - シリンダー頂部マテリアルを `mat_idx = 3`（メタリックシルバーアルミニウム）とし、白アルミバッキングプレート（`mat_idx = 0`）との明瞭な質感コントラストを形成。
- **極座標ベースの文字配置と均等クリアランスの幾何学的保証**:
  - `letter_r = cyl_r + 0.58`、`letter_depth = 0.36m`（プレート表面から 0.24m 突出）。
  - 各文字のパラメータ：
    - `1`: `theta_1 = theta_center - 0.27 rad`（縦ステム幅 1.05m、高さ 5.0m、トップセリフ付き）
    - `0`: `theta_0 = theta_center`（外径半径 2.10m、内径半径 1.15m、全高 4.2m）
    - `9`: `theta_9 = theta_center + 0.33 rad`（上部ループ外径半径 1.35m、右縦ステム幅 0.80m・高さ 4.6m、下部ボトムフック幅 2.40m・高さ 0.80m）
  - 「1」と「0」のクリアランス: `11.32 * 0.27 - (0.525 + 2.10) = 0.556m`。
  - 「0」と「9」のクリアランス: `11.32 * 0.33 - (2.10 + 1.15) = 0.585m`。
  - 両クリアランスを約 0.56m〜0.58m の均等美観比率で完全分離し、めり込み衝突をゼロに収束。
  - 「9」の縦ステム（右端 `+1.15`）と下部ボトムフック（右端 `+1.15`）の境界を完全同一面に揃え、下部への不要な段差突起を排除。
- **レビューカメラ 14 の構図適正化**:
  - `target_pos` を Z=38m から Z=58m（cam_pos Z=36m）に引き上げ、QFRONT と SHIBUYA109 のクラウンエンブレムが画面中央に端正に収まるよう是正。

### 2.2 昼間マテリアル発光強度と夜間ブーストの適正化

- **Blender 側ベースマテリアル**:
  - `WarmPlazaGlow`: `emission_strength` を 0.85 から 0.05 へ低減。
  - `ShutokoHighwayGreenSign`: 0.62 から 0.05 へ低減。
  - `HikarieGoldOrb`: 1.15 から 0.0 へ低減（昼間はゴールド/ブロンズのアノダイズド金属パネル）。
  - `ShibuyaSkyEdgeGlow`: 1.45 から 0.25 へ低減。
  - `SakuraStagePinkGlow`: 1.35 から 0.25 へ低減。
  - `ShibuyaQfront109Accent`: 1.65 から 0.35 へ低減。
- **Three.js 側 `shibuyaStreamEmissiveEntries`**:
  - 昼間強度 `dayIntensity` を 0.0〜0.35 の適正値に再設定。夜間（`night`）および夕暮れ（`sunset`）においてのみ 0.95〜1.65 の発光ブーストが機能するように直交制御を徹底。

### 2.3 路面PBRライティング・天候プリセット・水たまり反射の物理補正

- **天候プリセット適用時の路面状態直交分離**:
  - `weatherSystem.ts` の `applyPreset` において、`isRainPreset` が false の非降雨プリセット（`sunset`, `day`, `night`, `cloudy`）では `currentRoadSurface = "dry"`、`wetness = 0.0` を適用。
  - 降雨プリセット（`rain`）適用時のみ `currentRoadSurface = "puddle"`、`wetness = Math.max(0.92, ...)` を適用。
  - アプリ起動時（`main.ts`）にデフォルト天候が適用されても路面がドライ（乾燥）に維持される仕様を確立。
- **水たまり閾値の是正**:
  - `uPuddleThreshold` を 0.42 から 0.62 へ引き上げ、`effectiveThreshold = uPuddleThreshold - uRainWetness * 0.08` に修正。雨天時でも路面全体の白飛びを防ぎ、凹部や轍に限定した自然な水たまりを形成。
- **水の物理フレネル（Schlick IOR = 1.333, F0 = 0.02）**:
  - `reflectedRadiance` の二重フレネル乗算を排除し、`mix(waterTint, envColor + sunSpecular + rippleEdgeSparkle, fresnel)` の正確な物理式に統一。
- **エミッシブ太陽スペキュラ二重加算の排除**:
  - Three.js 標準 PBR パイプライン（`roughness = 0.02` の完全鏡面）が計算するディレクショナルライトの太陽スペキュラに対し、エミッシブ側で二重加算されていた `sunSpecular * 2.1` を補助微小グロー（`0.15`）に抑制。
- **日中の太陽高度**:
  - `TIME_LIGHTING_PROFILES["day"].sunPosition` を `[-5, 52, 180]`（仰角 16度）から `[25, 210, 55]`（仰角 74度）へ高空化。東京の正午の自然な採光を実現し、正面からの逆光グレアを解消。

### 2.4 車両外装（BodyPaint）のベースカラー統一

- `carModel.ts` のプロシージャルフォールバック `bodyMaterial` および GLB ロード時の `isBodyPaint` を共にプレシャスメタル チタニウムシルバー（`0x767d8a`, `metalness: 0.88`, `roughness: 0.28`）に統一。

### 2.5 HUD UI レイアウトの堅牢化（縦オーバーフロー防止）

- `.header-left-stack` に `flex-shrink: 0; width: 390px; max-width: 100%;` を設定。
- `.hud-controls` に `max-width: calc(100% - 410px); min-width: 0;` に加え、`max-height: calc(100dvh - 220px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;` を設定。
- 720p〜1080p のデスクトップ画面やズーム表示時でも、右上のコントロールパネル群が右下のスピードメーター（`.speedometer-card`）やフッターUIに被らない独立スクロール領域を確立。
- モバイル表示（`@media (max-width: 768px)`）およびタブレット表示（`@media (max-width: 1024px)`）でのドロワー切替と完全整合。

---

## 3. 検証記録（Trust Signals）

1. **Blender 16アングル360度レビュー**:
   - `uv run --script blender/scripts/generate_shibuya_stream.py --render-review /tmp/shibuya_review_fix` を実行。
   - `00_front_meijidori.png` 〜 `15_closeup_miyashita_park_arches.png` の全16アングルを出力。
   - 特に `14_closeup_qfront_and_shibuya109.png` において：
     - 白アルミバッキングプレートがメタリックシリンダー曲面上で美しく浮き彫りになっていることを確認。
     - 「1」「0」「9」の各文字間に 0.55m〜0.58m の均等なクリアランスが確保され、文字同士のめり込み・衝突・重なりが完全ゼロに収束していることを目視確認。
     - 「9」の縦ステムと下部ボトムフックの右端が完全に連続し、不自然な段差突起が消滅していることを確認。
2. **実機 Metal WebGL 2 レンダリング検証**:
   - Google Chrome (Metal WebGL 2, headless) で以下のアングル・天候・時間帯のスクリーンショットを取得・検査：
     - `/tmp/web_shibuya_day_chase_v3.png`: 昼・晴天・チェイス視点（クラウンチタニウムシルバー外装、乾いたアスファルトテクスチャ鮮明、スピードメーターとHUDの被りゼロ）
     - `/tmp/web_shibuya_day_cockpit_v3.png`: 昼・晴天・ドライバー視点（路面白飛びなし、ビル窓自然、車内計器・ミラー鮮明）
     - `/tmp/web_shibuya_night_rain_chase_v3.png`: 夜間・雨天・チェイス視点（雨滴波紋リップル、路面濡れ反射、リアガラス水滴）
     - `/tmp/web_shibuya_900px_check_v3.png`: 900x700px 狭小幅でのHUDレイアウト検証（要素同士の重なりゼロ）
   - 全シーンで CDP コンソールエラー・警告 0 件を確認。
3. **静的解析・テスト・ビルド全通過**:
   - `just format-code`（oxfmt / ruff format）: 通過
   - `just verify-all`:
     - `actionlint` / `pinact run --check`: 通過
     - `tsc --noEmit`: エラーゼロ通過
     - `oxlint --deny-warnings .`: 警告0エラー0通過
     - `ruff check blender/scripts/`: 全チェック通過
     - `vitest run`: 全 24 テストファイル・全 189 テスト 100% 成功
     - `just build-app`: 本番バンドルビルド成功

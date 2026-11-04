---
title: JDM右ハンドル車内カーナビ・時間帯×天候の直交分離・Zod構造化トレースロガー
tags:
  - architecture
  - graphics
  - open-data
trust_signals:
  verified_date: 2026-11-02
  author: antigravity
  verification_method: "just format-code && just verify-all (Vitest test suites + browser visual inspection of KeyK/KeyC navigation display)"
---

# JDM右ハンドル車内カーナビ・時間帯×天候の直交分離・Zod構造化トレースロガー

## 1. 背景と課題

1. **時間帯（Time of Day）と天候（Weather）の混同**:
   - 従来は `WeatherType = "clear" | "sunset" | "rain" | "night"` として「夕暮れ」「夜間」が「天候」ボタン群に含まれていたため、「夕暮れの雨」「夜間の雨」「朝の曇天」といった現実的な時間帯×天候の組み合わせが表現できなかった。
2. **右ハンドル運転席における車内カーナビの視認性と道路描画の品質（カクカク感の解消）**:
   - 日本仕様（JDM 右ハンドル、運転席カメラ `x = -0.38m, y = 1.13m, z = 0.06m`）のドライバー視点において、センターコンソールのカーナビが画面左端（`x ≈ -0.055m`）で見切れたり、Blender 側の静的メッシュと重なったりしない正確な空間設計が必要だった。
   - さらに初期実装では、国土地理院の未統合実験ベクトルタイル (`experimental_rdcl`) の細切れ折れ線・重複並行線・1.3m端数セグメントを1本ずつ単一ループで「太い暗色枠線 → 細い明色塗り」の順に描画していたため、頂点や交差点ごとに後から描いた道路の枠線が既存の道路塗りを上書きしてソーセージの継ぎ目状の黒いスジや階段状の段差（「カクカクで変な道路表現」）が発生していた。加えて、`640×360` 低解像度テクスチャ（Mipmap 無効）と `0.08s`（12.5 FPS）間引き更新、未調整ビル敷地による道路侵食、ルート折れ線の90度鋭角/180度折り返しも重なっていた。
3. **AIエージェントによる自動調査容易性（トレーサビリティ）**:
   - 複数モジュール（オープンデータ読込・物理エンジン初期化・時間帯/天候切替・シェーダー更新）を跨ぐ処理を `traceId` / `spanId` で追跡でき、Zod スキーマで機械検証された1行JSONログが求められていた。

## 2. 解決策とアーキテクチャ

### 2.1 時間帯（`TimeOfDay`）と天候（`WeatherCondition`）の直交分離

- [`apps/web/src/types.ts`](../apps/web/src/types.ts) と [`apps/web/src/weather/weatherSystem.ts`](../apps/web/src/weather/weatherSystem.ts) において、以下の2軸に分離した：
  - **時間 (`TimeOfDay`)**: `morning` (朝 06:30) / `day` (昼 12:00) / `sunset` (夕暮れ 17:30) / `night` (夜間 21:00)
  - **天候 (`WeatherCondition`)**: `clear` (晴天) / `cloudy` (曇天) / `rain` (雨天)
- `WeatherSystem.setEnvironment(timeOfDay, weather)` が時間帯の基本大気プロファイル（太陽高度・天頂色・地平線色・星空・路面残水率）と天候のオーバーキャスト/雨滴/フォグ係数をブレンドし、全12通りの環境を生成する。

### 2.2 車内11インチJDMフローティングカーナビと3パス道路ネットワーク合成描画

- [`apps/web/src/vehicle/carModel.ts`](../apps/web/src/vehicle/carModel.ts) の `createCenterNavAssembly()` にて、右ハンドル運転席カメラの左端視野 (`x = -0.055m`) とメーターフード左端 (`x = -0.208m`) の間に100%収まる `(-0.132, 0.985, 0.565)` に配置し、運転席側へ `+0.22 rad` チルトさせ、`screenMat` に `toneMapped: false` を設定（`InstrumentClusterScreen` と統一）するとともに筐体・ベゼルとのZファイティングを解消した。また `KeyK`（計器・ナビ注視プリセット）のヨー角を `18°` に調整しメーターフードによるナビ右端のケラレを防止した。
- **HiDPI 2x 解像度 (`1280×720`) + Trilinear Mipmap + Anisotropy (8x) + 毎フレーム同期更新**:
  - 論理座標系 (`640×360`) を維持しつつ `ctx.setTransform(2, 0, 0, 2, 0, 0)` で `1280×720` に高精細ラスタライズし、`LinearMipmapLinearFilter` と異方性フィルタリングで斜め道路や3Dパース投影時のピクセルジャギーを解消した。
  - 60Hz `requestAnimationFrame` ループにおける `0.016s` 閾値スロットリングが引き起こすビート落ち（`dt = 15.8ms` フレームのスキップによる実質30FPS化・旋回時のカクつき）を防ぐため、`dt > 0` の毎フレーム同期更新とした。
- **レイヤー順序（3Dビル群 → 3パス階層道路レンダリング）と交差点パッチ**:
  - [`apps/web/src/openData/gsiPlateauLoader.ts`](../apps/web/src/openData/gsiPlateauLoader.ts) に、3D走行空間の実道路網と完全一致する連続道路コリドー（`local_street` / `major_avenue` / `national_highway`）を定義した。`nav-road-marunouchi-east-st` が東京駅舎（`z ∈ [-48, -24]`）を貫通しないよう始点を `z = 5` に修正し、外堀通り東側（`x = 156`）および渋谷フクラス南側（`z = 95`）を含む全道路とのクリアランス確保とビル同士の2D重複ゼロ化を徹底した。
  - **Step 4.2（3Dビル群描画）を Step 4.3（道路ネットワーク描画）より先に実行**することで、ヘディング回転時にビルの3Dルーフ視差オフセット（`-roofShiftPx`）が道路縁へ張り出してノコギリ状の欠けを作る現象を根絶した。
  - **Pass 1（全道路の外枠ケーシング一括描画、`lineCap = "round"`）→ Pass 2（全道路の路面塗り一括描画、`lineCap = "round"`）→ Pass 3（中央線・車線破線 → 交差点ボックスの路面色塗りつぶしパッチ）** の順に描画することで、T字路端部の角張り・はみ出しと、交差点中央で黄色/白のセンターラインが十字に交錯するアーティファクトを解消した。
- **コーナーR補間付き推奨ルートとヘディング連動コンパス**:
  - 推奨ルートは渋谷エリアの180度折り返しバグを修正し、全交差点ターンに `quadraticCurveTo`（半径 `16m`）の接線円弧補間と進行方向シェブロン（矢羽根マーク）を導入した。
  - 右上のヘディングアップコンパスに車両方位 (`heading`) に応じて回転する赤色北針を追加した。

### 2.3 Zod スキーマ検証付き構造化ロガー

- [`apps/web/src/core/logger.ts`](../apps/web/src/core/logger.ts) に `StructuredLogEntrySchema` と `TraceContextSchema` を定義し、`withTrace` / `withAsyncTrace` によって親スパンから子スパンへ `traceId` と `parentSpanId` を自動伝播させる仕組みを実装した。

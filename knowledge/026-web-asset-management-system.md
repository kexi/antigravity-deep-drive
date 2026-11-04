---
title: Web アセット管理システム (AssetManagerUI) と /boost シェーダー事前プリビルド連携アーキテクチャ
tags:
  - architecture
  - ui
  - graphics
  - roads
trust_signals:
  verified_date: 2026-11-03
  author: antigravity
  verification_method:
    - "just format-code および just verify-all（tsc --noEmit, oxlint, vitest 220+ tests, tsdown build）による型検査・単体テスト・本番ビルド検証"
    - "AssetManager の CRUD・YAML シリアライズ・VRAM 推定および AssetManagerUI の URL ルーティング (/assets, /boost/assets, ?assets=1)・DOM 操作・ライブシーン同期の Vitest 単体テスト検証"
---

# Web アセット管理システム (`AssetManagerUI`) と `/boost` シェーダー事前プリビルド連携アーキテクチャ

## 1. 背景と目的

Antigravity Deep Drive では `apps/web/public/config/assets.yml`（およびフォールバック定義 `DEFAULT_ASSETS_YAML`）によって以下の 5 大カテゴリのアセットを一元管理している。

1. **`models`**: 車両 (`car.glb`)、東京駅丸の内駅舎 (`tokyo_station.glb`)、渋谷ストリーム (`shibuya_stream.glb`)、街路樹 (`street_tree.glb`)、ガードレール (`guardrail.glb`) の GLB パス・スケール・位置/回転オフセット・サブパーツ階層
2. **`textures3d`**: WebGL2 `sampler3D` ボリュームテクスチャ（アスファルト、赤レンガ、花崗岩、木目、葉群、ファブリック等）の 3D ボクセル解像度 ($16^3 \sim 64^3$)・FBM オクターブ・周波数スケール・配色
3. **`roads`**: 行幸通り・丸の内仲通り・内堀通り・明治通り・国道246号などの幅員・車線数・歩道幅・制限速度・路面標示仕様
4. **`signs`**: 規制標識・警戒標識・指示標識・案内標識（オーバーヘッドガントリー含む）の 3D 空間配置座標・回転・ラベル
5. **`weatherPresets`**: 時間帯と天候の直交パラメータ、フォグ濃度、太陽色、雨量、水面リップル、光学レンズフレア設定

従来は YAML ファイルを直接編集してリロードする必要があったため、ブラウザ上でリアルタイムに全アセットの検索・プレビュー・パラメータ調整・3D シーンへのライブ適用・`/boost` シェーダー事前プリビルド実行・YAML エクスポート／インポートを行える **Web アセット管理システム (`AssetManagerUI`)** を構築した。

---

## 2. アーキテクチャ設計

### 2.1 `AssetManager` の CRUD・VRAM 推定・YAML ラウンドトリップ拡張

`apps/web/src/assets/assetManager.ts` に以下の機能を追加した：

- **非破壊バリデーション (`validateYamlString`)**: 例外をスローせず `{ valid, manifest, errors }` を返し、UI エディタ上で Zod のフィールド単位エラーパスを表示可能にした。
- **カテゴリ別ライブ更新 API**:
  - `updateModelConfig(id, patch)`（シーン内の対応 3D モデルの `scale`・`offset` をリアルタイム同期）
  - `updateTexture3DConfig(id, patch)`（`resolution: 8..128` および `roughnessScale: 0.1..10.0` の安全境界を Zod で強制し、変更時に該当 ID の `Data3DTexture` キャッシュを破棄・ボクセル変調付きで独立インスタンスとして再生成）
  - `updateRoadConfig(id, patch)`
  - `upsertSign(sign)` / `removeSign(id)`（UI から `+ 新規標識を追加` で新規標識を追加可能）
  - `updateWeatherPreset(id, patch)`（`applyEnvironmentState` 実行後に `weatherSystem.applyPreset` と `cityMap.updateRainWetness` を適用し、カスタム太陽色・フォグ濃度を上書きせず反映）
- **VRAM 使用量推定 (`getManifestSummary`)**: 各 3D テクスチャのボクセル数 $N^3 \times 4\text{ bytes (RGBA8)}$ を合算し、解像度変更に伴う GPU メモリフットプリントを即座に可視化する。
- **構造化トレースログ**: すべての変更操作を `logger.withTrace("assetManager", ...)` で記録し、`window.__DEEP_DRIVE_LOGS__` から追跡可能にした。

### 2.2 ネイティブ `<dialog closedby="any">` とインタラクティブ `<canvas>` プレビュー

`apps/web/src/assets/assetManagerUI.ts` では Modern Web Guidance に準拠し、ブラウザ標準の `<dialog id="asset-manager-dialog" closedby="any">` を採用した。

- **360° ドラッグ回転 & Z スライス `<canvas>` プレビュー**:
  - `models`: 実寸バウンディングボックスと座標軸の 3D ワイヤーフレーム投影（ドラッグで Yaw 角を 360° 回転）
  - `textures3d`: 指定 Z スライス断面における 3D フラクタルノイズのリアルタイム 2D 断面レンダリング
  - `roads`: 車道・歩道・中央分離帯・車線境界線の道路構造令断面プレビュー
  - `signs`: `RoadSignSystem.drawPreviewToCanvas` と連携した高精細標識キャンバス描画
  - `weatherPresets`: 天頂〜地平線グラデーション・太陽・降雨パーティクル・路面湿潤反射プレビュー
- **`/boost` シェーダー事前プリビルド統合**:
  - ヘッダーの「⚡ `/boost` シェーダープレビルド」ボタンから `prebuildSceneShaders()` を直接トリガーし、コンパイル済みマテリアル数・オブジェクト数・所要ミリ秒をサマリーバーとステータスバナーに即座に表示する。
- **URL ルーティング連携 & 静的ホスティング対応**:
  - `/assets`、`/boost/assets`、`/asset-manager`、`?assets=1`、`?assetManager=1`、`#assets` でアクセスした際、起動と同時にアセット管理ダイアログを自動オープンする (`parseAssetManagerOption`)。
  - `apps/web/scripts/minify.ts` にて `dist/boost/index.html` に加え `dist/assets/index.html`、`dist/boost/assets/index.html`、`dist/asset-manager/index.html` を出力し、静的ホスティング環境でも直接 URL アクセスが 404 にならないようにした。
  - キーボードショートカット `<kbd>Y</kbd>`、タイトル画面ボタン、HUD コントロールパネル、モバイルクイックバーの 4 箇所からいつでも開閉できる。

---

## 3. 検証記録 (Trust Signals)

- `apps/web/src/tests/assetManager.test.ts` および `apps/web/src/tests/assetManagerUI.test.ts` にて、YAML バリデーション、3D テクスチャの解像度上限・`roughnessScale` 単独更新時のキャッシュ破棄とボクセル再計算、VRAM 算出、URL パス/クエリ判定 (`/assets`, `/boost/assets`, `?assets=1`)、標識 0 件時の安全なフォールバックと再追加の単体テストを作成し、全テストパスを確認。
- `just format-code` および `just verify-all` により、型検査 (`tsc --noEmit`)・Lint (`oxlint`)・全単体テスト (`vitest`)・本番バンドル (`tsdown`) がすべてエラーゼロで完了することを確認。

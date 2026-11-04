# Antigravity Deep Drive

> **渋谷 & 東京駅 丸の内 — WebGL / Three.js リアルタイム 3D オープンワールド・ドライビングシミュレーター**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r187-black.svg?logo=three.js)](https://threejs.org/)
[![Rapier 3D](https://img.shields.io/badge/Rapier_3D-0.21-orange.svg)](https://rapier.rs/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg?logo=pnpm)](https://pnpm.io/)
[![just](https://img.shields.io/badge/just-task_runner-red.svg)](https://github.com/casey/just)
[![GitHub Pages](https://img.shields.io/badge/demo-play_online-brightgreen.svg?logo=googlechrome)](https://kexi.github.io/antigravity-deep-drive/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Antigravity Deep Drive** は、ブラウザ上で動作する次世代 3D ドライブシミュレーションゲームです。東京都 Project PLATEAU の 3D 都市モデルおよび国土地理院 (GSI) の標高・道路中心線オープンデータを統合し、東京駅丸の内〜皇居周辺、および渋谷ストリーム周辺の精密な実空間ドライビング体験を提供します。

🎮 **オンラインデモ（ブラウザで今すぐプレイ）**: **[https://kexi.github.io/antigravity-deep-drive/](https://kexi.github.io/antigravity-deep-drive/)**

---

## 🌟 主な特徴

### 🏙️ 現実空間の再現とオープンデータ統合
- **東京駅丸の内・皇居エリア**: 行幸通り、和田倉門・和田倉濠、日比谷濠、丸の内駅舎、象徴的なイチョウ街路樹を実寸で再現。
- **渋谷ストリーム・国道246号・明治通りエリア**: Google 渋谷オフィスが入居する渋谷ストリーム実写ベースの 3D 建築、歩道橋、周回グリッド道路網および交差点を構築。
- **PLATEAU & 国土地理院オープンデータ**: 千代田区・渋谷区の PLATEAU 3D 建築メッシュおよび国土地理院 DEM5A 標高データ・道路中心線 GIS データを統合。日本の道路交通法に準拠した標識・ガードレール・信号機プロップを配置。

### 🚗 JDM（日本仕様）右ハンドル車両 & コクピット
- **トヨタ クラウン セダン (AZSH32)**: ミリ単位（1mm = 0.001m）のプロポーションでモデリングされた 3ナンバーセダン（全長 4.72m × 全幅 1.84m × 全高 1.43m、ホイールベース 2.82m）。
- **リアルタイム連動ミラー**: ルームミラーおよび左右ドアミラーに、別レイヤーで描画される実時間の後方・側方反射を投影。
- **車内ナビゲーション & 計器類**: 運転席視点（JDM 右ハンドル `x = -0.38m`）から視認可能なスピードメーター、ギア、車内カーナビ、4眼 LED ヘッドライトおよびキャビン照明。
- **物理サスペンション & プロシージャル音響**: Rapier 3D レイキャストサスペンション物理によるリアルな車体挙動と、Web Audio API による 2.5L 直列4気筒マルチステージハイブリッドのプロシージャルエンジン音響合成。

### 🎨 先進的なカスタムシェーダー & 描画パイプライン
- **大気散乱動的スカイ & ボリュメトリック雲**: 物理ベース大気散乱スカイ、星空、および 3D Perlin-Worley ノイズを用いたレイマーチングボリュメトリック雲シェーダー。
- **水面 & 雨滴・路面表現**: トロコイド Gerstner 波によるお堀水面、動的雨滴リップル法線付きの水たまりシェーダー、ワイパー払拭シミュレーション連動のフロントガラス雨粒シェーダー。
- **シネマティック・ポストプロセス**: 物理オクルージョン連動レンズフレア、高度減衰深度フォグ（Depth Fog）、コクピットインテリアを深度バッファマスクで除外する車外専用モーションブラー。
- **時間帯 × 天候の直交分離**: 時間（朝 `morning` / 昼 `day` / 夕暮れ `sunset` / 夜 `night`）と天候（晴天 `clear` / 曇天 `cloudy` / 雨天 `rain`）を独立制御し、夕暮れの雨天や夜間の豪雨など多彩なシチュエーションに対応。

### 🎮 マルチデバイス & 最適化
- **多彩な入力方式**:
  - キーボード & マウス（自由視線・首振り・ミラー拡大）
  - ゲームパッド（Nintendo Switch Pro コントローラー / 一般 Gamepad API）
  - モバイル Chrome（縦持ち Portrait / 横持ち Landscape 対応のマルチタッチ運転コントローラー、適応型 FOV）
- **パフォーマンス最適化**:
  - **空間チャンクストリーミング**: 街区ごとの動的ロード・アンロードによるメモリ管理
  - **多段階距離 LOD**: 遠方メッシュのポリゴン削減と軽量化
  - **グラフィック品質プリセット**: 高（High）/ 中（Medium）/ 低（Low）の 3 段階描画制御
  - **`/boost` シェーダー事前プリビルド**: 走行中のシェーダーコンパイルカクつきを完全排除

---

## 🎮 操作方法 (Controls)

### キーボード & マウス

| カテゴリ | キー / 操作 | 動作 |
|:---|:---|:---|
| **走行操作** | <kbd>W</kbd> / <kbd>↑</kbd> | アクセル（加速） |
| | <kbd>S</kbd> / <kbd>↓</kbd> | ブレーキ / バック（制動・後退） |
| | <kbd>A</kbd> / <kbd>D</kbd> | ステアリング（左 / 右操舵） |
| | <kbd>Space</kbd> | ハンドブレーキ（サイドブレーキ） |
| | <kbd>Q</kbd> / <kbd>E</kbd> | 左 / 右ウインカー（方向指示器） |
| | <kbd>Z</kbd> | ハザードランプ |
| | <kbd>R</kbd> | 車両位置リセット（路上復帰） |
| **視点・視線** | マウス移動 | 自由視線カメラ |
| | <kbd>C</kbd> | 視点切替（運転席コクピット / 後方追従 / ボンネット） |
| | <kbd>V</kbd> | 正面リセット |
| | <kbd>J</kbd> / <kbd>L</kbd> | 左右首振り |
| | <kbd>U</kbd> / <kbd>O</kbd> | 左右安全目視確認 |
| | <kbd>I</kbd> | ルームミラー注視 |
| | <kbd>Shift + Q</kbd> / <kbd>Shift + E</kbd> | 左 / 右ドアミラー注視 |
| | <kbd>K</kbd> | インパネ計器・ナビ注視 |
| **環境・システム** | <kbd>P</kbd> | エリア切替（東京駅丸の内 ↔ 渋谷ストリーム） |
| | <kbd>T</kbd> | 時間帯切替（朝 → 昼 → 夕暮れ → 夜） |
| | <kbd>G</kbd> | 路面状態切替（乾燥 Dry → 湿潤 Wet → 水たまり Puddle） |
| | <kbd>X</kbd> | ワイパー切替（OFF → 間欠 INT → 低速 LO → 高速 HI） |
| | <kbd>H</kbd> | エンジン音 ON / OFF |
| | <kbd>[</kbd> / <kbd>]</kbd> | エンジン音量調整（DOWN / UP） |
| | <kbd>B</kbd> | モーションブラー ON / OFF |
| | <kbd>F</kbd> | グラフィック品質切替（高 High → 中 Medium → 低 Low） |
| | <kbd>Tab</kbd> | HUD 非表示 / 没入ドライブモード切替 |
| | <kbd>M</kbd> | 道路標識作成・配置ダイアログ表示 |
| | <kbd>Y</kbd> | Web アセット管理パネル表示 |
| | <kbd>N</kbd> | 言語切替（日本語 / English / 中文） |

### Nintendo Switch Pro コントローラー (Gamepad)

| ボタン | 機能 |
|:---|:---|
| **Lスティック** | ステアリング操舵 / 視線微調整 |
| **Rスティック** | カメラ視線移動 |
| **ZR** / **A** | アクセル（加速） |
| **ZL** / **B** | ブレーキ（制動・後退） |
| **Y** | ハンドブレーキ |
| **X** | カメラ視点切替 |
| **L** / **R** | 左 / 右ドアミラー注視 |
| **D-Pad (十字キー)** | 上: ルームミラー / 下: カーナビ / 左: ワイパー / 右: 時間帯切替 |
| **L3 (スティック押込)** | 路面状態切替 |
| **-** / **+** | エリア切替 / 車両リセット |
| **Capture** | グラフィック品質切替 |

---

## 🛠️ 技術スタック

| 分野 | 採用技術 |
|:---|:---|
| **コアエンジン** | [Three.js](https://threejs.org/) (r187), WebGL 2.0 |
| **物理演算** | [@dimforge/rapier3d-compat](https://rapier.rs/) (Rapier 3D) |
| **言語・ランタイム** | [TypeScript](https://www.typescriptlang.org/) 5.x, [Node.js](https://nodejs.org/) |
| **ビルド & バンドラ** | [Vite](https://vite.dev/), [tsdown](https://github.com/antfu/tsdown) (Minification 最適化) |
| **3D モデリング** | [Blender](https://www.blender.org/) 4.x (公式 Blender MCP + Python スクリプト), GLTF / GLB |
| **オープンデータ** | 国土交通省 [Project PLATEAU](https://www.mlit.go.jp/plateau/) (3D都市モデル), [国土地理院 (GSI)](https://www.gsi.go.jp/) DEM5A & 道路中心線 |
| **データ検証 & ログ** | [Zod](https://zod.dev/), YAML, 構造化トレースロガー (1イベント1行 JSON) |
| **音響** | Web Audio API (プロシージャル波形合成) |
| **開発環境・タスク** | [pnpm](https://pnpm.io/) workspace, [just](https://github.com/casey/just), [lefthook](https://github.com/evilmartians/lefthook) |
| **品質保証** | [Vitest](https://vitest.dev/), [oxlint](https://oxc.rs/), [oxfmt](https://oxc.rs/), [ruff](https://docs.astral.sh/ruff/) |
| **CI / CD** | GitHub Actions (Action SHA Pinning via [pinact](https://github.com/suzuki-shunsuke/pinact)), GitHub Pages |

---

## 🚀 開発環境のセットアップ

### 前提条件
- **Node.js**: v22 以上
- **pnpm**: v10 以上
- **just**: コマンドランナー (`brew install just` / `nix` など)
- **uv**: Python パッケージマネージャー（Blender スクリプト実行用）
- **Blender** (オプション): 3D アセットの再生成または Blender MCP 連携時に使用

### クイックスタート

```bash
# 1. リポジトリのクローン
git clone https://github.com/kexi/antigravity-deep-drive.git
cd antigravity-deep-drive

# 2. 依存関係のインストール & Gitフックの登録
just install-deps

# 3. 開発サーバーの起動 (http://localhost:5173)
just start-dev
```

### 利用可能な `just` レシピ一覧

```bash
# 品質検証の一括実行（Action検証・型検査・リント・単体テスト・本番ビルド）
just verify-all

# コード自動整形
just format-code

# 型検査
just check-types

# リント実行
just lint-code

# テスト実行
just run-tests

# 本番用ビルド成果物のローカルプレビュー
just preview-app

# 3DモデルアセットをBlenderで一括プロシージャル生成
just model-assets

# 東京都PLATEAU & 国土地理院オープンデータの最新取得
just fetch-open-data
```

---

## 📁 ディレクトリ構成

```text
antigravity-deep-drive/
├── apps/
│   └── web/                     # メイン WebGL / Three.js フロントエンド
│       ├── public/models/       # プロシージャル生成された GLB 3D アセット
│       ├── scripts/             # オープンデータ取得 & tsdown minify スクリプト
│       └── src/
│           ├── assets/          # YAML アセット管理 & 標識作成 UI
│           ├── audio/           # Web Audio API プロシージャルエンジン音響合成
│           ├── city/            # 空間チャンクストリーミング & 都市建築配置
│           ├── core/            # Zod 検証付き構造化ロガー & システム基盤
│           ├── openData/        # PLATEAU 3D都市モデル & 国土地理院 GIS ローダー
│           ├── physics/         # Rapier 3D 物理ワールド & レイキャスト車両
│           ├── roads/           # 日本の道路生成・交差点開口・路面テクスチャ
│           ├── shaders/         # カスタム GLSL シェーダー群 (空・雲・水面・雨滴・フォグ等)
│           ├── vehicle/         # トヨタ クラウン 車両モデリング & コクピット連動
│           ├── weather/         # 時間帯 (TimeOfDay) & 天候 (WeatherCondition) 制御
│           └── main.ts          # アプリケーション初期化 & メインレンダリングループ
├── blender/
│   └── scripts/                 # Blender プロシージャルモデリング用 Python スクリプト
├── knowledge/                   # OKF 形式のアーキテクチャ設計・検証ナレッジベース
├── AGENTS.md                    # AI エージェント用開発・運用規約 (3D/ログ/シェーダー)
├── justfile                     # タスクランナー定義
├── package.json                 # pnpm ワークスペース定義
└── README.md                    # 本ドキュメント
```

---

## 📖 ナレッジベース (OKF)

本プロジェクトでは、アーキテクチャの設計思想や物理・シェーダーの実験・検証記録を [`knowledge/`](knowledge/index.md) 配下に Open Knowledge Format (OKF) として蓄積しています。

- [001: 全体アーキテクチャ & 描画パイプライン](knowledge/001-architecture-overview.md)
- [002: 日本の道路生成システムと路面表現](knowledge/002-japanese-road-system.md)
- [004: 物理ベース水たまりシェーダー](knowledge/004-puddle-shader.md)
- [005: フロントガラス雨粒 & ワイパーシミュレーション](knowledge/005-windshield-raindrop-shader.md)
- [014: Rapier レイキャスト車両物理 & 3D ボリュームテクスチャ](knowledge/014-3d-textures-rapier-raycast-vehicle-and-high-precision-modeling.md)
- [015: PLATEAU & 国土地理院オープンデータ統合](knowledge/015-tokyo-plateau-and-gsi-open-data.md)
- [016: JDM カーナビ・時間×天候直交分離・構造化ロガー](knowledge/016-jdm-navigation-time-weather-and-zod-logger.md)
- [018: トヨタ クラウン セダン 360度モデリング & キャビン照明](knowledge/018-toyota-crown-sedan-3d-interior-textures-lighting-and-road-surface.md)
- [019: 渋谷ストリーム実写ベースモデリング & 30fps 最適化](knowledge/019-google-shibuya-office-shibuya-stream.md)
- [020: モバイル Chrome マルチタッチ操作 & レスポンシブ HUD](knowledge/020-mobile-chrome-touch-controls-and-responsive-hud.md)
- [025: プロシージャル Web Audio API エンジン音響合成](knowledge/025-engine-sound-synthesis.md)
- [028: オープンワールド型空間チャンクストリーミング](knowledge/028-open-world-chunk-streaming-and-memory-management.md)
- [031: 深度バッファマスク除外モーションブラー](knowledge/031-cockpit-depth-masked-motion-blur-and-road-props.md)
- [032: 車内ルームミラー & 左右ドアミラーの描画バジェット](knowledge/032-cockpit-mirrors-backface-culling-and-frame-cadence.md)

---

## 📜 ライセンス

MIT License © 2026 Kei Nakayama (kexi)

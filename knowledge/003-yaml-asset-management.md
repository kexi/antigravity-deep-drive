---
title: YAMLアセット管理システムとZodバリデーションアーキテクチャ
tags:
  - architecture
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
---

# YAMLアセット管理システムとZodバリデーションアーキテクチャ

## 概要

本プロジェクトでは、3Dモデル・プロシージャル3Dテクスチャ・日本の道路網・道路標識・動的天候パラメータなどの全アセット設定を `apps/web/public/config/assets.yml` に集約し、YAML 形式で宣言的に一元管理するアーキテクチャを採用した。

## 設計方針・構造

1. **宣言的アセット設定 (`assets.yml`)**:
   - `models`: 車両 (`car.glb`)、東京駅赤レンガ駅舎 (`tokyo_station.glb`) のパス、スケール、初期位置オフセット、サブパーツ階層名、フォールバック色。
   - `textures3d`: アスファルトPBRボリューム (`asphalt_pbr`)、大気フォグボリューム (`volumetric_fog`) の解像度・ノイズ粗さ。
   - `roads`: 行幸通り、丸の内中央通り、日比谷通りの車線数、幅員、制限速度、歩道幅、区画線種別（実線黄、破線白）、路面付帯物（ガードレール、マンホール、グレーチング、信号機）。
   - `signs`: 大型オーバーヘッド案内青看板（108-A）、最高速度（323）、一時停止（330）、進入禁止（303）、指定方向外進行禁止（311）、信号機あり警戒標識（201-2）、横断歩道指示標識（407）、通称名標識（119）の配置座標、回転角、表示テキスト。
   - `weatherPresets`: 夕暮れ (sunset)、晴天 (clear)、雨天 (rain)、夜景 (night) の太陽光座標・色、アンビエント色、フォグ密度、雨量、ワイパースピード、レンズフレア強度。

2. **Zod による厳密な実行時型検証 (`schema.ts`)**:
   - `yaml` パッケージでパースされた生オブジェクトを `AssetManifestSchema.parse()` でバリデーション。
   - スキーマ違反や必須フィールドの欠落があればビルド時・起動時に即座に検出し、型安全な TypeScript 型 (`AssetManifest`) を提供。

3. **オフライン・テスト環境耐性 (`defaultAssetsYaml.ts` & `AssetManager`)**:
   - Node.js や Vitest などのローカル HTTP サーバが存在しない環境、またはネットワークフェッチが失敗した場合は、組み込みの `DEFAULT_ASSETS_YAML` へ自動フォールバック。
   - 3Dテクスチャのオンデマンド生成とキャッシュ管理を統合。

## 検証結果 (Trust Signals)

- **Vitest**: `src/tests/assetManager.test.ts` において、正常系マニフェストパース、Zod スキーマ違反検知、モデル・道路・標識・3Dテクスチャキャッシュ・天候プリセットの取得を検証し、全テストパス（13 tests passed）。
- **TypeScript**: `tsc --noEmit` による型検査でエラー 0 件。
- **Oxlint**: 0 warnings, 0 errors。
- **Vite 8 Build**: 本番バンドルビルド（HTML 6.08 kB, JS 5.21 MB）成功。

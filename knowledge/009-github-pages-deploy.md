---
title: GitHub Pages 自動デプロイとサブパス配信・SHA Pinning CI/CD パイプライン
tags:
  - ci-cd
  - architecture
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
---

# GitHub Pages 自動デプロイとサブパス配信・SHA Pinning CI/CD パイプライン

## 概要

東京駅ドライブシミュレーターを Web 上で即座にプレイ可能とするため、GitHub Actions による GitHub Pages への完全自動デプロイパイプラインを構築した。GitHub Pages 特有のサブディレクトリ配信（`/antigravity-deep-drive/`）への対応、および厳格なサプライチェーンセキュリティ（外部 Action のフルコミット SHA pin、`actionlint`、`pinact`）を適用した。

## 技術仕様・アーキテクチャ

1. **Vite ベースパス動的解決 (`apps/web/vite.config.ts`)**:
   - `BASE_URL` 環境変数または GitHub Actions 実行環境変数（`process.env.GITHUB_ACTIONS`）に応じて、ベースパスを `/antigravity-deep-drive/` に自動切り替え。ローカル開発時はルート `/` で快適に稼働。
   - 生成される HTML の `<script>` / `<link>` タグに正確なベースパスが付与される。

2. **アセットマネージャーの URL 正規化 (`AssetManager.resolveAssetUrl`)**:
   - 外部 YAML 定義（`assets.yml`）や GLB モデル等の読み込み時、Vite の `import.meta.env.BASE_URL` を動的に適用。
   - 絶対パス指定（`/config/assets.yml`）であっても自動的にサブパス付き URL へ正規化し、GitHub Pages 上での 404 リソースエラーを完全に防止。

3. **厳格な GitHub Actions ワークフロー (`.github/workflows/deploy.yml`)**:
   - **パーミッション最小化**: `contents: read`, `pages: write`, `id-token: write` のみ付与。
   - **並行デプロイ制御**: `concurrency: group: pages, cancel-in-progress: false`。
   - **品質ゲート**: ビルド前に `typecheck`、`oxlint`、`vitest` を通過必須とし、破綻したビルドがデプロイされることを防止。
   - **デプロイ公式アクション**: `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages` を使用。

4. **サプライチェーン攻撃対策 (SHA Pinning & Action Linting)**:
   - 全外部 Action の `uses:` をフルコミット SHA で固定（SHA-1 40文字）し、バージョンコメントを付記。
   - `pinact run` および `pinact run --verify` による機械的検証。
   - `actionlint` によるワークフローの構文・セキュリティ静的解析。

5. **`justfile` タスク統合**:
   - `build-pages`: ローカルで GitHub Pages 向けビルドを再現実行。
   - `check-actions`: `actionlint` と `pinact run --check` を一括検証。
   - `pin-actions`: ワークフロー内 Action の自動 SHA pin。
   - `verify-all`: アクション検証を組み込み、リポジトリ全体の品質を一括保証。

## 検証結果 (Trust Signals)

- **actionlint**: 0 warnings, 0 errors（全構文妥当）。
- **pinact**: `pinact run --check` にて全 Action のコミット SHA pin 整合性を確認。
- **build-pages**: `dist/index.html` にて `/antigravity-deep-drive/assets/...` への正常なリンク生成を確認。
- **Vitest**: `src/tests/assetManager.test.ts` にて `resolveAssetUrl` の URL 正規化を検証（全 9 テストファイル、30 テスト全パス）。
- **just verify-all**: 全工程パス。

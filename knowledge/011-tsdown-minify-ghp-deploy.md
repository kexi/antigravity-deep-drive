---
title: tsdown によるバンドル Minification 最適化と GitHub Pages デプロイパイプライン
tags:
  - ci-cd
  - architecture
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
  test_command: just verify-all
  verification_status: verified
---

# tsdown によるバンドル Minification 最適化と GitHub Pages デプロイパイプライン

## 1. 概要と背景

ユーザーの技術スタック・コーディングスタイル規範において、TypeScript バンドラーとして指定されている `tsdown`（Rolldown + Oxc Minifier 搭載）を活用し、東京駅ドライブシミュレーターの Web アプリケーション成果物を追加 minify 最適化して GitHub Pages (ghp) へ自動デプロイするパイプラインを構築した。

## 2. アーキテクチャと処理フロー

### 2.1 ビルド・Minify パイプライン
1. **TypeScript 型検査 (`tsc --noEmit`)**: 全ソースコードの型安全性を検証。
2. **Vite プロダクションバンドル (`vite build`)**: HTML エントリーポイント・WASM・YAML・静的アセット・GitHub Pages 向けベースパス（`/antigravity-deep-drive/`）の解決と基本バンドル生成。
3. **tsdown Minification 最適化 (`tsx scripts/minify.ts`)**:
   - `dist/assets` 配下の生成 JavaScript ファイルを探索。
   - `tsdown <file> --out-dir <tempDir> --minify --platform browser --format esm --no-clean` を実行。
   - Oxc / Rolldown の高速 Minifier により構文最適化されたコードでインプレース置換。
   - 一時ディレクトリを安全に破棄。

### 2.2 依存関係とサプライチェーン管理
- `.npmrc` の `minimumReleaseAge=1440` および `strictDepBuilds=true` 規範に準拠。
- `pnpm-workspace.yaml` の `allowBuilds` に `esbuild: true`（tsx の依存）を明示し、安全にスクリプト実行を許可。
- `apps/web/package.json` の devDependencies に `tsdown: ^0.23.4`, `tsx: ^4.23.15` を追加。

### 2.3 GitHub Actions CI/CD 連動
- `.github/workflows/deploy.yml` 内の `pnpm -r build` ステップにて、Vite ビルドから `tsdown` による minify までが一括自動実行。
- minify 済みの `apps/web/dist` が `upload-pages-artifact` を経由して GitHub Pages 環境へデプロイ。

## 3. レシピと運用コマンド

- `just build-pages`: GitHub Pages 向けにベースパスを設定し、Vite バンドル & tsdown minify を一括実行。
- `just minify-assets`: 既存の `dist/assets/*.js` を `tsdown` で手動再 minify。
- `just deploy-pages`: `gh workflow run deploy.yml` を呼び出し GitHub Pages デプロイを開始。
- `just verify-all`: アクション検証・型検査・リント・テスト・ビルド＆minifyを一括検証。

## 4. 検証結果 (Trust Signals)

- `just verify-all`: 全10テストファイル・35テスト全パス、Actionlint / Pinact / tsc / Oxlint / Vite / tsdown minify 0警告0エラー。
- `tsdown` による minify 処理時間: ~94ms。

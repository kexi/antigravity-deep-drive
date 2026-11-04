---
title: 多言語対応（日本語・英語・中国語）とブラウザ言語自動検出アーキテクチャ
tags:
  - ui
  - architecture
  - open-data
trust_signals:
  verified_date: 2026-11-03
  author: antigravity
  verification: "just format-code && just verify-all (Vitest 15ファイル 102テスト全通過、tsc --noEmit、oxlint、Vite build + tsdown minify 成功)"
---

# 多言語対応（日本語・英語・中国語）とブラウザ言語自動検出アーキテクチャ

## 1. 背景と目的

Antigravity Deep Drive の Web UI・HUD・車内11インチカーナビ・PLATEAU/国土地理院 GIS テレメトリ・道路標識作成モーダルを **日本語 (`ja`)**・**英語 (`en`)**・**中国語 (`zh`)** の3言語に対応させ、かつ初期起動時には **ブラウザの言語設定（`navigator.languages` / `navigator.language`）を自動的にデフォルト言語として適用** する仕組みを導入した。

## 2. ブラウザ言語の自動検出と優先順位設計 (`apps/web/src/core/i18n.ts`)

1. **URL クエリによる明示指定（最優先）**:
   - `?lang=ja|en|zh` または `?locale=ja|en|zh` が指定されている場合は、デバッグ・E2E 検証・共有リンク用途としてブラウザ設定より優先する。
2. **ブラウザ言語設定の自動検出（デフォルト動作）**:
   - `navigator.languages` の優先順位リストを先頭から走査し、最初にサポート対象言語（`ja`, `en`, `zh`）へ正規化できた言語を採用する。
   - `navigator.languages` が空または未定義の環境では `navigator.language` を評価する。
   - BCP 47 言語タグの地域・スクリプト派生（`en-US`, `en-GB`, `zh-CN`, `zh-TW`, `zh-HK`, `zh-Hans`, `zh-Hant`, `cmn`, `yue`, `ja-JP` 等）を `normalizeLocaleTag()` で基底言語コード（`ja` / `en` / `zh`）へ正規化する。
3. **未対応言語環境でのフォールバック**:
   - ブラウザ設定が `fr-FR` など未対応言語のみの場合は `"ja"` にフォールバックする。

## 3. 多言語ローカライズ対象レイヤー

- **DOM / HUD / モバイルクイックバー / 設定ドロワー / タッチパッド**:
  - `applyDocumentTranslations()` により `<html lang="...">`（`ja` / `en` / `zh-CN`）、`document.title`、全ボタンラベル、キーバインド説明、タッチ操作パッドの `aria-label` を一括更新する。
  - 設定ドロワー内 `#lang-buttons`（日本語 / English / 中文）、モバイル上部 `#quick-lang-btn`、キーボードショートカット `[N]` で実行中にリアルタイム切替が可能。
- **時間帯・天候・路面状態・視線プリセット**:
  - `WeatherSystem.getEnvironmentSummary(locale)` および `CameraController.getGazeState(locale)` に `locale` 引数（デフォルト `"ja"` で既存互換）を追加し、HUD バッジと車内カーナビ上部ステータスバーの双方で翻訳済みラベルを表示する。
- **東京都 PLATEAU & 国土地理院 GIS テレメトリ / 11インチ車内カーナビ (`carModel.ts`)**:
  - 国土地理院道路名（行幸通り・内堀通り・日比谷通り・明治通り・国道246号等）、幅員区分、PLATEAU 3D都市モデル建物名（東京駅丸の内駅舎・渋谷ストリーム等）、およびカーナビ画面のターンバイターン案内・ランドマークラベルを3言語に翻訳する。
- **道路標識作成モーダル (`roadSignCreatorUI.ts`)**:
  - 国土交通省道路標識カタログの名称・カテゴリグループ・道路構造令バリデーションメッセージを3言語で動的に再描画する。

---
title: Knowledge Index
tags:
  - architecture
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
---

# Knowledge Index

本リポジトリにおける設計・知見・検証記録のインデックス。

## ドキュメント一覧

- [001-architecture-overview.md](./001-architecture-overview.md): 東京駅ドライブゲームの全体アーキテクチャ・技術選定・描画パイプライン
- [002-japanese-road-system.md](./002-japanese-road-system.md): 日本の道路生成システムと路面表現（視覚的凸凹と物理的平坦化）
- [003-yaml-asset-management.md](./003-yaml-asset-management.md): YAMLアセット管理システムとZodバリデーションアーキテクチャ
- [004-puddle-shader.md](./004-puddle-shader.md): 物理ベース水たまりシェーダーと動的雨滴リップル法線表現
- [005-windshield-raindrop-shader.md](./005-windshield-raindrop-shader.md): フロントガラス雨粒シェーダーと動的ワイパー払拭・風圧シミュレーション
- [006-water-surface-shader.md](./006-water-surface-shader.md): 皇居のお堀（和田倉濠・日比谷濠）とトロコイドGerstner波水面シェーダー
- [007-depth-fog.md](./007-depth-fog.md): 物理ベース高度減衰・大気散乱 深度フォグ（Depth Fog）ポストプロセス
- [008-lens-flare.md](./008-lens-flare.md): 物理オクルージョン連動 光学シネマティック・レンズフレア（Lens Flare）ポストプロセス
- [009-github-pages-deploy.md](./009-github-pages-deploy.md): GitHub Pages 自動デプロイとサブパス配信・SHA Pinning CI/CD パイプライン
- [010-sky-shader.md](./010-sky-shader.md): 物理ベース大気散乱・プロシージャル動的雲・星空 空シェーダー (Atmospheric Dynamic Sky Shader)
- [011-tsdown-minify-ghp-deploy.md](./011-tsdown-minify-ghp-deploy.md): tsdown によるバンドル Minification 最適化と GitHub Pages デプロイパイプライン
- [012-shader-compile-and-normal-matrix-fix.md](./012-shader-compile-and-normal-matrix-fix.md): Three.js フラグメントシェーダーにおける normalMatrix と metalnessFactor コンパイル不整合の解決

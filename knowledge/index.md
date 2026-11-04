---
title: Knowledge Index
tags:
  - architecture
trust_signals:
  verified_date: 2026-11-03
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
- [013-tree-and-foliage-shader.md](./013-tree-and-foliage-shader.md): 行幸通りイチョウ街路樹のBlender CLIモデリングと物理ベース葉っぱシェーダー・木シェーダー
- [014-3d-textures-rapier-raycast-vehicle-and-high-precision-modeling.md](./014-3d-textures-rapier-raycast-vehicle-and-high-precision-modeling.md): 3Dボリュームテクスチャ生成・Rapierレイキャスト車両物理・高精度3Dモデリング刷新・Blender公式MCP導入
- [015-tokyo-plateau-and-gsi-open-data.md](./015-tokyo-plateau-and-gsi-open-data.md): 東京都 Project PLATEAU (千代田区 13101) & 国土地理院 (GSI DEM5A / 道路中心線) オープンデータ統合
- [016-jdm-navigation-time-weather-and-zod-logger.md](./016-jdm-navigation-time-weather-and-zod-logger.md): JDM右ハンドル車内カーナビ・時間帯×天候の直交分離・Zod構造化トレースロガー
- [017-volumetric-cloud-shader.md](./017-volumetric-cloud-shader.md): 3D Perlin-Worley ボリュメトリック・レイマーチング雲シェーダー (Volumetric Raymarching Cloud Shader)
- [018-toyota-crown-sedan-3d-interior-textures-lighting-and-road-surface.md](./018-toyota-crown-sedan-3d-interior-textures-lighting-and-road-surface.md): トヨタ クラウン セダン (AZSH32) 360度モデリング・車内3Dテクスチャ・キャビン＆4眼LEDヘッドライト光源・路面状態分離・ドライバー視点防振
- [019-google-shibuya-office-shibuya-stream.md](./019-google-shibuya-office-shibuya-stream.md): 渋谷ストリーム実写ベース Blender 3Dモデリング・3Dテクスチャ・曲線道路オープンデータ統合・タイトル画面＆30fps最適化
- [020-mobile-chrome-touch-controls-and-responsive-hud.md](./020-mobile-chrome-touch-controls-and-responsive-hud.md): モバイル Chrome（縦持ち Portrait・横持ち Landscape）マルチタッチ運転コントローラー・レスポンシブ HUD・適応型 FOV 設計
- [021-three-tier-graphics-quality-settings.md](./021-three-tier-graphics-quality-settings.md): 三段階グラフィック品質プリセット（高 high / 中 medium / 低 low）の描画パイプライン制御設計
- [022-multi-language-i18n-browser-locale.md](./022-multi-language-i18n-browser-locale.md): 多言語対応（日本語・英語・中国語）とブラウザ言語自動検出アーキテクチャ
- [023-switch-pro-controller-gamepad-support.md](./023-switch-pro-controller-gamepad-support.md): Nintendo Switch Pro コントローラー (ProCon 1 / HAC-013) 対応と Gamepad API ハイブリッド入力アーキテクチャ
- [024-boost-shader-prebuild.md](./024-boost-shader-prebuild.md): `/boost` オプションによる 3D シーン・ポストプロセスシェーダー一括事前プリビルド設計
- [025-engine-sound-synthesis.md](./025-engine-sound-synthesis.md): プロシージャル Web Audio API エンジン音響合成（2.5L 直列4気筒マルチステージハイブリッド再現）
- [026-web-asset-management-system.md](./026-web-asset-management-system.md): Web アセット管理システム (`AssetManagerUI`) と `/boost` シェーダー事前プリビルド連携アーキテクチャ
- [027-urban-grid-street-network-and-intersections.md](./027-urban-grid-street-network-and-intersections.md): 渋谷・丸の内エリアの街中周回グリッド道路網・交差点開口分割・PLATEAU沿道街区の構築
- [028-open-world-chunk-streaming-and-memory-management.md](./028-open-world-chunk-streaming-and-memory-management.md): オープンワールド型空間チャンクストリーミングとメモリバジェット管理アーキテクチャ
- [029-mm-precision-car-and-non-overlapping-lane-system.md](./029-mm-precision-car-and-non-overlapping-lane-system.md): ミリ単位（1mm = 0.001m）車両3Dモデリングと非重複車線・横断歩道レンダリングシステム
- [030-distance-lod-model-optimization.md](./030-distance-lod-model-optimization.md): 遠方3Dモデルの距離ベース多段階LOD（Level of Detail）軽量化アーキテクチャ
- [031-cockpit-depth-masked-motion-blur-and-road-props.md](./031-cockpit-depth-masked-motion-blur-and-road-props.md): 深度バッファマスクによる車内インテリア除外モーションブラーと日本の道路交通法準拠プロップ改修




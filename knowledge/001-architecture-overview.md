---
title: 東京駅ドライブシミュレーター アーキテクチャ概要
tags:
  - architecture
  - graphics
  - physics
  - open-data
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
  verification_method: 実装前設計および依存関係の検証（Three.js v0.187 + Rapier3D 0.21 + pnpm v11）
---

# 東京駅ドライブシミュレーター アーキテクチャ概要

## 1. 目的
東京都などのオープンデータ（Project PLATEAU 3D都市モデル・OpenStreetMap等）を活用し、東京駅周辺（丸の内駅前広場、行幸通り、丸の内高層ビル群）をリアルにドライブできるWeb 3Dドライビングシミュレーターを構築する。

## 2. コア技術スタック
- **3Dグラフィックス**: Three.js (WebGL2 / PBRマテリアル / カスタムシェーダー)
- **3D物理エンジン**: Rapier 3D (`@dimforge/rapier3d-compat`)
  - WebAssemblyで動作し、高速な剛体・メッシュコライダー・車両力学シミュレーションを実現。
- **パッケージマネージャ**: pnpm v11
- **ビルドツール**: Vite + TypeScript
- **品質・テスト**: Vitest / oxlint / oxfmt / tsc

## 3. レンダリング・エフェクトパイプライン
1. **フロントガラス＆雨滴・ワイパーシェーダー**:
   - コックピット視点での水滴屈折・表面張力・動的滑落シミュレーション。
   - ワイパーの弧状スイープ角に応じた動的マスククリア処理。
2. **天候システム**:
   - 快晴・夕暮れ・雨・夜間の動的ライティングと環境マップ遷移。
   - アスファルト濡れ度（Roughness・フレネル・水たまり）の動的変化。
3. **光学・カメラエフェクト**:
   - 太陽・対向車ライト・街灯に対するオクルージョン判定付きレンズフレア。
   - 車速・視線移動に追従する景色のモーションブラー（Velocity / Radial Motion Blur）。

## 4. Blender 連携方針
- コックピット内装、外装ボディ、ピボット分離ワイパーブレード、フロントガラスのメッシュ階層構造をBlender基準で設計し、glTF/GLBでインポート可能とする。

---
title: フロントガラス雨粒シェーダーと動的ワイパー払拭・風圧シミュレーション
tags:
  - graphics
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
---

# フロントガラス雨粒シェーダーと動的ワイパー払拭・風圧シミュレーション

## 概要

運転席コックピット視点でのリアルな雨天ドライブ体験を実現するため、多重スケール雨滴、車速連動風圧ドラッグ、ワイパーブレード払拭およびエッジ水堤（Water Ridge）をシミュレートするプロシージャル GLSL ガラスシェーダーを実装した。

## 技術仕様・アルゴリズム

1. **3層スケール雨滴システム**:
   - **静止微小水滴 (Micro Mist / Condensation)**: ガラス全体に付着する高密度な細かい結露滴。
   - **動的滑落水滴 (Sliding / Streaking Drops)**: 重力と風圧によって不規則に蛇行落下する中・大粒水滴。
   - **水滴トレイル (Droplet Trails)**: 滑り落ちた雨滴の直後に残る薄い雨筋と微細滴。

2. **走行風圧ベクトル (Aerodynamic Wind Drag)**:
   - 車両速度 `uSpeed` の増加に伴い、水滴の滑落方向が静止時の真下（重力方向）から、空気抵抗によって斜め上方・サイドガラス方向へと吹き飛ばされる軌道変調を実現。

3. **物理屈折・凸レンズ効果 (Lens Refraction & Specular)**:
   - 水滴の球冠形状（Spherical Cap）の幾何学的法線を計算し、光の屈折歪みと街灯・太陽・ヘッドライトの強いスペキュラきらめきを表現。

4. **ワイパー払拭と水堤 (Wiper Blade Clearing & Water Ridge)**:
   - 運転席・助手席のワイパーアーム角度（`uWiperAngle1`, `uWiperAngle2`）に基づき、ブレード可動扇形域内の水滴を除去。
   - ブレードの折り返しエッジ（反転地点）に線状に溜まる水滴の縁（Water Ridge）を計算し、払拭境界のリアルな水溜まりを再現。

## 検証結果 (Trust Signals)

- **Vitest**: `src/tests/windshieldShader.test.ts` において、マテリアルの透過性、ユニフォーム連動、静止微小滴・滑落滴・ワイパークリアリング・水堤ロジックの存在を検証し、全テストパス（全19テスト成功）。
- **Pipeline**: `just verify-all`（`check-types`, `lint-code`, `run-tests`, `build-app`）全工程パス。

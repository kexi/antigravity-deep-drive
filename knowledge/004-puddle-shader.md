---
title: 物理ベース水たまりシェーダーと動的雨滴リップル法線表現
tags:
  - graphics
trust_signals:
  verified_date: 2026-10-31
  author: antigravity
---

# 物理ベース水たまりシェーダーと動的雨滴リップル法線表現

## 概要

雨天時における東京駅丸の内エリアの没入感を飛躍的に向上させるため、GLSL カスタムシェーダーによる「物理ベース水たまり（Puddle）＆雨滴着水リップル（Rain Ripples）表現」を実装した。

## 技術仕様・アルゴリズム

1. **動的雨滴着水リップル (Procedural Raindrop Ripples)**:
   - 2層の時間位相ずらしグリッド（ハッシュ関数ベースの擬似乱数セル配置）を採用。
   - 各セルに着水した雨滴が時間経過に応じて広がる同心円波紋を `sin(waveDist * 42.0) * exp(-dist * 4.5) * (1.0 - dropAge)` で計算。
   - 解析的勾配ベクトルからリップル法線（Normal Perturbation）を生成し、サーフェス法線とブレンド。

2. **濡れ縁・浸潤帯 (Wet Meniscus Edge)**:
   - 水たまり本体（水面）の外周部に、アスファルトや石畳が雨水を含んで黒ずむ湿潤浸潤帯（Darkening Border）を表現。
   - スムースステップ補間により、乾燥路面から濡れ縁、そして水面鏡面部へと自然に連続するグラデーションを形成。

3. **水面の物理ベース光学特性 (PBR Optics) とワールド座標縞模様の排除**:
   - 水たまり内部ではラフネスを極小値（0.02〜0.04）へ引き下げ、完全鏡面化。
   - 水の物理屈折率（IOR 1.33、垂直反射率 F0 約 0.02）を模したフレネル効果と環境マッピング反射を強化。
   - 都市ビル窓や街灯の反射計算において、`sin(worldPos.z * 0.32)` や `cos(worldPos.z)` のようなワールド座標の周期サイン波を使うと路面上に規則的な横縞・格子模様が出現するため、視線反射ベクトル `R` の方位角（`atan(R.x, R.z)`）および仰角（`R.y`）に基づく方向反射へと改善。
   - 水たまり盆地ハイトフィールド（`samplePuddleBasin`）からも周期三角関数 `sin(worldXZ.x) * cos(worldXZ.y)` を排除し、非共役回転させた2層のマルチオクターブ FBM で自然な水たまり形状を生成。

4. **モジュール化と適用範囲**:
   - `PuddleMaterial` ([`apps/web/src/shaders/puddleShader.ts`](../apps/web/src/shaders/puddleShader.ts)): 汎用路面・広場タイル・デカール用。
   - `JapaneseRoadMaterial` ([`apps/web/src/roads/japaneseRoadMaterial.ts`](../apps/web/src/roads/japaneseRoadMaterial.ts)): 3Dボリュームテクスチャ（Aチャンネル水たまり深度）と雨滴リップル法線を統合した日本の道路規格用マテリアル。

## 検証結果 (Trust Signals)

- **Vitest**: `src/tests/puddleShader.test.ts` において初期パラメータ、雨量・時間ユニフォーム連動、GLSLコード注入を検証しパス（16 tests passed in total）。
- **Pipeline**: `just verify-all`（`check-types`, `lint-code`, `run-tests`, `build-app`）全件パス。

---
title: 物理ベース水たまりシェーダーと動的雨滴リップル法線表現
tags:
  - graphics
trust_signals:
  verified_date: 2026-11-04
  author: antigravity
---

# 物理ベース水たまりシェーダーと動的雨滴リップル法線表現

## 概要

雨天時および雨上がり（`wet` / `puddle`）における渋谷・東京駅エリアの没入感を飛躍的に向上させるため、GLSL カスタムシェーダーによる「物理ベース水たまり（Puddle）＆雨滴着水リップル（Rain Ripples）・解析的平面鏡面反射（Analytical Planar Mirror Reflection）表現」を実装・強化した。

## 技術仕様・アルゴリズム

1. **S字コントラスト展開型 FBM 盆地生成と車線轍（Wheel Ruts）・路肩排水溝プロファイル**:
   - 従来の4オクターブ Perlin FBM は出力値が `0.42〜0.58` の狭い中央帯に集中するため、道路横断勾配（Crown Drainage）を掛け合わせると `basinDepth` が閾値を下回り、水たまりがほとんど出現しない問題があった。
   - これを解決するため、各スケールの FBM 出力に `smoothstep(0.32, 0.68, rawFbm)` による S字コントラスト展開を適用して `0.0〜1.0` のダイナミックレンジを確保。
   - さらに第1車線（`1.25m`, `2.35m`）・第2車線（`4.45m`, `5.65m`）・第3車線（`8.20m`）のタイヤ轍（Wheel Ruts）および路肩側溝（`5.4m〜7.6m`）、交差点内の広域浅水盆地（Intersection Basin）を組み合わせることで、道路全面にリアルな水たまり群を形成。

2. **近景骨材バンプと遠距離（175m）水面法線フラット化の分離**:
   - `JapaneseRoadMaterial` の `#include <normal_fragment_maps>` において、従来は水たまりの水面法線フラット化・波紋摂動がアスファルト骨材バンプの近距離条件（`roadCamDist < 12.0`）のブロック内部にネストされていたため、チェイスカメラ（車両後方 `6.5m`）から見て車両前方 `5.5m` 以遠の水たまりで法線が一切フラット化されない致命的バグがあった。
   - アスファルト微細骨材バンプ（`roadCamDist < 18.0`）と水たまり水面法線フラット化＋リップル摂動（`puddleCoreMask > 0.01 && roadCamDist < 175.0`）を完全に独立させたことで、遠方の水たまりまで水面法線とさざ波が正確に機能するようになった。

3. **動的雨滴着水リップル (Procedural Raindrop Ripples) と 2オクターブ微風毛細管波 (Capillary Waves)**:
   - 3層の時間位相ずらしグリッド（ハッシュ関数ベースの擬似乱数セル配置）による同心円雨滴波紋に加え、2オクターブの微風さざ波（Capillary Waves）を合成。
   - 雨が止んだ直後の湿潤路面（`roadSurface: "wet"` / `"puddle"`）でも、水たまり表面に最低 `0.22〜0.42` の微風リップル強度を維持することで、静止画にならず生きた水面揺らぎを表現。

4. **濡れ縁・浸潤帯 (Wet Meniscus Edge) と解析的平面鏡面反射**:
   - 水たまり外周部に多孔質アスファルトが水分を吸って黒ずむ湿潤浸潤リング（`meniscusRing`）を形成。
   - 水たまり内部ではラフネスを `0.015`、メタリック度を `0.86` まで引き上げ、視線反射ベクトル `R` を天球水平面へ投影した FBM 雲レイヤー（`skyCloudUv`）、太陽・月のハイライト、都市ビル窓のグリッド発光、街灯・信号機のネオンストリークを `185m` 先まで滑らかに距離減衰させながら加算。

5. **モジュール化と適用範囲**:
   - [`PuddleMaterial`](../apps/web/src/shaders/puddleShader.ts): 汎用路面・歩道・広場タイル用（`puddle-planar-mirror-shader-v3`）。
   - [`JapaneseRoadMaterial`](../apps/web/src/roads/japaneseRoadMaterial.ts): 3Dボリュームテクスチャと車線轍・水たまり平面鏡面反射を統合した日本の道路規格用マテリアル（`japanese-road-mat-3d-*-v3`）。

## 検証結果 (Trust Signals)

- **Vitest**: [`apps/web/src/tests/puddleShader.test.ts`](../apps/web/src/tests/puddleShader.test.ts) において初期パラメータ、雨量・時間ユニフォーム連動、S字展開盆地、雲投影・長距離水面法線フラット化 GLSL コード注入を検証しパス。
- **Browser Visual Verification**: Chrome DevTools MCP にて渋谷スクランブル交差点周辺の `sunset` / `day` / `night` / `rain` 各条件で車線轍・交差点・歩道上の水たまり、濡れ縁（メニスカス）、波紋、空・雲・太陽・街灯の鏡面反射が描画されることを視覚確認。
- **Pipeline**: `just format-code` および `just verify-all`（`check-types`, `lint-code`, `run-tests`, `build-app`）全件パス。

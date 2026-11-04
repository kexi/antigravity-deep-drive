---
title: 行幸通りイチョウ街路樹のBlender CLIモデリングと物理ベース葉っぱシェーダー・木シェーダー
tags:
  - graphics
  - architecture
trust_signals:
  verified_date: 2026-11-01
  author: antigravity
  environment: Blender 5.2.2 LTS CLI, Three.js r182 (WebGL2), Vitest, Chromium Playwright
---

# 行幸通りイチョウ街路樹のBlender CLIモデリングと物理ベース葉っぱシェーダー・木シェーダー

## 1. 背景と設計目的

従来の街路樹表現は単一の `CylinderGeometry`（幹）と `ConeGeometry`（円錐の葉）で構成されており、東京駅丸の内・行幸通りの象徴であるイチョウ並木（Ginkgo Biloba）としての有機的なシルエットや、逆光時の黄金葉の透け感（Subsurface Scattering）、風に揺れる枝葉のダイナミズムが不足していた。

これを解決するため、以下の 3 要素を一貫したパイプラインで実装した:

1. **Blender CLI プロシージャル街路樹モデリング (`blender/scripts/generate_street_tree.py` -> `apps/web/public/models/street_tree.glb`)**
2. **物理ベース イチョウ葉っぱシェーダー (`GinkgoFoliageMaterial` in `apps/web/src/shaders/treeShader.ts`)**
3. **物理ベース イチョウ樹皮・木シェーダー (`TreeBarkMaterial` in `apps/web/src/shaders/treeShader.ts`)**

## 2. Blender CLI によるイチョウ街路樹モデリング (`generate_street_tree.py`)

球体ブロブ（`IcosahedronGeometry` や球体コア）は近景や見上げアングルで「ツルツルした黄色い風船の塊」に見え、1枚1枚の葉っぱの形状が判別できない問題があった。そのため球体塊を完全に廃止し、`bmesh` を用いて100%実体3Dイチョウ扇形葉ロゼットと多段枝骨格からなる `street_tree.glb`（約 1.71 MB）を自動生成する:

- **`Tree_Trunk`**:
  - 地際の根張り（5 方向の板根フレア）から高さ 7.1m まで有機的なうねりと縦溝凹凸を伴いながらテーパーする主幹。
  - 黄金角（$137.508^\circ$）螺旋配置で分岐する 10 本の主枝（Primary Branches）、20 本の副枝（Secondary Sub-branches）、および樹冠内部まで伸びる 90 本の小枝（Tertiary Twigs）。
- **`Tree_Foliage`**:
  - **実体 3D イチョウ扇形葉 (`add_ginkgo_fan_leaf_3d`)**: 1枚あたり 18 頂点・12 クアッド面で構成。細い葉柄（Petiole: 2頂点）→ 楔形基部（Cuneate transition: 2頂点）→ 中間扇アーク（7頂点）→ 左右2裂片と中央の深い二股切れ込み（Biloba notch: `u=0.5, r=0.65` を含む外縁7頂点）を1対1の放射状クアッドで結び、自然な反り（キャンバー）と波打ちを持つ。
  - **短枝輪生ロゼット (`add_ginkgo_spur_rosette`)**: イチョウ特有の短枝（Spur shoot）から5〜8枚の葉が放射状に束生するロゼット構造を再現。内層・外層・樹冠表層および全 90 本の小枝先端（`twig_tip_rosettes`）に直接ロゼットを着生させ、計約 2,200 枚（39,384 頂点 / 26,256 面）のイチョウ葉で360度どこから見ても葉っぱ1枚1枚のシルエットが明瞭に分かる樹冠を構成。
  - Three.js 側のフォールバック樹冠（`createGinkgoBilobaCanopyGeometry`）も同様に球体を廃し、18頂点×186枚の実体3Dイチョウ扇形葉ロゼットメッシュを生成。
- **`Tree_Guard`**:
  - 行幸通りの歩道に埋設された白御影石縁石ブロック（`GraniteCurb`）と鋳鉄製スリット格子（`TreeGuardIron`）。

## 3. 葉っぱシェーダー (`GinkgoFoliageMaterial`) と木シェーダー (`TreeBarkMaterial`)

### 葉っぱシェーダー (`GinkgoFoliageMaterial`)

- **3 段階の階層型風揺れ頂点変位**:
  1. 主幹・主枝の大域スウェイ（`TreeBarkMaterial` と同一の数式・位相で完全同期し、幹と葉の乖離を防止）
  2. 枝先の中周波ガスト揺れ
  3. 葉柄（`vFoliageUv.y = 0`）を支点として葉先（`vFoliageUv.y = 1`）ほど大きくはためく `bladeTipWeight` 付きイチョウ扇形葉フラッター
- **正規化イチョウ葉 UV 直結の平行二叉脈・葉脈バンプ (`sampleGinkgoVenation`)**:
  - 各葉の正規化 UV（`u`: 扇の左右端 `0..1`、`v`: 葉柄 `0` → 二股外縁 `1`）に直結した 28 本＋56 本の二又平行葉脈（Dichotomous parallel venation）、中央二股切れ込み（`bilobaNotch`）の陰影、葉縁のリムハイライト、葉柄の黄緑木質シェード、および葉1枚ごとの黄金〜琥珀色調差（`leafIdHash`）とビュー空間法線バンプ（`leafVeinBump`）を計算。
- **逆光サブサーフェス・スキャタリング (Translucent Backlight SSS)**:
  - 太陽方向 `uSunDirection` と視線ベクトル `foliageViewDir` の前方散乱ローブ（$\cos^{3.2} + \cos^{12}$）とリム透過を計算し、`#include <metalnessmap_fragment>` 直後で `totalEmissiveRadiance` に加算。
- **雨天水膜グロス＆夜間街灯ウォームアップライト**:
  - `uRainWetness` に応じてラフネスを `0.14` まで下げて濡れツヤを表現し、夜間（`uNightFactor`）は樹冠下部に街灯の暖色照り返しを付与。

### 木シェーダー (`TreeBarkMaterial`)

- **異方性縦溝樹皮ノイズ＆法線バンプ (`sampleBarkFurrows`)**:
  - 円筒座標 $(\theta, y)$ 上のドメインワーピング FBM でイチョウの縦溝樹皮を生成し、`mat3(viewMatrix)` でビュー空間法線 `normal` を摂動。
- **根張り部の湿潤コケ (`mossMask`) と雨水吸収**:
  - 地際（$y < 1.35\,\text{m}$）にコケの緑色ブレンドと地面 AO を適用し、雨天時は樹皮の吸水暗色化と縦溝を伝う水筋のスペキュラ光沢を表現。

## 4. 検証結果 (Trust Signals)

- `just generate-tree`: Blender 5.2.2 LTS CLI によりエラー・警告ゼロで `apps/web/public/models/street_tree.glb` (1,715,096 bytes, `Tree_Foliage`: 39,384頂点 / 26,256面) を生成。
- Blender EEVEE 360度・近景・見上げレンダリング検証: 全景・樹冠クローズアップ・樹冠下からの見上げアングルのすべてにおいて、球体塊が一切存在せず、イチョウ特有の扇形葉身・二股切れ込み・葉柄・短枝ロゼット束が明瞭に視認できることを確認。
- `just verify-all`: `treeShader.test.ts` を含む全テストファイルがパスし、型検査・Lint・本番ビルド・tsdown Minify・OKF ナレッジ検証が正常完了。

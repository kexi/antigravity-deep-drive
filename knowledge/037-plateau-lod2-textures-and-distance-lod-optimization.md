---
title: PLATEAU LOD2 写真実写テクスチャ適用と距離ベース多段階LOD（Level of Detail）による遠景軽量化
tags:
  - architecture
  - graphics
  - open-data
  - roads
trust_signals:
  verified_date: 2026-11-08
  author: antigravity
---

# PLATEAU LOD2 写真実写テクスチャ適用と距離ベース多段階LOD（Level of Detail）による遠景軽量化

## 1. 背景と課題

ユーザーからの「遠方は軽量モデルにしたいので」という追加要件を受け、以下の設計課題を解決した：

1. **近景・中景における PLATEAU LOD2 級写真ベース質感**:
   - 従来の一様プロシージャル単色マテリアルから脱却し、街路樹の緑や路面の照り返し・オフィスのブラインド・カーテンウォール・1F店舗ファサードを写真ベースで忠実に表現する LOD2 級の質感を近景・中景に付与する。
2. **遠景における描画負荷とメモリ・シャドウパスの抑制**:
   - 渋谷エリアの実測 PLATEAU メッシュ（約1,700棟・43,000面）が単一の巨大メッシュとして統合されていたため、自車が遠方にいても全頂点がシャドウマップ生成および重いフラグメントシェーダーで描画され、GPU 負荷とメモリ帯域を圧迫していた。
3. **距離ベースの多段階自動遷移（LOD0 / LOD1 / LOD2 / Culled）**:
   - 自車・カメラからの距離に応じて、近景（LOD0: 高精細・LOD2写真テクスチャ・影描画有効）→ 中景（LOD1: 簡易テクスチャ・影カリング）→ 遠景（LOD2: 低ポリゴン軽量プロキシ・単一軽量マテリアル・影カリング・3Dノイズ演算バイパス）→ 限界距離超（Culled: 完全非表示）への自動かつシームレスな遷移を確立する。

---

## 2. 設計とアーキテクチャ

### 2.1 PLATEAU LOD2 写真ベーステクスチャの生成・マッピング

- **実写ファサードテクスチャ (`plateau_lod2_facade.jpg`)**:
  - 解像度 1024x1024。
  - 下層部（Y: 1.5m〜15m）には沿道の街路樹（ケヤキ・イチョウ）の緑色の環境反射をブレンド。
  - 最下層（Y: 0m〜3.2m）にはアスファルト路面と歩道タイルの温かみのある照り返し（Ground Bounce Light）を反映。
  - 中・高層部にはアルミサッシ、熱線反射ガラス、オフィス室内ブラインドの凹凸明暗を精密に配置。
- **テクスチャ Mipmap とサンプリング設定**:
  - `ShibuyaTextureManager` において全テクスチャで `generateMipmaps = true`、`minFilter = THREE.LinearMipmapLinearFilter`、`magFilter = THREE.LinearFilter` を有効化し、斜めアングルや遠距離サンプリングでのモアレ（エイリアシングノイズ）を根絶。
- **UV 座標の自動生成 (`generate_shibuya_plateau.py`)**:
  - bmesh 処理時に各建物の垂直壁面（`wall_u / 12.0`, `wall_v / 12.0`）および水平屋根面（`co.x / 14.0`, `-co.y / 14.0`）に UV レイヤーを自動付与。

### 2.2 メッシュの 8 タイル分割と AABB 距離判定

- **従来の単一メッシュ統合を廃止**:
  - 渋谷区実測 PLATEAU データを 8 タイル（宮益坂 `data142`、駅東口 `data143`、センター街 `data147`、青山通り `data150`、駅コア `data151`、明治通り南・並木橋 `data153`、道玄坂 `data155`、桜丘町 `data157`）の個別メッシュとして Blender からエクスポート。
- **Three.js `Box3` AABB 最短表面距離の算定**:
  - 各タイルの `cullingBounds`（AABB）を算定・キャッシュし、自車位置からの最短距離 `tileBounds.distanceToPoint(focusPosition)` を算出。
  - メッシュの広がり（幅数十〜数百メートル）がある場合でも、中心距離ではなくバウンディングボックスの最近接面までの距離を正確に判定。

### 2.3 距離ベースの多段階 LOD 遷移テーブル

| ティア | 距離範囲 | ジオメトリ / 表現 | マテリアル | シャドウ (`castShadow`) | ドローコール / 演算負荷 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LOD0 (High)** | `<= 135m` | 高精細 PLATEAU 実在建物ジオメトリ（全43,000面） | LOD2 写真テクスチャ＋街路樹緑色反射・路面照り返しブレンド＋3Dボリュームノイズ（4種マルチマテリアル） | **有効 (True)** | フル品質レンダリング |
| **LOD1 (Medium)** | `135m < dist <= 235m` | 詳細ジオメトリ保持 | 簡易テクスチャ＋Mipmap 最適化（3Dノイズ演算スキップ） | **無効 (False)** | シャドウパス完全除外、描画負荷 50% 削減 |
| **LOD2 (Low)** | `235m < dist <= 800m` | **低ポリゴン軽量プロキシメッシュ（80% Decimate、約7,800面へ激減）** | **単一軽量プロキシマテリアル（1ドローコール、Mipmap対応）** | **無効 (False)** | **頂点数81.7%削減、ドローコール75%削減（27→8）、単一PBR** |
| **Culled** | `> 800m` またはチャンク未ロード | 完全非表示 (`visible = false`) | - | **無効 (False)** | **ドローコール 0** |

### 2.4 Blender によるデュアルメッシュ生成と Three.js 動的プロキシ切り替え

1. **Blender プロシージャル生成 (`generate_shibuya_plateau.py`)**:
   - 各タイルごとに詳細メッシュ `PlateauTile_{tile_name}`（4マテリアル・UV付き）と、Decimate モディファイア（`ratio = 0.20`、80%ポリゴン削減）を適用した軽量プロキシメッシュ `PlateauProxyTile_{tile_name}`（単一 `PlateauLod2Proxy` マテリアル）をペアとして GLB に出力。
2. **Three.js ランタイム動的スワップ (`tokyoStationMap.ts`)**:
   - GLB 読込時に各タイルの詳細メッシュに `userData.proxyGeometry` / `userData.proxyMaterial` をペアリング（GLB 外のモックでも `ensurePlateauTileProxy` が外形プロキシを自動補完）。
   - `updateDistanceCulling` において、距離が 235m を超えると `tileMesh.geometry = proxyGeometry` および `tileMesh.material = proxyMaterial` に切り替わり、GPU へ転送される頂点数・ドローコール・シェーダー負荷を劇的に抑制。自車が接近するとシームレスに `detailedGeometry` / `detailedMaterial` へ復帰。

### 2.5 シェーダーレベルでの遠距離演算バイパス (`tokyoStationMap.ts`)

- `applyArchitecture3DTexture` シェーダーにおいて、カメラからの距離 `archViewDist` に応じてシェーダー分岐を導入：
  - `archViewDist < 135.0`: 街路樹緑色反射 (`treeFoliageReflection`) および路面照り返し (`groundWarmReflection`) を壁面にフルブレンド。
  - `archViewDist >= 180.0`: 高コストな 3D ボリュームノイズ（パーリンノイズ）演算を完全スキップし、テクスチャ Mipmap サンプリングのみで高速シェーディング。
  - `archViewDist > 235.0`: 複雑な窓枠・目地計算を完全スキップし軽量カラーへバイパス。

---

## 3. 検証結果と Trust Signals

- **テスト検証 (`vitest`)**:
  - `openWorldStreaming.test.ts`:
    - スクランブル交差点視点（道玄坂タイル: LOD0 詳細 / 宮益坂タイル: LOD1 / 並木橋タイル: LOD2 低ポリゴンプロキシ）の自動分類およびジオメトリ・マテリアル・シャドウの切り替えを検証。
    - 宮益坂上への移動に伴う動的 LOD 昇格（宮益坂: LOD0 高精細復帰）と降格（道玄坂: LOD1）を検証。
    - 遠方エリア（距離 > 800m）への移動に伴う全タイルの Culled（完全非表示・ドローコールゼロ）を検証。
    - GLB 読込時の全8タイルと低ポリゴンプロキシメッシュのペアリングを検証。
  - `buildingTexture.test.ts`:
    - 全13種類のファサードテクスチャ（`plateauLod2Facade` を含む）および Mipmap 設定・昼夜連動を検証。
    - `PlateauLod2Proxy` マテリアルによる 3D ボリュームノイズバイパス・単一テクスチャ描画を検証。
  - 全24テストスイート・196テストの全件パスを確認。
- **全パイプライン検証 (`just verify-all`)**:
  - `actionlint`, `pinact run --check`, `tsc --noEmit`, `oxlint`, `oxfmt`, `ruff check`, `ruff format`, `vite build`, `minify` がノーエラー・ノーワーニングで完了。

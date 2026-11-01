---
title: 東京都 Project PLATEAU (千代田区 13101) & 国土地理院 (GSI DEM5A / 道路中心線) オープンデータ統合
tags:
  - open-data
  - roads
  - architecture
trust_signals:
  verified_by:
    - "just fetch-open-data による PLATEAU b3dm バイナリ & 国土地理院タイル (15/29105/12903, 16/58211/25806) 取得・変換検証"
    - "pnpm --filter web test (openData.test.ts 含む全12テストスイート 51テスト PASS)"
    - "Playwright ブラウザ実機描画・GISテレメトリHUDリアルタイム表示確認"
  verified_at: "2026-11-01"
  confidence: high
---

# 東京都 Project PLATEAU (千代田区 13101) & 国土地理院 (GSI DEM5A / 道路中心線) オープンデータ統合

## 背景と目的

東京駅丸の内〜行幸通り〜皇居外苑3Dドライブシミュレーターにおいて、抽象化されたビル配置・標高・道路属性を、**東京都デジタルツイン実現プロジェクト / 国土交通省 Project PLATEAU（千代田区 `13101`・2025年度版 Spec 5.0）** および **国土地理院（GSI: 地理院タイル DEM5A 5mメッシュ数値標高モデル・ベクトルタイル道路中心線 `experimental_rdcl`）** の実測オープンデータで駆動するアーキテクチャへ刷新した。

## データソースと取得・変換パイプライン (`just fetch-open-data`)

[`apps/web/scripts/fetch-open-data.ts`](../apps/web/scripts/fetch-open-data.ts) により、以下の公的オープンデータエンドポイントから直接バイナリ・GeoJSON・CSVタイルを取得し、JGD2011 からローカル3D空間座標へ投影したデータバンドル（[`apps/web/public/data/tokyo_marunouchi_open_data.json`](../apps/web/public/data/tokyo_marunouchi_open_data.json) および [`apps/web/src/openData/tokyoMarunouchiOpenData.ts`](../apps/web/src/openData/tokyoMarunouchiOpenData.ts)）を生成する。

1. **東京都 / 国土交通省 Project PLATEAU 千代田区 (`13101`) 2025年度 3D都市モデル**:
   - エンドポイント: `https://assets.cms.plateau.reearth.io/assets/94/66f699-4d4f-47c7-a622-0f1eef9ec2fc/13101_chiyoda-ku_pref_2023_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod1/data/data11.b3dm`
   - 構造解析の知見: `b3dm` ヘッダ（28バイト）に続く FeatureTable JSON / Binary の後ろに格納された **BatchTable JSON + BatchTable Binary** から、`buildingId`, `gml_id`, `名称`, `用途`, `建物の高さ` (`measuredHeight`), `地上階数`, `地下階数` と、リトルエンディアン Float64 バイナリ配列 (`_x`, `_y`, `_xmin`, `_xmax`, `_ymin`, `_ymax`, `_zmin`, `_zmax`) をデコードし、丸の内・大手町エリアの実在18棟を抽出した。
2. **国土地理院 地理院タイル DEM5A（航空レーザ測量 5mメッシュ数値標高モデル）**:
   - タイルID: `https://cyberjapandata.gsi.go.jp/xyz/dem5a/15/29105/12903.txt` (`256×256` CSV標高マトリクス)
   - 東京駅丸の内駅前広場 (`TP +3.00m`)、行幸通り中央 (`TP +3.59m`)、和田倉門交差点 (`TP +3.28m`)、和田倉濠水面 (`TP +1.56m`)、日比谷濠水面 (`TP +2.04m`) を 20m ステップ（21×25 グリッド）でサンプリング。
3. **国土地理院 ベクトルタイル提供実験 道路中心線 (`experimental_rdcl`)**:
   - タイルID: `https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/16/58211/25806.geojson`
   - 丸の内・皇居外苑エリアの 55 区間の道路中心線セグメント（`rID`, `rdCtg`, `rnkWidth`, 路線名：行幸通り `都道404号`・日比谷通り `国道1号/都道403号`・永代通り `国道1号`・丸の内仲通り `千代田区道110号`）を抽出。

## JGD2011 ⇔ 東京駅丸の内ローカル3D座標変換系

[`apps/web/src/openData/gsiPlateauLoader.ts`](../apps/web/src/openData/gsiPlateauLoader.ts) において、以下の直交回転投影を定義した。

- **原点 `(x = 0, z = 0)`**: 東京駅丸の内駅前広場・行幸通り起点 (`35.68158°N, 139.76525°E`, 基準標高 `TP +3.00m`)
- **`+z` 軸**: 行幸通りを東京駅から皇居（和田倉門交差点）へ進む方向（方位角 `284.9°` WNW、東から反時計回り `165.1°`）
- **`-x` 軸**: 行幸通りに向かって右側・北北東（新丸の内ビルディング `13101-bldg-3114` `199.9m`、東京海上日動ビル `13101-bldg-604` `114.2m`、丸の内オアゾ `13101-bldg-4002` `166.8m`、和田倉濠）
- **`+x` 軸**: 行幸通りに向かって左側・南南西（丸の内ビルディング `13101-bldg-1194` `180.1m`、郵船ビル `13101-bldg-4149` `69.3m`、JPタワー KITTE `13101-bldg-2287` `205.2m`、日比谷濠）

## 視覚的微地形と物理コライダーの整合性

`knowledge/002-japanese-road-system.md` の「視覚的凸凹と物理的平坦化」原則を維持するため、`getRelativeTerrainDisplacement(x, z)` では行幸通り・丸の内中央通り・日比谷通りの走行コリドー上の地形変位を `0m` に固定し、道路外周および皇居内濠の水面深さ（`relativeWaterY`）に国土地理院 DEM5A の実測標高差を反映している。

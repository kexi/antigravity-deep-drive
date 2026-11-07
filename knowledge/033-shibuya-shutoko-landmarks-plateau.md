---
title: 渋谷区 Project PLATEAU (13113) 都市データ拡充と首都高速3号渋谷線高架・スクランブルスクエア・ヒカリエ 3D 再現
tags:
  - open-data
  - graphics
  - roads
  - architecture
trust_signals:
  verified_date: 2026-11-07
  author: antigravity
---

# 渋谷区 Project PLATEAU (13113) 都市データ拡充と首都高速3号渋谷線高架・スクランブルスクエア・ヒカリエ 3D 再現

## 1. 背景と課題

渋谷エリアを走行した際、「PLATEAU を使っているのに本物の渋谷に見えない」という視覚的・構造的ギャップが存在していた。主な要因は以下の3点である。

1. **渋谷特有の「重層インフラ構造（立体都市）」の欠如**:
   実際の渋谷駅前（明治通り・国道246号交差点周辺）は、頭上を東西に貫く巨大な**首都高速3号渋谷線高架橋**（鋼箱桁・RC門型ラーメン橋脚・遮音壁・首都高緑色案内標識・高架下ナトリウム照明）、**渋谷駅東口歩道橋（ペデストリアンデッキ網）**、**東京メトロ銀座線高架アーチ屋根**、**JR山手線・埼京線高架橋**が幾重にも重なる立体空間である。従来のマップは平面道路と直方体ビルの配置にとどまり、渋谷らしい頭上の圧迫感と立体的な奥行きが欠けていた。
2. **渋谷主要ランドマークの建築的特徴（シルエット・固有造形）の不足**:
   `SHIBUYA_PLATEAU_BUILDINGS` が駅直近の10棟のみであり、さらに各ビルが汎用ガラスボックスとして描画されていたため、**渋谷スクランブルスクエア 東棟**（屋上展望施設 `SHIBUYA SKY`・ヘリポート・斜め/垂直ルーバーカーテンウォール）や**渋谷ヒカリエ**（中層11Fスカイロビーと空中に浮かぶ球体劇場 `東急シアターオーブ`）、**MIYASHITA PARK**（屋上芝生公園とアーチ架構）、**QFRONT・109**（大型ビジョン）の識別性が低かった。
3. **カーナビ地図上の高速高架・鉄道高架およびランドマーク表記の不足**:
   車内 JDM カーナビ画面において首都高3号渋谷線や主要ランドマークが表示されていなかった。

---

## 2. 設計と実装アーキテクチャ

### 2.1 東京都 Project PLATEAU 渋谷区 (`13113`) 都市データと `fetch-open-data.ts` 実データ連携

`apps/web/scripts/fetch-open-data.ts` および `apps/web/src/openData/gsiPlateauLoader.ts` を拡張し、千代田区（`13101`）に加えて**渋谷区（`13113_shibuya-ku`）の Project PLATEAU 2025年度 Spec 5.0 3D Tiles (`b3dm`) 実測属性（17棟）**、**国土地理院 基盤地図情報 数値標高モデル 5mメッシュ（DEM5A タイル `15/29100/12906`、27×23 グリッド：渋谷川谷底 `14.6m` 〜 道玄坂・宮益坂・青山台地 `34.8m`）**、および**渋谷エリア道路中心線（`experimental_rdcl` タイル `16/58200/25812` 由来の実測セグメントを含む13路線・計69路線）**をオープンデータ JSON（`apps/web/public/data/tokyo_marunouchi_open_data.json`）および TypeScript 定数モジュール（`apps/web/src/openData/tokyoMarunouchiOpenData.ts`）に統合した。

- **渋谷区 PLATEAU 建築物属性 (`shibuyaPlateauBuildings` 17棟)**:
  - PLATEAU 配信サーバー（`13113_shibuya-ku` LOD1 `b3dm` タイル `data142` / `data143` / `data150` / `data151` / `data153` / `data155` / `data157`）のバッチテーブルから実測 CityGML `gml_id` を取得・照合し、`13113-bldg-shibuya-stream`（`bldg_1db9c375-4ff6-4e3a-8c05-3a5c37e4580d`、渋谷ストリーム `179.95m`）、`13113-bldg-scramble-square`（`bldg_7b006717-e9e6-4a94-8843-1f4ce13b2509`、渋谷スクランブルスクエア東棟 `229.7m`）、`13113-bldg-shibuya-hikarie`（`bldg_9ad5b600-360f-4627-8a89-fca39aad5576`、渋谷ヒカリエ `182.5m`）、`13113-bldg-sakura-stage`（`bldg_9442d303-7a48-4f81-aa67-b6ef05dbd43b`、渋谷サクラステージ `179.9m`）、`13113-bldg-shibuya-fukuras`（`bldg_3ad6aaeb-26f8-4716-a8ec-cb2504b94674`、渋谷フクラス `103.3m`）、`13113-bldg-miyashita-park`（`bldg_23c5f3e3-b4bf-4b7a-bd39-2fedd8244558`、MIYASHITA PARK `71.8m`）、`13113-bldg-qfront-109`（`bldg_5f7ff4f3-a620-4fd0-a380-3ec46435cd27`、QFRONT・SHIBUYA109 `78.5m`）、`13113-bldg-cerulean-tower`（`bldg_9c42ff7c-c8bf-456a-ada2-4c416a2dc965`、セルリアンタワー `184.0m`）等を収録。
  - 全棟のフットプリントが明治通り（`x ∈ [-764, -736]`）・国道246号（`z ∈ [83, 107]`）・街中周回ストリートを一切塞がないよう実測座標系に配置。
- **双方向座標変換 (`wgs84ToLocal` / `localToWgs84`) と標高補間 (`sampleGsiDemElevation`)**:
  - `wgs84ToLocal(lat, lon)` と `localToWgs84(x, z)` の双方で渋谷ゾーン（`lon < 139.725` / `x < -550`、アンカー：渋谷ストリーム `35.65722°N, 139.70319°E` ⇄ `(-695, -15)`）の可逆変換を実装。
  - `sampleGsiDemElevation(x, z)` で `shibuyaDem5a` 領域（`x ∈ [-920, -480], z ∈ [-240, 280]`）の双一次補間に対応し、`findNearestPlateauBuilding` / `findNearestGsiRoad` / `getShibuyaPlateauBuildingsForMap` が JSON 側の `shibuyaPlateauBuildings` / `shibuyaGsiRoadSegments` をシームレスに参照するよう統合。

### 2.2 Blender 3D モデリング（東西北8大ランドマーク統合）と 360度16アングル収束レビュー

`blender/scripts/generate_shibuya_stream.py` を拡張し、明治通り東側だけでなく西側（サクラステージ・フクラス）および北側（MIYASHITA PARK・QFRONT・SHIBUYA109）も含めた渋谷駅周辺8大ランドマーク群を `apps/web/public/models/shibuya_stream.glb` に一体モデリングした（`AGENTS.md` 1節準拠）。

- **座標系変換**:
  `shibuya_stream.glb` は `position = (-695, 0, -15)`, `rotation.y = -Math.PI / 2` で配置されるため、Blender 座標 `(bx, by, bz)` と Three.js ワールド座標 `(wx, wy, wz)` は以下の1対1対応となる：
  - `wx = -695 + by`
  - `wy = bz`
  - `wz = -15 + bx`
- **収録サブパート (`assets.yml` 定義)**:
  - `ShutokoRoute3_Viaduct`: 国道246号頭上（`bx = 110m` → `wz = 95m`, 桁下クリアランス `13.5m`）を東西に横断する首都高3号渋谷線高架橋。鋼箱桁・RC床版・門型ラーメン橋脚（車道外の歩道帯のみに着地）・半透明遮音壁・首都高緑色案内標識（`[3] 渋谷 Shibuya / 大橋JCT・東名方面`）を造形。
  - `ShibuyaScrambleSquare_Tower`: 渋谷スクランブルスクエア 東棟。多段セットバック・斜めルーバーフィン・屋上展望デッキ `SHIBUYA SKY`（`SKY EDGE` ガラス回廊・屋上ヘリポート `H` マーク）を造形。
  - `ShibuyaHikarie_Tower`: 渋谷ヒカリエ。高層4層の分節ガラスボリューム・中層11Fスカイロビー開口・低層ガラスカーテンウォールから張り出す黄金色の球体劇場 **東急シアターオーブ (`Tokyu Theatre Orb`)** を造形。
  - `ShibuyaEastPedestrianDeck`: 明治通り・国道246号頭上（クリアランス `7.8m`）を結ぶ渋谷駅東口歩道橋（ペデストリアンデッキ）、JR山手線・埼京線高架橋（E235系グリーンのラインカラー車両表現付き）、東京メトロ銀座線高架アーチ屋根。
  - `ShibuyaSakuraStage_Tower`: 明治通り西側（`wx = -812, wz = -25`）の渋谷サクラステージ。段状緑化テラス基壇、桜ピンク発光フレームの `KINETIC GATE` アトリウム、明治通り上空横断デッキ、高層ガラスカーテンウォールを造形。
  - `ShibuyaFukuras_Tower`: 明治通り西側・国道246号南西角（`wx = -815, wz = 46`）の渋谷フクラス（東急プラザ渋谷）。特徴的な折り紙プリーツルーバー基壇、1Fバスターミナルピロティ、17F屋上庭園 `SHIBU NIWA`、中層セットバック、高層GMOタワーを造形。
  - `ShibuyaMiyashitaPark_Complex`: 明治通り北東側（`wx = -695, wz = 248`）の MIYASHITA PARK（Rayard / sequence）。1F「渋谷横丁」の暖色提灯・ネオンアーケード、2F〜3F商業デッキ、屋上芝生公園と10連ボタニカル・パラボラアーチ鉄骨フレーム、北端のホテル `sequence MIYASHITA PARK` タワーを造形。
  - `ShibuyaQfront109_Complex`: スクランブル交差点北西（`wx = -815, wz = 248`）の QFRONT および道玄坂二股の象徴 **SHIBUYA109 シリンダータワー**。QFRONT の曲面大型LEDビジョンと、その背後にそびえるアルミパネル円筒タワーおよびスクランブル交差点・明治通り側（南東向き法線 `(-0.54, 0.84, 0)`）へ正対した白アルミバッキングプレート付き立体マゼンタピンク **`109` ロゴ造形**を再現。
- **360度16アングル収束レビュー**:
  全16アングル（全方位8方向・俯瞰・明治通りアイレベル・首都高246高架下・スクランブルスクエア&ヒカリエ接写・サクラステージ&フクラス・MIYASHITA PARK&QFRONT/109・QFRONT&109接写・MIYASHITA PARKアーチ接写）をレンダリング。SHIBUYA109 シリンダー冠頭の法線方向と数字 `1` / `0` / `9`（右縦ステム＋ボトムフック）のジオメトリを補正し、スクランブル交差点・明治通りから見て左から右へ鮮明に `109` と読める状態へ収束させた。

### 2.3 Three.js プロシージャル排他制御・3D テクスチャ・`/boost` シェーダー事前プリビルドの堅牢化

- **GLB とプロシージャルメッシュの完全排他制御 (`setShibuyaGlbOverlappingProceduralVisible`)**:
  - `shibuya_stream.glb` が近距離 LOD0 でアクティブな間は、東側（スクランブルスクエア・ヒカリエ・首都高渋谷コア区間・東口歩道橋）に加え、西側・北側（サクラステージ・フクラス・MIYASHITA PARK・QFRONT/109）のプロシージャル `BoxGeometry`/`CylinderGeometry` グループにも `visible = false` および `userData.permanentlyHiddenByGlb = true` を設定。これにより道路の左右・北側すべてが Blender 精密メッシュで描画され、Z-fighting と二重描画が根絶された。
- **3D ボリュームテクスチャ適用 (`applyShibuyaStreamGlbMaterial3DTexture`)**:
  - `ShutokoHighwayGreenSign`, `ShibuyaSkyEdgeGlow`, `HikarieGoldOrb`, `ShutokoConcretePier`, `SakuraStagePinkGlow`, `ShibuyaQfront109Accent`, `StreamWhitePanel`, `StreamCurtainGlass`, `StreamDarkVoidSteel`, `StreamGalvanizedFrame`, `StreamVerticalGreen`, `StreamYellowAccent`, `WarmPlazaGlow`, `BeaconRed` の全14種 GLB マテリアルに `Data3DTexture` による微細凹凸と昼夜連動のエミッシブ特性を付与。
- **`/boost` 時の `compileAsync` タイムアウトフォールバック (`shaderPrebuilder.ts`)**:
  - バックグラウンドタブやヘッドレス Chrome（`--virtual-time-budget` 使用時など）で WebGL 2 の `KHR_parallel_shader_compile` ポーリング完了通知が遅延した際、`renderer.compileAsync` が無限待機して `/boost` オーバーレイで停止する問題を防ぐため、`4000ms` のタイムアウト付き `Promise.race` で同期 `renderer.compile(targetScene, camera)` へフォールバックする安全策を実装。また `#title-screen-overlay.is-hidden` に `display: none` を追加し、タイトル画面解除時の残像を排除した。

---

## 3. 検証結果（Trust Signals）

- **Blender 360度16アングル検証**: `uv run --script blender/scripts/generate_shibuya_stream.py --render-review /tmp/shibuya_review_r6` にて全16アングルを視覚検査し、指摘事項ゼロへの収束を確認。
- **実機 WebGL 2 ブラウザ視覚検証 (`/boost`)**:
  - 開発サーバー上で `/boost` ルートを Chrome WebGL 2（ANGLE Metal バックエンド）で開き、チェイス視点・ドライバー視点（右ハンドル車内ナビ表示込み）× 昼・夕暮れ・夜間・雨天の全13シーンのスクリーンショットを撮影・視覚確認。明治通り左右のサクラステージ・渋谷ストリーム・フクラス・スクランブルスクエア・ヒカリエ、頭上の東口歩道橋・JR高架・首都高3号渋谷線高架橋、北側の MIYASHITA PARK・QFRONT・SHIBUYA109（`109` ロゴ）が Z-fighting やコンソールエラーゼロで重層的に描画されることを確認。
- **単体テスト (`vitest`)**:
  - `apps/web/src/tests/openData.test.ts`: 渋谷区 PLATEAU 17棟（実測 CityGML `gmlId` 検証含む）・渋谷区 `wgs84ToLocal` 往復変換・渋谷区 DEM5A 標高補間・明治通り車道非侵入・首都高3号渋谷線 GSI 道路検索を検証。
  - `apps/web/src/tests/openWorldStreaming.test.ts`: 東西北すべてのプロシージャルメッシュ生成、GLB ロード時の重複プロシージャルメッシュ非表示化（サクラステージ・フクラス・MIYASHITA PARK・QFRONT/109 含む）、宮下公園北側（`z = 240`）走行時の GLB 維持、および全ランドマーク GLB マテリアル変換を検証。
- **統合検証 (`just format-code` & `just verify-all`)**: フォーマット、型検査 (`tsc --noEmit`)、Linter (`oxlint`)、全24テストファイル（189テスト）、本番ビルド (`vite build`) のすべてがエラーなしで通過することを確認。

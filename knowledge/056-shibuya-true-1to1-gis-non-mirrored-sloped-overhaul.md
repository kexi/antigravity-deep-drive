---
title: 渋谷エリア非鏡像 1:1 GIS 座標系・DEM5A 谷地形・構造物リアル化オーバーホール
tags:
  - architecture
  - graphics
  - open-data
  - physics
  - roads
trust_signals:
  verified_date: 2026-11-24
  author: antigravity
  reviewed_by: Blender 360度レンダリング確認 + just format-code + just verify-all (25 test files / 220 tests) + just build-pages + localhost:4173 渋谷15地点ライブブラウザ目視（昼・夜）
---

# 056: 渋谷エリア非鏡像 1:1 GIS 座標系・DEM5A 谷地形・構造物リアル化オーバーホール

## 1. 背景と課題

これまでの渋谷マップは座標系の一部に南北・東西の鏡像（ミラーリング）や局所的な平坦化、不自然な高彩度マテリアル、道路接続・標識配置・テスト期待値間のズレが残っていた。実写（Google Street View / PLATEAU / GSI DEM5A）に忠実な「本物の渋谷の谷地形と放射状道路網」を右ハンドル日本仕様で違和感なく走行・視認できる状態へ引き上げるため、P0〜P1 の全面刷新を実施した。

---

## 2. 設計と実装概要

1. **非鏡像 1:1 WGS84 / PLATEAU / GSI 座標投影への統一**:
   - `+X = East`, `-Z = North` の正しい右手系方位に統一し、渋谷ストリーム基準アンカーを `(-750.0, 527.6)`、東京駅・丸の内エリア（`x >= -395`, `y = 0`）を完全温存する境界設計とした。
   - スクランブル交差点 `(-990.7, 275.8)`、SHIBUYA 109 前 Y 字分岐 `(-1159.4, 272.4)`、セルリアンタワー前 `(-974.8, 519.7)`、渋谷ストリーム初期スポーン `(-709.3, 492.2)`（`yawRadians = -2.324` 北西向き明治通り第1車線）をすべて実在配置と一致させた。
2. **平滑化 GSI DEM5A 3D 地形 (`sampleShibuyaTerrainY`) と Rapier `trimesh` 接地**:
   - 渋谷駅谷底（約 TP +14.6m）から宮益坂上（約 TP +30.6m、`(-501.1, 194.8)`）・道玄坂上・公園通りへ滑らかに上昇する 3D 地形および `trimesh` 物理路面・建築接地を統合した。
3. **Blender GLB 再生成と構造物・モニュメント刷新**:
   - [`blender/scripts/generate_shibuya_stream.py`](../blender/scripts/generate_shibuya_stream.py) と [`blender/scripts/generate_shibuya_plateau.py`](../blender/scripts/generate_shibuya_plateau.py) により `shibuya_stream.glb` と `shibuya_plateau_buildings.glb`（1,729 棟・33,734 面保持）を再生成し、ニュートラル基調のコンクリート／花崗岩マテリアルへ調整。
   - 首都高3号渋谷線カーブ高架および真方位 NNE–SSW の JR 山手線跨道橋・宮益坂の二重黄線、渋谷東口ガラス張りペデストリアンデッキ（`(-775, 438)` / `(-776, 400)`）、銀座線 M 字屋根（`(-835, 315)`）、彫刻造形ハチ公ブロンズ像＋花崗岩台座（`(-984.4, terrainY + 0.023, 324.6)`）を統合し、QFRONT / 109 / ストリーム S ロゴの非反転表示を確立した。
4. **道路接続クリアランス・標識配置・オープンワールド先読み制御**:
   - 井の頭通り・オルガン坂 (`nav-road-shibuya-inokashira-organ`) を宮下パーク北側 `(-935.0, -24.0) -> (-839.2, -16.0)` へ移設して建築干渉を解消し、日比谷通り (`nav-road-hibiya-dori`) 西端を `-500 -> -360` へトリミングして赤坂インターシティ付近への侵食を防止した。
   - `public/config/assets.yml` / `defaultAssetsYaml.ts` / `tokyoStationMap.ts` の全渋谷交差点信号機を `CurvedSidewalk_*` 上（`requireSidewalk: true`）へ再配置し、センター街沿道商業ビル `CenterGaiCommercialBuilding_*` の車道離隔を全辺・角 `>= 4.5m` に調整した。
   - `OpenWorldStreamingSystem` (`apps/web/src/city/openWorldStreaming.ts`) に `isCrossCityPrefetchBlocked` を抽出し、東京 ⇄ 渋谷の廊下セクターを跨ぐ遠距離先読み抑止を一元化した。
5. **街路景観ディテール・構造物・信号・車線連続性の完全実装**:
   - **SHIBUYA 109 前 Y 字路の法線修正＆御影石ノーズ島**: `yForkShape` / `plaza109IslandShape` の頂点を `(x, -z)` で定義して `rotateX(-Math.PI / 2)` へ統一し、法線反転カリングを根絶した上で東側ノーズ縁に沿って `Shibuya109TriangularPlazaCurb` を接地配置した。
   - **JR ガード下＆首都高 3 号高架下の刷新**: 巨大な琥珀ブロック／黄色ネオン棒を廃止し、スリムアルミ枠付き温白色リセス照明、約 3.2m 間隔の桁裏スチール I 型リブ (`RoadInfra_JrGuardUndersideRib`)、およびダーク御影石腰壁 (`RoadInfra_JrGuardUnderpassDado`) を追加した。
   - **玉川通り（セルリアン前）空白パッチ解消 & `0x94a3b8` 中立化**: セルリアン前・さくら坂西の `markingExclusionZones` を T 字路最小開口（半径 `8m`）へ絞り、中央分離帯除外半径を交差角に合わせて `15m` へ最適化して連続車線標示と `MedianGuidePost` 非干渉を両立。残存青灰 `0x94a3b8` もニュートラル色 (`0x9e9b93` / `0xa3a19a`) へ統一した。
   - **ハチ公前広場＆バスターミナル**: `DodecahedronGeometry` 球体木を `createGinkgoTree`（Blender `street_tree.glb` 連携スロット）へ置換し、`applyShibuyaStreamGlbMaterial3DTexture` に `HachikoBronze` / `HachikoGranite` ハンドラを追加、さらにガラス庇・時刻表ライトボックス付き `ShibuyaBusTerminalShelter_Hachiko` / `_EastExit` を車道外歩道へ設置した。
   - **信号機拡充・沿道街区補完・1F 庇＆袖看板密度強化**: 信号機 8 交差点（公園通り・渋谷区役所・文化村通り・松濤・金王坂×2・並木橋・井の頭通り）を街路樹より先行して `CurvedSidewalk_*` 上へ配置し、金王坂（`ShibuyaKonnozakaStreetscapeGroup` 5 棟）と文化村通り（`ShibuyaBunkamuraStreetscapeGroup` 6 棟）を補完した上で、商業・店舗ビル前面壁へ `attachStreetFacingAwningAndSign` により 1F 庇と縦型袖看板を一括装着した。

---

## 3. 検証結果（Trust Signals）

- **Blender / Python 静的検証＆360度レンダリングレビュー**:
  - `ruff format --check blender/scripts/ && ruff check blender/scripts/` が 8 ファイルすべてエラー 0 で通過。
  - `generate_shibuya_stream.py`（12 枚）および `generate_shibuya_plateau.py`（55 枚）の `--render-review` PNG を目視確認し、浮き・めり込み・文字反転なしを確認。
- **リポジトリ全体チェック・テスト・ビルド**:
  - `just format-code && just verify-all && just build-pages` が exit code 0（`actionlint`, `pinact run --check`, `tsc --noEmit`, `oxlint --deny-warnings`, `oxfmt --check`, `ruff`, `vitest run` 全 25 ファイル / 220 テスト通過、Vite 本番＆GitHub Pages ビルド成功）。
- **本番プレビュー 15 地点ブラウザ視覚検証 (`http://localhost:4173`, 昼・夜)**:
  - 渋谷ストリーム前、スクランブル交差点→QFRONT/センター街、SHIBUYA 109・Y 字路御影石ノーズ、ハチ公広場（Blender 樹木・ブロンズ像・バス停シェルター）、宮益坂上り（二重黄線・1F 庇/袖看板）、金王坂上り、宮益坂上見下ろし、セルリアンタワー前（車線連続性）、JR 山手線ガード下（桁裏 I 型リブ・温白色 LED・御影石腰壁）、首都高3号高架下（スリム温白色リセス照明）、道玄坂上り、文化村通り（新規商業ビル・1F 庇）、公園通り（神南一丁目信号・袖看板）、渋谷東口歩道橋＆東口バス停シェルター、夜間スクランブル交差点（1F 店舗・袖看板・LED ビジョン夜間発光）の全 15 枚を目視確認し、コンソールエラー 0 件・HTTP 404 0 件を確認した。


---

## 4. 追記修正（実サイト車線破綻 6 件の解消）

公開環境（`https://kexi.github.io/antigravity-deep-drive/`）の実画面確認で見つかった 6 件の車線・道路破綻を以下のとおり追加修正した。

1. **稲荷橋広場 (`ShibuyaInaribashiPlaza`) の回転角・範囲修正**: `PlaneGeometry(18, 52)` を `rotateY(0.82)` で明治通り・渋谷川と平行に揃え、明治通り車道への斜め飛び出しを解消。
2. **立体中央分離帯の横断歩道・停止線手前トリム**: `roadBuilder.ts` で横断歩道・停止線アプローチ区間（`ivStart + 7.2` / `ivEnd - 7.2`）を `medianIntervals` から差し引き、中央分離帯コンクリート島・両側白線・`MedianGuidePost` の横断歩道貫通を防止。
3. **明治通り 2 車線と青看板・路面矢印の整合**: `RoadLaneArrowType` に `"straight-right"` を追加し、明治通り（片側 2 車線）で第 1 車線 `straight-right` / 第 2 車線 `straight-left` を描画、併せて `createOverheadGuideSign`・`createLaneDirectionSign`・`assets.yml` / `defaultAssetsYaml.ts` を 2 車線構成へ統一。
4. **渋谷駅東口以東の国道 246 号 × 六本木通り二重重複の解消**: `nav-road-shibuya-roppongi-dori` を東口から `+16°` 東南東寄り経路へ分離し、`startTrimMeters = 42.0` / `medianExclusionZones` 半径 `42m` で車線・分離帯・標示の二重重複を根絶。
5. **`medianExclusionZones` と `markingExclusionZones` の独立分離**: `roadBuilder.ts` における無条件結合を廃止し、玉川通り等の T 字路車線標示ギャップ縮小（`8m`）が中央分離帯除外（`15m`）で上書きされないようにした。
6. **渋谷交差点パッドと曲線道路アスファルトの高さ逆転解消**: 渋谷交差点パッドおよび 109 Y 字路の `baseY` を `0.0155` に引き上げ、全渋谷曲線道路アスファルト（`<= 0.0144`）より確実に上層で接合するよう統一。

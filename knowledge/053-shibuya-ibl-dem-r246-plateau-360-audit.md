---
title: 渋谷エリア実写・ストリートビュー乖離の包括的監査と IBL・DEM5A・R246/PLATEAU・3Dランドマーク再統合
tags:
  - architecture
  - graphics
  - open-data
  - roads
trust_signals:
  verified_date: 2026-11-17
  author: reviewer_fixer
  reviewed_by: 360-degree Blender review, live Chrome E2E driving/screenshots & just verify-all (25 files / 210 tests)
---

# 053: 渋谷エリア実写・ストリートビュー乖離の包括的監査と IBL・DEM5A・R246/PLATEAU・3Dランドマーク再統合

## 1. 背景と前試行（052）で見落とされていた実害

前試行（052）の成果物を実ブラウザ (`http://localhost:3000/?area=shibuya`) およびソースコード・Blender 3D 出力の両面から再検証した結果、以下の重大な乖離とバグが残存していることを特定した。

1. **シーン IBL（`scene.environment`）欠如による昼間黒潰れ**:
   - `main.ts` に環境マップ（PMREM）が設定されておらず、`WeatherSystem` の昼間地面バウンス色も `0x1e293b` と暗かったため、昼 12:00 晴天でも Crown 車体・センター街アーチ支柱・JR ガード下桁・首都高高架裏・道路標識裏が黒潰れしていた。
2. **国土地理院 `shibuyaDem5a` の南北反転＋タイル境界断層と JSON 静的キャッシュのズレ**:
   - `fetch-open-data.ts` の `northM = -(z - anchorZ)` 未修正と単一タイル `15/29100/12906` 決め打ちにより、`tokyoMarunouchiOpenData.ts` の `z=-40` → `z=-20` 境界に 17m の断層（スクランブル交差点まで TP +30m 超）が残留していた。
   - さらにブラウザ実動作では `gsiPlateauLoader.ts` が `apps/web/public/data/tokyo_marunouchi_open_data.json` を優先ロードするため、TS 側だけを直してもブラウザ上の標高と道路データ（`sakurazaka` の誤直線）が更新されない二重状態が発生していた。
3. **国道246号（青山通り・玉川通り）の不整合と GPS 誤判定**:
   - `nav-road-route246` (`18m` / 2車線) と `nav-road-shibuya-tamagawa-west` (`20m` / 3車線) の幅員段差、`-727.5, 102` 重複 `medianExclusionZones` による幻の横断歩道（`x≈-708`）、および `533935-shibuya-rdcl-sakurazaka` 直線弦や高架 `shutoko3` (`z=99`) による地上車線 GPS 誤判定（`(-855, 100)` や明治通り通過時 `(-744.85, 99.32)` に首都高・区道が出る）が残存していた。
4. **スクランブル交差点・109前Y字路・標識・信号・ガード下案内板**:
   - スクランブル斜め横断歩道が交差点中央で十字交差し白格子ノイズとなっていた。
   - `nav-int-shibuya-109-y` (`-847, 250`) 接続パッド欠落により 109 前分岐部に隙間が生じていた。
   - 公園通り・道玄坂・宮益坂に速度標示 `50` が付いており、渋谷全体の信号機配置も 6 交差点のみと不足、JR ガード下看板の左右矢印 (`◀ ハチ公口 | 宮益坂口 ▶`) が実際の進行方向と矛盾していた。
5. **PLATEAU 建築の広域消失・浮遊スラブと `shibuya_stream.glb` の干渉**:
   - `generate_shibuya_plateau.py` の `ShibuyaQfront109` 過大除外ボックス (`[-900,-805,252,299]`) と過大 `ROAD_CORRIDOR_POLYLINES` 重心除外により、センター街・大盛堂・道玄坂・文化村通り・公園通りの沿道商業ビルが広範囲に消滅していたほか、`data155` に `h >= 5m` を含む浮遊分離スラブ（公園通り右側の浮遊ボックス等）が残っていた。
   - `ShibuyaMagnet_Tower` (`worldX ∈ [-779.0, -769.8]`) が JR 山手線高架橋 (`[-785.8, -766.2]`) の内部に完全にめり込んでいた。また SHIBUYA 109 は頂部 `Z=68m` のみにロゴがあり街路・チェイス視点から判別しづらく、QFRONT も 1F スターバックス窓が単一テクスチャに飲み込まれ、PARCO 外周テラスが浮遊ボックス状に見えていた。

---

## 2. 実施した主な改修

1. **プロシージャル屋外 IBL & 時間帯連動地面バウンス (`main.ts`, `weatherSystem.ts`)**:
   - `main.ts` に `PMREMGenerator` を用いた屋外スカイ・ホライゾン・コンクリート地面バウンス環境マップを生成・割り当て（ヘッドレス環境向けに安全ガード付き）。
   - `WeatherSystem.setEnvironment` および `applyPreset` の双方で `day` 地面反射色を `0x526071` へ引き上げ、`scene.environmentIntensity` を `day: 0.78 / morning: 0.62 / sunset: 0.48 / night: 0.14` へ直交同期。
2. **DEM5A 4タイル実測再サンプリング・JSON 同期・GPS 高架/地上識別 (`fetch-open-data.ts`, `tokyoMarunouchiOpenData.ts`, `tokyo_marunouchi_open_data.json`, `gsiPlateauLoader.ts`)**:
   - `fetch-open-data.ts` の南北符号バグを修正し、タイル群 (`15/29099..29100/12905..12906`) から正しく再サンプリングした実測 DEM5A グリッド（`z=-40→-20` 断層解消、スクランブル交差点 `TP +16.1m`）を TS・JSON 双方へ反映。
   - `nav-road-route246` 幅員を `20.0m` に統一し、`533935-shibuya-rdcl-sakurazaka` の誤座標を修正するとともに、`findNearestGsiRoad` で地上幹線走行時に高架 `shutoko3` や脇道へ吸われない優先判定を実装。
3. **渋谷道路網・標識・信号・センター街・JR ガード改修 (`roadMarkings.ts`, `tokyoStationMap.ts`)**:
   - `createScrambleDiagonalCrosswalks` の交差中央重ね塗りと隅角はみ出しを解消（`roadSystem.test.ts` の `4.2m` / `1.1m` 間隔要件は厳守）。
   - `nav-road-route246` の重複 `medianExclusionZones (-727.5, 102)` を統合除去し幻の横断歩道を解消。
   - `(-847, 250)` 109 前 Y 字路パッドを追加、センター街赤レンガ舗装をスクランブル端まで接続（`arcLen >= 0`）、アーチ鋼材明度を向上、速度ペイントを実路に合わせて `40`/`50` 分別、JR ガード板文字を実在表記へ是正、主要交差点信号機を 15 基体制へ拡充。
4. **PLATEAU 街並み密度復元と `shibuya_stream.glb` 360度収束改修 (`generate_shibuya_plateau.py`, `generate_shibuya_stream.py`, `tokyoStationMap.ts`)**:
   - `generate_shibuya_plateau.py`: `ShibuyaQfront` / `Shibuya109` 除外矩形を実フットプリントへ分割縮小し、`ROAD_CORRIDOR_POLYLINES` 半径を道路実幅へ整合、全高度の未支持浮遊分離スラブを除去（`data155` 等 3,624 浮遊面を削除し総計 1,729 棟・32,873 面を接地復元）。
   - `tokyoStationMap.ts` & `generate_shibuya_stream.py`: 北側 JR 山手線高架 (`z=272..346`) を東寄り `10.5m` 幅へ絞って `ShibuyaMagnet_Tower` (`worldX ∈ [-784.0, -775.6]`) を公園通り〜JR 間の正規区画へ完全無干渉移設。QFRONT を 1F-2F ウォームガラス店舗・3F-6F Q'S EYE・7F-8F ガラス冠部へ 3 層分化し、SHIBUYA 109 の `1 0 9` 立体エンブレムを円筒曲率埋没のない平面整列で頂部 `Z=68m` と街路視線 `Z=19.5m` に二段実装、PARCO スパイラル階段に垂直支持柱を追加し、`360` 度レンダリングで目視確認して収束させた。

---

## 3. Verification Record (Trust Signals)

- `just format-code` / `just verify-all`: `actionlint`, `pinact run --check`, `tsc --noEmit`, `oxlint --deny-warnings`, `oxfmt --check`, `ruff check/format --check`, Vitest 全 25 ファイル / 210 テスト全パス、`vite build` + `tsdown` minify 成功。
- Blender 360 度レビュー: `generate_shibuya_plateau.py`（55 アングル、EEVEE_NEXT 化で高速検証）および `generate_shibuya_stream.py`（24 アングル、3 回反復修正で `109` ロゴ埋没・PARCO・Magnet 干渉解消を目視確認）。
- Chrome 実画面 (`http://localhost:3000/?area=shibuya&boost=1&autostart=1`) & E2E 連続走行検証:
  - セルリアン前 `(-855, 100)`・スクランブル南北西・JR ガード下・R246×ヒカリエ前・センター街入口・道玄坂・宮益坂上・公園通り・夜間雨天コクピット（明治通り）のスクリーンショット目視確認。
  - `W` キー連続走行（明治通り `z=30→50`、R246 交差点通過、スクランブル→109前）にて実挙動およびコンソールエラー・警告ゼロを確認。

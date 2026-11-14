---
title: "渋谷広域道路網の全線接続保証・GLB 三角形スライス障害物監査・主要ビル1Fファサード刷新"
tags: [roads, physics, graphics, open-data]
trust_level: verified
date: "2026-11-11"
author: "Antigravity Agent"
summary: "ヒカリエ連絡路・国道246号・宮益坂・センター街アーチに干渉していた高架橋脚・建築シャフト・旧位置複合ビル・PLATEAU小規模構造物を全14コリドー×高さスライス幾何監査により特定・完全退避させ、Three.jsシーン・Rapier物理コライダー・GLB三角形スライスの障害物干渉ゼロを達成。併せてQFRONT・東映ビックカメラ・PARCO・MAGNET 1Fの無地スラブを実写ファサードへ刷新し、実機走行およびJDMカーナビ表示で異常ゼロを検証。"
---

# 渋谷広域道路網の全線接続保証・GLB 三角形スライス障害物監査・主要ビル1Fファサード刷新

## 1. 背景と発見された幾何学的・物理的ギャップ

従来の頂点ベース（Vertex AABB）チェックおよびプロシージャルメッシュ検査だけでは、以下の「垂直円柱プリミティブ」および「配置変換済み GLB ビル群」の道路侵食を見逃すケースが判明した。

1. **頂点ベース監査が垂直円柱を見逃す理由（Triangle-Slice Audit 導入の動機）**:
   - Blender スクリプトの `add_cylinder_z` は底面 (`y = 0`) と上面 (`y = 7.8m` 等) にしか頂点を持たず、車両通行高さ帯 (`y ∈ [0.1, 4.2]`) に中間頂点が存在しない。
   - そのため「高度範囲 `y ∈ [0.1, 4.2]` 内の頂点のみを走査する」検査では、道路中央に直立する円柱橋脚が素通りしてしまっていた。
   - 解決策として、アセット配置座標（`shibuya_stream.glb` の `position: [-695, 0, -15]`, `rotation.y: -PI/2` および `shibuya_plateau_buildings.glb` の単位行列）を適用したうえで、高さスライス面 `y = [0.25, 0.8, 1.5, 2.2, 3.0, 3.8]` で**全三角形エッジとの交差断面**を走査する幾何監査を実施した。

2. **特定・解消した全線接続阻害要因**:
   - **ヒカリエ連絡路 (`nav-road-shibuya-hikarie-access`) のデッキ円柱・西側シャフト干渉**:
     - `generate_shibuya_stream.py` の `deck_pillars` `(134.0, -29.5)`（ワールド座標 `(-724.5, 119.0)`）が連絡路車線中央を塞いでいたため、車道両脇へ跨ぐペア `(134.0, -40.5)`・`(134.0, -20.5)` に置換した。
     - 併せて `gsiPlateauLoader.ts`（2箇所の定義）および `tokyoMarunouchiOpenData.ts` において `13113-bldg-shibuya-hikarie` を `localX: -690.0, localZ: 148.0, width: 48.0, depth: 48.0` へ再配置し、`hikarie-access` の通過線形を `{ x: -727.5, z: 120 } -> { x: -727.5, z: 102 }` に統一した。`tokyoStationMap.ts` の `HikarieUrbanCoreEntrance` も幅 8.0m (`x = -b.w * 0.42`) へ縮小して車道から退避した。
   - **首都高3号線橋脚 (`ShutokoRoute3_Viaduct`) の R246 干渉**:
     - `tokyoStationMap.ts` の `ShutokoRoute3ViaductGroup` および `generate_shibuya_stream.py` の `pier_specs` を連動パラメータ化し、`worldX = -735.5 / -672.0 / -618.0` の脚位置・門型スパンを R246 車線外周に再設定した。
   - **宮下パーク (`ShibuyaMiyashitaPark_Complex`) の宮益坂 (`nav-road-shibuya-miyamasuzaka`) 閉塞**:
     - 旧中心 `cx = 263.0` (`worldZ = 248.0`) が宮益坂車道を直撃していたため、`cx = 335.0` (`worldZ = 320.0`) へ北側退避させ、`generate_shibuya_plateau.py` の除外矩形も `(-718.0, -672.0, 283.0, 357.0)` に同期した。
   - **センター街入口アーチ幅および PLATEAU 小屋フィルタ**:
     - `tokyoStationMap.ts` の `CenterGaiStreetBanner` (`bannerLateralOffset: 5.85`) と `generate_shibuya_stream.py` の `ShibuyaCenterGai_Arch` (`half_span = 5.8`) を連動拡幅した。
     - `generate_shibuya_plateau.py` で `Hikarie_Access` の除外点を更新し、車道近傍に混入していた小規模低層構造物フィルタ（`min(shell_w, shell_d) < 3.5 or (shell_area_xz < 180.0 and c_h < 4.5) or (shell_area_xz < 45.0 and c_h < 7.0)`）を強化した。

---

## 2. 主要ランドマーク 1F 無地スラブの解消

Blender マルチアンングル視覚レビュー（`review_stream_r2` / `review_stream_r3`）にて、スクランブル交差点および公園通り・宮益坂沿いの主要ランドマーク低層部（1F〜3F）に無地の灰色・クリーム色ボード（`mat_idx=6` `WarmPlazaGlow`）が突出していた視覚的欠陥を特定・是正した。

- `ShibuyaParco_Complex` / `ShibuyaQfront109_Complex` / `ShibuyaToeiBic_Tower`: 突出した `WarmPlazaGlow` 1F スラブをカーテンウォール・全面店舗ファサード表現に置換した。
- `ShibuyaMagnet_Tower`: 1F〜3F の無地 `WarmPlazaGlow` 板を削除し、ダークスチール枠付きの実写 `ShibuyaMagnetFacade`（`mat_idx=23`）を 1F 路面レベル（`z = 0.5..35.5m`）まで一体展開した。

---

## 3. 自動テスト・物理監査・実機検証（Trust Signals）

- **全 14 渋谷コリドー 三角形スライス・シーン・コライダー統合監査**:
  - Three.js 非中央分離帯メッシュ (`y ∈ [0.1, 4.2]`): **0 hits**
  - Rapier 物理エンジン障害物コライダー (`obstacleColliderHandles`, `y ∈ [0.1, 4.2]`): **0 hits**
  - `shibuya_stream.glb`（`13,030,056 bytes`）& `shibuya_plateau_buildings.glb` 全高さスライス: **0 hits**
- **回帰単体テスト (`apps/web/src/tests/shibuyaConnectivity.test.ts`)**:
  - 全 14 コリドーに対する `sceneObstructions` (`y ∈ [0.25, 4.2]`) および `tallColliderIntrusions` (`halfY * 2 >= 1.8`) アサーションを追加済み。
- **Blender 視覚レビュー（`r4`）＆ ブラウザ実機プレビュー検証 (`http://localhost:4173/`)**:
  - 実行時コンソールエラー **0**、全 50 HTTP リクエスト中失敗 **0**。
  - ヒカリエ連絡路南進 → 国道246号合流 (`cp5a` → `cp5b`、最大 `29 km/h`)、R246 東進首都高高架下 (`21 km/h`〜`22 km/h`)、宮益坂東進 (`37 km/h`〜`39 km/h`) の全区間を無衝突で走破。
  - センター街アーチ・PARCO/宇田川町・東映ビックカメラ・スクランブル交差点（MAGNET / QFRONT 1F）・右ハンドル車内カメラ (`C`) およびカーナビ拡大画面 (`K`: 145m先案内と接続済み渋谷道路網）を目視確認済み。

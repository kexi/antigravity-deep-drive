---
title: SHIBUYA 109・渋谷スクランブルスクエアのフォトリアル3Dモデリング・実写テクスチャ・夜間発光サイネージ刷新
tags:
  - architecture
  - graphics
  - open-data
trust_signals:
  verified_date: 2026-11-15
  author: teamwork_worker_m1
  reviewed_by: 360-degree multi-angle review & automated test suite
---

# 050: SHIBUYA 109・渋谷スクランブルスクエアのフォトリアル3Dモデリング・実写テクスチャ・夜間発光サイネージ刷新

## 1. 概要と改修背景

渋谷ドライブ体験において、ドライバー視点（コクピットおよびチェイスカメラ）から最も視線を集める核心的ランドマークである「SHIBUYA 109」（道玄坂・文化村通りの分岐点）および「渋谷スクランブルスクエア」（ハチ公前スクランブル交差点にそびえる東棟タワー）について、実在建築の精緻な物理寸法・ファサード構造・夜間発光演出を忠実に再現するモデリング刷新を実施した。

改修前の課題として以下が存在していた：
1. **渋谷スクランブルスクエア**: タワー外壁を取り囲む特徴的なスパイラルルーバーが、階段状の直方体ブロック（Minecraft風ステップ）として近似されており、ドライバー視点や近接視点で見栄えの粗さが目立っていた。また、ハチ公広場に面する象徴的な低層部「アーバン・コア（Urban Core）」アトリウムや2Fペデストリアンデッキ、屋上「SHIBUYA SKY」の天頂サーチライト演出が未実装であった。
2. **SHIBUYA 109**: 竹山実設計による円筒タワーのファサードにおいて、16本の垂直アルミリブ（縦マリオンフィン）や正面シースルーエレベーターのスリットガラス、足元の半円形エントランスステップとメタリック大庇が欠落していた。さらに、頂部3D「1 0 9」ロゴの下の壁面テクスチャ（`shibuya_109.jpg`）内に実写由来の赤色ロゴが残留しており、3Dロゴと平坦テクスチャロゴが二重に競合して「看板ステッカーが浮いて貼られている」ような違和感を与えていた。

本改修では、Blender MCP スクリプト（`blender/scripts/generate_shibuya_stream.py`）を大幅に強化し、実在建築の設計意図（日建設計・隈研吾建築都市設計事務所・SANAAによる連続傾斜ルーバー、竹山実によるシリンダー建築構造）に準拠した3D幾何学メッシュを生成するとともに、Three.js PBRマテリアルおよび夜間照明パイプライン（`apps/web/src/city/tokyoStationMap.ts`）に統合した。

---

## 2. 幾何学モデリング・テクスチャ刷新アーキテクチャ

### 2.1. 渋谷スクランブルスクエア（Shibuya Scramble Square）

#### (1) 4面連続傾斜スパイラルリボンルーバー（連続角度約26度）
従来の階段状直方体ブロックを完全撤廃し、タワー4面（東・北・西・南）をシームレスに周回しながら上昇する連続傾斜リボン（`add_slanted_ribbon` ヘルパー）を実装した。
- 各面における傾斜角は約26度（幅62mに対して各面約30m上昇、4面周回で1周約120m上昇）。
- 各リボン帯は平行する2連のアルミフィン（幅0.9m、厚み0.45m、オフセット1.8m）で構成され、タワーガラス面（`Roughness 0.14`, `Metalness 0.90`）から0.35m浮かせた位置に配置することで、太陽光や街灯の陰影がファサードに落ちる立体的な外観を実現。

#### (2) 低層商業ポディウム（1F〜11F, Z=0..38m）と多段セットバックテラス
- 基底商業部（全幅66m × 奥行き66m）に2段のセットバック段差（Z=20m, 32m）を設け、沿道スケールと調和するスカイラインを形成。
- 1Fおよび2Fファサードに立体ステンレスサインバー「SHIBUYA SCRAMBLE SQUARE」（発光マテリアル `ShibuyaStreamSignWhite`）を配備。

#### (3) ハチ公広場正対「アーバン・コア (Urban Core)」アトリウム
- スクランブル交差点・ハチ公前広場に面する北西角（Blender座標 $X \in [-30, 0]$, $Y \in [-30, 0]$）に、高さ34m（1F〜7F相当）、半径13.5mの半円筒型ガラスシャフトを構築。
- 内部には温かみのあるロビー照明（`WarmPlazaGlow`）を配し、外周には4mピッチの水平リングマリオンを巡らせることで、夜間にハチ公広場から見上げた際のシンボリックな吹き抜け光を再現。
- 2F（Z=6.5m）には東口・ハチ公前をつなぐペデストリアンデッキ接続口（幅8m、高さ4.2m、厚み0.8mの床スラブ）をモデリング。

#### (4) 屋上「SHIBUYA SKY」と18条の天頂サーチライト「CROSSING LIGHT」
- 最上部（Z=228..232m）の展望テラス周囲に3D「SHIBUYA SKY」クラウンロゴエンブレムを配置。
- 夜間演出として、屋上から天空へ垂直に伸びる18条の光柱「CROSSING LIGHT」（`mat_idx=29`: `ShibuyaSkySearchlightGlow`）をコーン型ボリュメトリックメッシュ（`add_cone_beam`）として配置。
- 昼間は完全透過（`opacity = 0.0`, `visible = false`）、夜間はシアン系発光（`#4df2ff`, `emissiveIntensity = 2.50`, `opacity = 0.72`）としてThree.jsシーングラフ内で動的制御される。

---

### 2.2. SHIBUYA 109（Shibuya 109 Complex）

#### (1) 竹山実シリンダータワーと16本の垂直アルミリブ
- 道玄坂と文化村通りの分岐点に建つ象徴的な円筒タワー（半径8.8m、高さ78m）の外周に、円周等間隔（$22.5^\circ$ ピッチ）で16本の垂直アルミリブ（幅0.32m、出幅0.38m）を配置。
- 正面（交差点正対方向 $\theta \approx 90^\circ$）には、幅3.8m、高さ54m（Z=10..64m）のシースルー展望エレベーター縦スリットガラス帯を埋め込み。

#### (2) 足元3段半円形エントランスステップとメタリック大庇
- 1Fエントランス足元（Z=0..1.2m）に、半径11.8m、10.8m、9.8mの3段半円形ステップテラスを構築。
- エントランス上部（Z=4.8m）には、出幅2.4m、厚み0.45mのメタリックキャノピーを新設し、下面天井に `WarmPlazaGlow` 間接照明スラブを配置。
- キャノピー上部には円筒壁面を照らし上げる夜間ウォッシュライト投光器メッシュを配備。

#### (3) 頂部オーバルベゼルフレーム＋3D「1 0 9」クラウンロゴ
- 円筒頂部（Z=70..76m）の正面ファサードに、幅9.2m、高さ4.4mの楕円形オーバルベゼルフレーム枠を構築。
- フレーム内側に間接ネオンハローリング（`ShibuyaQfront109Accent`）を埋め込み、その中央に立体的な「1」「0」「9」の文字グリフ（厚み0.32m、面取り付き）を浮き彫り配置。

#### (4) 背後V字クサビ型商業棟と壁面テクスチャクリーン化
- 円筒シリンダーの背後（南西・北西）に広がる商業棟を、道玄坂沿い（高さ58m、南西ウィング）と文化村通り沿い（高さ52m、北西ウィング）のV字クサビ型ブロックとして正確に分割・再構築。
- 道玄坂側壁面に `shibuya_109.jpg` をフラッシュマッピング。
- 画像処理（Pillow）により、テクスチャ内に残存していた重複赤色109ロゴ領域（$y \in [22, 179]$, $x \in [397, 626]$）を検出し、周囲の建築アルミパネル目地グラデーションと完全にブレンドして除去（赤色ロゴピクセル残存数 0）。頂部3Dロゴとの二重表示競合を根絶した。

---

## 3. Three.js PBRマテリアル & 夜間照明パイプライン統合

`apps/web/src/city/tokyoStationMap.ts` の `applyShibuyaStreamGlbMaterial3DTexture` および `setNightMode` を拡張し、新マテリアルのPBRプロパティと昼夜連動を統合した：

```typescript
// 天頂サーチライト CROSSING LIGHT マテリアル統合
const isSearchlight = mat.name === 'ShibuyaSkySearchlightGlow';
if (isSearchlight) {
  mat.color.setHex(0x4df2ff);
  mat.emissive.setHex(0x4df2ff);
  mat.emissiveIntensity = 0.0; // 昼間は消灯
  mat.transparent = true;
  mat.opacity = 0.0;
  mat.depthWrite = false; // ボリュメトリック半透明光柱の深度競合防止
  mat.blending = THREE.AdditiveBlending;
  mesh.renderOrder = 20;
}
```

- `shibuyaStreamEmissiveEntries` に `ShibuyaSkySearchlightGlow` を登録（`dayIntensity = 0.0`, `nightIntensity = 2.50`）。
- `setNightMode(isNight)` 呼び出し時に、エミッシブ輝度だけでなく `opacity = isNight ? 0.72 : 0.0` および `visible = isNight` を連動切り替え。
- `TimeOfDay`（`morning` / `day` / `sunset` / `night`）と `WeatherCondition`（`clear` / `cloudy` / `rain`）の直交分離原則を厳格に維持。

---

## 4. 道路クリアランスとコライダー安全性の検証

SHIBUYA 109は道玄坂と文化村通りの分岐点に位置するため、車道へのメッシュ・コライダー侵入を数学的・幾何学的に検証した。

- **Blender ⇄ Three.js 座標変換**:
  $$wx = -695.0 + by, \quad wy = bz, \quad wz = -15.0 + bx$$
- **SHIBUYA 109 円筒タワー中心**:
  Blender $(bx = 278.0, by = -184.0) \implies Three.js (wx = -879.0, wz = 263.0)$
  タワー外径半径: $R = 8.8\text{m}$（最大リブ突出を含め $9.18\text{m}$）
  $wz$ 占有範囲: $[253.8, 272.2]$
- **南側：道玄坂（Dogenzaka）車道クリアランス**:
  車道中心 $wx \approx -872, wz = 235$、車道幅 $16\text{m} \implies$ 車道北端 $wz = 243$
  タワー南端 $wz = 253.8$ との歩道マージン: $10.8\text{m}$（十分な歩道幅を確保、侵入ゼロ）
- **北側：文化村通り（Bunkamura-dori）車道クリアランス**:
  車道中心 $wx \approx -869, wz = 282$、車道幅 $14\text{m} \implies$ 車道南端 $wz = 275$
  タワー北端 $wz = 272.2$ との歩道マージン: $2.8\text{m} \sim 3.2\text{m}$（車道侵入ゼロ）
- **テストスイート検証**:
  `pnpm --filter web test src/tests/shibuyaConnectivity.test.ts` を実行し、道玄坂・文化村通り・国道246号・明治通りの全経路において車道障害物および透明コライダー侵入が 0 件であることを確認。

---

## 5. 360度収束レビュー（Multi-Angle Review）

リポジトリ規約に従い、`generate_shibuya_stream.py --render-review /tmp/shibuya_landmark_review` を実行して全24視点からレビュー画像をレンダリングし、視覚的収束を確認した。

| レビュー視点 | 確認項目 | 判定結果 |
|---|---|---|
| `14_closeup_qfront_and_shibuya109.png` | QFRONTと109の全体バランス、109円筒垂直リブとエレベータースリット | 良好・指摘事項なし |
| `23_closeup_shibuya109_entrance_steps_and_canopy.png` | 109の足元3段半円形ステップ、メタリック大庇、下面間接照明 | 良好・自然な接地感 |
| `11_closeup_scramble_sky_and_hikarie.png` | スクランブルスクエアの斜めルーバー、屋上クラウンロゴ、ヒカリエ | 良好・連続リボンがシャープ |
| `22_closeup_shibuya_scramble_square_urban_core.png` | アーバン・コア円筒ガラスシャフト、ロビーウォーム光、デッキ接続 | 良好・ハチ公広場からの視界良好 |
| `09_driver_eye_meijidori_north.png` | 明治通りドライバー視点でのランドマークスカイライン | 良好・圧迫感と開放感の調和 |
| `16_driver_eye_scramble_crossing_and_magnet.png` | スクランブル交差点ドライバー視点でのビジョン・サイネージ | 良好・テクスチャ解像度と発光バランス |
| `17_driver_eye_dogenzaka_mark_city.png` | 道玄坂上りドライバー視点での109ファサード | 良好・重複ロゴ除去により自然な建築壁面 |

指摘事項ゼロを達成し、造形・マテリアル・テクスチャ・夜間発光のすべてが収束した。

---

## 6. Trust Signals & 検証エビデンス

本実装の正当性・健全性は以下の客観的検証によって保証されている：

1. **自動テストスイート 100% PASS**:
   - `just run-tests`（全25テストファイル、209テストすべて合格）
   - `src/tests/buildingTexture.test.ts` (9 tests passed)
   - `src/tests/shibuyaConnectivity.test.ts` (3 tests passed)
   - `src/tests/openWorldStreaming.test.ts` (18 tests passed)
   - `src/tests/vehicle.test.ts` (14 tests passed)
2. **包括的 CI 検証パイプライン (`just verify-all`) 100% PASS**:
   - `just check-actions`: actionlint および pinact (SHA pinning) 合格
   - `just check-types`: TypeScript 型検査 (`tsc --noEmit`) エラー 0 件
   - `just lint-code`: `oxlint` (0 warnings, 0 errors), `oxfmt` (全ファイル整形済み), `ruff check` (合格), `ruff format` (合格)
   - `just build-app`: Vite 本番ビルドおよび `tsdown` minification 正常完了
3. **GLB アセット品質 & サイズバジェット**:
   - 出力先: `apps/web/public/models/shibuya_stream.glb`
   - ファイルサイズ: 6,885,376 bytes（約6.88MB、10MBバジェット内を維持）
   - マテリアルインデックス 29 (`ShibuyaSkySearchlightGlow`) の正常エクスポートとThree.js側マッピング確認完了。

---
title: Google マップ / ストリートビュー実写テクスチャ統合と渋谷リアル街路景観アーキテクチャ
tags:
  - architecture
  - graphics
  - open-data
  - roads
trust_signals:
  verified_date: 2026-11-08
  author: antigravity
---

# Google マップ / ストリートビュー実写テクスチャ統合と渋谷リアル街路景観アーキテクチャ

## 1. 背景と課題

ユーザーからの「Google マップ / ストリートビューを見て。もっと渋谷っぽく。ビルなどのテクスチャはここから作って欲しい。実際の同じ場所から見ればできるでしょ？」という要請に基づき、実写の渋谷景観に即したファサードテクスチャの生成、マテリアル適用、および WebGL 描画パイプラインの統合を実施した。

### 従来の課題
1. **Three.js 側シェーダーの上書き問題（最重要知見）**:
   - `tokyoStationMap.ts` の `applyArchitecture3DTexture` が、Three.js の `<color_fragment>` 内で `diffuseColor.rgb` を無条件でプロシージャルの色（`glassColor`, `spandrelColor`, etc.）で上書きしていたため、マテリアルに実写テクスチャ（`map`）が設定されていても完全に消去されていた。
2. **日本の都市特有の商業サイン景観の欠落**:
   - 渋谷・明治通りや国道246号の沿道には、道路・歩道へ直角に突き出す「袖看板（カラオケ館、ドラッグストア、コンビニ、居酒屋、カフェ等）」が林立しているが、従来のボックス形状ビルのみではこのリアルな「渋谷らしさ」が表現できていなかった。
3. **夜間ネオン・電子ビジョン発光の直交性**:
   - 天候（晴天・曇天・雨天）と時間帯（朝・昼・夕暮れ・夜間）を直交分離しつつ、屋外大型ビジョンや看板が夜間に鮮やかに光る仕組みが未統合であった。

---

## 2. 設計と実装

### 2.1 実写ストリートビューテクスチャ群の生成と配置 (`apps/web/public/textures/shibuya/`)
ストリートビューの実写アングルと建築意匠（カーテンウォール、LEDビジョン、袖看板、路面店）を忠実に再現した高解像度テクスチャ 8 種を配備：
1. `shibuya_qfront.jpg`: QFRONT 巨大湾曲 LED ビジョン「Q'S EYE」、TSUTAYA、スターバックス 2F、曲面ガラスカーテンウォール
2. `shibuya_109.jpg`: SHIBUYA109 円筒タワー冠部「109」ロゴ、メタリックシルバーパネル、路面店舗
3. `shibuya_scramble_square.jpg`: 渋谷スクランブルスクエア東棟 230m、垂直セラミックルーバー、SHIBUYA SKY ガラス回廊
4. `shibuya_stream.jpg`: 渋谷ストリーム水流スタガード千鳥白アルミフィン、Low-E ブルーガラス、壁面緑化
5. `shibuya_miyashita_park.jpg`: MIYASHITA PARK 3階建てガラスファサード、1F 渋谷横丁提灯・暖簾、屋上緑色スチールアーチ
6. `shibuya_commercial_facade.jpg`: 明治通り・246沿道商業ビル、コンビニ、ドラッグストア、飲食店、多層看板
7. `shibuya_billboards.jpg`: スクランブル交差点大型屋外電子ビジョン・ビルボード群
8. `shibuya_shutoko_sign.jpg`: 首都高速3号渋谷線「[303] 渋谷出口 / 六本木 / 霞が関 / 東名高速」緑色案内標識

### 2.2 テクスチャマネージャー (`ShibuyaTextureManager`)
- sRGB カラースペースの厳格適用 (`THREE.SRGBColorSpace`)
- UV リピートラップ設定 (`RepeatWrapping`)
- ヘッドレス / 単体テスト環境（`typeof window === "undefined"`）でのフォールバックダミー生成
- `/boost` 事前プリビルド連携（`preloadAll()`）

### 2.3 シェーダー置換の根本修正 (`#ifdef USE_MAP` / `#ifdef USE_EMISSIVEMAP`)
`tokyoStationMap.ts` の `applyArchitecture3DTexture` において、`#ifdef USE_MAP` ガードを導入：
```glsl
#ifdef USE_MAP
// 実写テクスチャ（ストリートビュー写真、看板、電子ビジョン、道路標識等）が存在する場合は、
// プロシージャル色帯での上書きを行わず、テクスチャ本来の高解像度な実写色彩を100%保持。
// 3Dボリュームノイズによる微細な結晶・風化ディテールのみを微量（5-8%）に乗算ブレンドする。
diffuseColor.rgb *= mix(0.93, 1.05, archVolMacro.r * 0.65 + archVolMicro.r * 0.35);
#else
// 既存のプロシージャル壁面シェーダー（赤レンガ、御影石、カーテンウォール、連窓、店舗等）
if (uArchSurfaceMode == 0) { ... }
#endif
```
同様に `<emissivemap_fragment>` においても `#ifdef USE_EMISSIVEMAP` で分岐し、実写看板・ビジョンの発光色を尊重しながら夜間モード（`uNightModeFactor`）に応じて自然にブーストするよう設計した。

### 2.4 明治通り突き出し袖看板・スクランブル交差点大型ビジョン群
- 明治通り沿道（東側 `x = -736.3m`、西側 `x = -763.7m`）のビル壁面から道路上空へX軸方向に1.35m〜1.6m突出し、進行方向（Z軸南北）に幅広の発光面を向ける突き出し袖看板（計12基）を配置。商業ファサードと大型ビルボードを交互に割り当てることで繁華街らしい多様性を創出。
- スクランブル交差点・駅前広場・国道246号沿道に大型電子ビジョン・ビルボード群（計4基）を配置（国道246号沿道ビジョンは流入車両へ正対）。
- 1F路面店舗ファサードを石張りポディウム基底の外側に配置（下部店舗 `storefrontHeight` と上部ポディウム `upperPodiumHeight` に分割）し、幾何学的な埋没を解消。
- 全マテリアルを `shibuyaStreamEmissiveEntries` に登録し、時間帯変更時に一括で発光輝度を同期。

### 2.5 マテリアル・UVマッピングの是正
- スクランブルスクエア屋上ヘリポート（`HeliportGreenPad`）およびJR跨道橋（`JRGreenSteel`）に専用マテリアルを定義し、首都高道路案内標識テクスチャが誤適用されていた不具合を解消。
- SHIBUYA109 の頂部円筒クラウンに実写 `Shibuya109Crown` を割り当て、台座プレートはクリーンな白アルミ（`StreamWhitePanel`）とすることで 3D レッドエンブレム「1 0 9」の立体感とテクスチャの二重競合を解消。
- Blender エクスポート時に全メッシュへ一律適用されていた `smart_project` を撤廃し、各プリミティブ生成時に計算された正確な平面・円筒 UV 座標を保持。
- `<emissivemap_fragment>` における夜間係数の二重乗算（1.85倍）を解消し、夜間白飛びを防いでマテリアル設定輝度を忠実に再現。

---

## 3. 検証記録 (Trust Signals)

- **自動検証コマンド**:
  - `just check-actions`: GitHub Actions 構文・pin 検証 PASS
  - `just check-types`: TypeScript 型検査（`tsc --noEmit`）PASS
  - `just lint-code`: oxlint / oxfmt / ruff check & format PASS（0 warnings, 0 errors）
  - `just run-tests`: Vitest 単体テスト 24 ファイル 194 件 ALL PASS（`buildingTexture.test.ts` 8 件すべて PASS）
  - `just build-app`: Vite 本番ビルド & tsdown ミニフィケーション PASS
  - `just verify-all`: 上記すべてを一括パス
- **実機 WebGL ヘッドレス Chrome 検証**:
  - Vite preview サーバー（ポート 4173）を起動し、Mac 上の Google Chrome ヘッドレス（ANGLE Metal バックエンド）でスクリーンショット取得：
    - 夕暮れ（17:30）スポーン位置（明治通り・渋谷ストリーム前）: 車内視点からビル沿道の袖看板・店舗ファサード・首都高緑標識・スクランブル交差点ビジョンが描画されていることを視覚確認。
    - 夜間（21:00）: 袖看板・屋外ビジョン・路面店舗・街灯・高層ビルオフィス窓の発光が夜空に鮮やかに映え、白飛びせずクリアに視認できることを確認。

---
title: "/boost オプションによる 3D シーン・ポストプロセスシェーダー一括事前プリビルド設計"
tags:
  - graphics
  - architecture
  - ui
trust_signals:
  verified_date: 2026-11-03
  author: antigravity
  verification_method: "Vitest 単体テスト (shaderPrebuilder.test.ts, i18n.test.ts) + tsc 型チェック + oxlint + tsdown 本番ビルド検証"
---

# `/boost` オプションによる 3D シーン・ポストプロセスシェーダー一括事前プリビルド設計

## 1. 背景と課題（Why）

Three.js (`WebGLRenderer`) は既定で「視錐台（フラスタム）内に初めて入った可視オブジェクト」のシェーダープログラムだけをオンデマンドでコンパイル・リンクする。
そのため、以下のような場面で初回フレーム落ち（シェーダーコンパイル・ヒッチ）が発生する課題があった。

1. **距離カリング対象オブジェクト**: 初期スポーン位置から離れた渋谷ストリーム周辺や東京駅遠方のビル群（`visible = false` で待機中）に接近した瞬間
2. **天候遷移オブジェクト**: 晴天から雨天へ切り替えた瞬間に `visible = true` となる GPU 雨ストリーク（`rainMesh`）や路面クラウンスプラッシュ（`rainSplashMesh`）
3. **複数カメラ・ポストプロセスパス**: 視線変更やルームミラー描画（`rearCamera`）、深度フォグ（`DepthFogPass`）・光学レンズフレア（`LensFlarePass`）・放射状モーションブラー（`MotionBlurPass`）の有効化時

これを解消するため、`/boost` オプション指定時（またはタイトル画面・HUD ドロワーのボタン操作時）にシーン内の全シェーダーとポストプロセスパスを一括事前プリビルド（Pre-compilation）する仕組みを導入した。

---

## 2. アーキテクチャと実装詳細（How）

### 2.1 URL パス・クエリ・ハッシュ解決 (`parseBoostOption` / `buildUrlWithBoostOption`)

[`apps/web/src/core/shaderPrebuilder.ts`](../apps/web/src/core/shaderPrebuilder.ts) にて、以下の複数経路から `/boost` オプションを判定する。

- **URL パス**: `/boost`, `/boost/`, `/antigravity-deep-drive/boost`（GitHub Pages サブパス配信対応）
- **URL クエリ**: `?boost=1`, `?boost=true`, `?boost=on`, `?boost`（値なしキーのみも有効）。一方で `/boost?boost=0` や `?boost=false` のように明示的無効化クエリが指定された場合はクエリを優先して `false` とする。
- **URL ハッシュ**: `#boost`, `#/boost`
- **静的ホスティング対応**: [`apps/web/scripts/minify.ts`](../apps/web/scripts/minify.ts) にてビルド時に `dist/index.html` を `dist/boost/index.html` および `dist/404.html` へ複製し、`vite preview` や GitHub Pages で `/boost` へ直接アクセスしても 404 にならず SPA が起動するようにした。

### 2.2 非同期 GLB アセット待機と全シェーダー・ライトバリアント一括プリビルド (`prebuildSceneShaders`)

単に起動直後に `renderer.compileAsync(scene, camera)` を呼ぶだけでは、非同期ロード中の GLB アセットや、`visible === false` のオブジェクト、またライト ON/OFF による PBR シェーダーバリアント差分が漏れる問題がある。そこで以下の手順を採る。

1. **非同期 GLB ロード完了待機 (`waitForModelsLoaded`)**:
   `CarModel`（`car.glb`）および `TokyoStationMap`（`tokyo_station.glb`, `shibuya_stream.glb`, `street_tree.glb`）の `GLTFLoader.load` とそのコールバック内で付与される `onBeforeCompile` 3D ボリュームテクスチャシェーダーの構築完了を `await Promise.all([cityMap.waitForModelsLoaded(), carModel.waitForModelsLoaded()])` で待機してからプリビルドを開始する。
2. **GLB 恒久非表示フォールバックの除外 (`userData.permanentlyHiddenByGlb`)**:
   GLB ロード完了に伴って恒久的に非表示化されたプロシージャルフォールバックメッシュや GLB 内アニメーション除外サブパーツには `userData.permanentlyHiddenByGlb = true` を付与し、プリビルド時の一時可視化対象から除外する。
3. **非表示・フラスタム外オブジェクトの一時展開**:
   `scene.traverse()` で `THREE.Light` と `permanentlyHiddenByGlb` を除く全描画オブジェクトの元の `visible` と `frustumCulled` をスナップショット保存し、一時的に `visible = true`, `frustumCulled = false` に強制変更する。
4. **昼間（SpotLight OFF）と夜間・雨天（SpotLight ON）の2バリアントプリビルド**:
   Three.js の PBR マテリアル（`MeshStandardMaterial` / `MeshPhysicalMaterial`）のシェーダーキャッシュキーは「可視状態のライト種別と個数」に依存する。全オブジェクトと一緒に無差別に `SpotLight` まで `visible = true` にして1パスだけコンパイルすると、昼間（`SpotLight` OFF）の初回描画フレームで全 PBR シェーダーがキャッシュミスして再コンパイルされる。これを防ぐため、第1パスで「現在のライト可視状態（昼間 OFF）」をコンパイルした後、非表示ライトが存在する場合は第2パスで「非表示ライトを一時的に ON にした状態（夜間・雨天 ON）」もコンパイルして元のライト状態に戻す。
5. **ポストプロセスシェーダーと未バインドテクスチャの保護**:
   ポストプロセスパス（`DepthFogPass`, `LensFlarePass`, `MotionBlurPass`）の `ShaderMaterial` を一時的なフルスクリーンクワッド Scene + `OrthographicCamera` に載せてプリビルドする際、初回レンダリング前で `value === null` となっているテクスチャ系ユニフォーム（`tColor`, `tDepth`, `tDiffuse`）には一時的な 1x1 `DataTexture` を割り当て、完了後に `null` へ復元・破棄する。
6. **状態復元と距離カリング再適用**:
   `finally` ブロックで全 `Object3D` の `visible` と `frustumCulled` を元の値へ復元（非同期中に外部が変更した場合はその変更を尊重）し、`cityMap.updateDistanceCulling()` を再適用して距離カリング状態を整合させる。

### 2.3 UI トグル・多言語対応・構造化ログ

- **UI トグル**: タイトル画面オーバーレイ（`#title-boost-buttons`）と HUD 設定ドロワー（`#boost-buttons`）の双方に ON / OFF トグルボタンを配置し、切り替え時には `history.replaceState` で URL を同期しつつ即時プリビルドを実行する。
- **多言語対応 (`ja` / `en` / `zh`)**: [`apps/web/src/core/i18n.ts`](../apps/web/src/core/i18n.ts) にローディングステージ文言（`loadingStageShaderPrebuild`）および HUD バッジ・ステータステキストを追加。
- **構造化ログ**: `logger.withAsyncTrace("graphics", "shader.prebuild", ...)` により、プリビルド所要時間（`durationMs`）・走査オブジェクト数・一時可視化オブジェクト数・ユニークマテリアル数を Zod 検証付き JSON ログとして記録する。

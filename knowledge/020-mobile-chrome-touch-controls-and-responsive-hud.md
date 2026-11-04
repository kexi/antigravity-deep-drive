---
title: モバイル Chrome（縦持ち Portrait・横持ち Landscape）マルチタッチ運転コントローラー・レスポンシブ HUD・適応型 FOV 設計
tags:
  - architecture
  - graphics
  - physics
  - ui
trust_signals:
  verified_date: 2026-11-04
  author: antigravity
  verification_method:
    - Vitest 単体テストによるマルチタッチ pointerId 独立追跡・アナログステアリングパッド・タッチ視線スワイプ・ダブルタップ正面リセット・Portrait/Landscape 適応型 FOV・MobileHudController・UI OFF モード（Tabキー / ボタン / URLクエリ ?hud=0）の検証
    - just format-code および just verify-all (oxlint / oxfmt / tsc --noEmit / vitest / vite build / minify) の全通過確認
    - Chrome DevTools MCP による UI OFF モード（HUD 全非表示 & 右上復帰ピルボタン）および UI ON モードの視覚的実機検証
---

# モバイル Chrome（縦持ち Portrait・横持ち Landscape）マルチタッチ運転コントローラー・レスポンシブ HUD・適応型 FOV 設計

## 1. 背景と課題（Why not 既存の PC 用キーボード・マウス UI のままモバイル表示しないか）

- スマートフォン（Pixel 11 Pro / iPhone 16 Pro Max 等）の Chrome でアクセスした場合、従来は以下の課題があった：
  1. **運転入力手段の欠如**: キーボード（`WASD` / 矢印キー / `Space`）が存在しないため、アクセル・ブレーキ・ステアリング・サイドブレーキを操作できなかった。
  2. **マルチタッチ競合リスク**: スマートフォンでの運転では「左手親指でステアリング」「右手親指でアクセル/ブレーキ」「別の指で視線スワイプ」が同時に行われるため、単一のタッチ状態変数で管理すると片指を離した瞬間に他方の操作まで解除されてしまう。
  3. **HUD による視界遮蔽**: PC 向けの全9グループの設定パネル（エリア・時間・天候・路面・視点・視線・ワイパー・ブラー・標識作成）と GIS テレメトリ枠をスマホ画面で常時展開すると、フロントガラスの視界と下部タッチペダル領域の大半が覆い隠されてしまう。
  4. **縦持ち（Portrait）時の水平視野角狭窄**: Three.js の `PerspectiveCamera` は垂直視野角（vFOV = `60°`）固定のため、`aspect < 1.0`（例：`390 × 844`, `aspect ≈ 0.462`）のスマホ縦持ちでは水平視野角（hFOV）が約 `30°` まで狭まり、運転席から左右のピラーや交差点が極端に見えにくくなる。

---

## 2. 実装アーキテクチャ（How）

### 2.1 `pointerId` 単位で独立追跡するマルチタッチ仮想コントローラー（[`apps/web/src/core/inputManager.ts`](../apps/web/src/core/inputManager.ts)）

- **仮想ペダル・ボタンのマルチタッチ管理**:
  - `VirtualControlKey`（`throttle`, `brake`, `handbrake`, `steerLeft`, `steerRight`）ごとに `Set<number>` でアクティブな `pointerId` を分離保持する。
  - `pointerdown` 時に `setPointerCapture(e.pointerId)` を行いつつ該当 `Set` に `pointerId` を追加し、`pointerup` / `pointercancel` / `lostpointercapture` 時にその `pointerId` のみを削除する。これにより、左手親指で操舵しながら右手親指をアクセルからブレーキへ踏み替えても互いの入力が干渉しない。
- **アナログステアリングパッド (`#touch-steer-pad`)**:
  - 左手親指を左右にスライドさせることで連続的な比例舵角 `[-1.0, +1.0]` を入力できる水平スライダーを実装。
  - 中央付近 `6%` のデッドゾーンを設けることで、直進中に親指がわずかに揺れても蛇行しない直進安定性を確保。
  - 操舵中に2本目の指がパッド領域に触れた場合（`analogSteerPointerId !== null && analogSteerPointerId !== e.pointerId`）は乗っ取りを防止して最初の指の操舵を継続する。
- **タッチ視線スワイプとカスタム・ダブルタップ正面リセット**:
  - WebGL キャンバス（`#webgl-canvas`）に `touch-action: none` を設定したモバイル Chrome 環境では、ブラウザネイティブの `dblclick` イベントが発火しないケースがある。
  - そのため、移動距離 `< 14px` のタッチタップが `320ms` 以内かつ距離 `36px` 以内で2回連続した際（`e.timeStamp` または `Date.now()` 基準、`elapsedMs >= 0`）に `onGazePreset("forward")` を発火させるカスタム・ダブルタップ検出を実装。
  - また、キャンバス視線ドラッグ中に2本目の指が触れても `activePointerId` 以外のポインタを無視し、視線基準点がジャンプしないように保護。
- **フェイルセーフ解除 (`clearAllInputs`)**:
  - `window` の `blur` イベントおよび `document` の `visibilitychange`（タブ非表示・アプリ切替）時に全キー・全タッチ `pointerId`・アナログ舵角・パッドの `.active` 状態・カーソル表示を即座にクリアし、復帰時の押しっぱなし暴走を防止。

### 2.2 レスポンシブ HUD・クイック操作バー・折りたたみドロワー（[`apps/web/src/core/mobileHudController.ts`](../apps/web/src/core/mobileHudController.ts), [`apps/web/index.html`](../apps/web/index.html)）

- **Dynamic Viewport (`100dvw` / `100dvh`) と Safe Area 対応**:
  - モバイル Chrome のアドレスバー伸縮によるレイアウトずれを防ぐため `100dvw` / `100dvh` と `window.visualViewport` リサイズ追従を導入し、`env(safe-area-inset-*)` でノッチ・ホームバー領域を保護。
- **1タップ・クイック操作バー (`#mobile-quick-bar`)**:
  - 運転中に頻繁に使う「視点切替」「正面」「左ミラー」「ルームミラー」「右ミラー」「計器・ナビ」「エリア切替」「位置リセット」「環境設定ドロワー開閉」を画面上部にコンパクト配置。
- **環境設定ドロワー (`#hud-controls-drawer`) と GIS テレメトリ折りたたみ (`#gis-toggle-btn`)**:
  - モバイル・タブレット幅（`max-width: 1024px` または `(pointer: coarse)`）では詳細設定パネル群を右ドロワーへ格納し、GIS テレメトリも初期状態で折りたたんで 3D 運転視界を最大化。
  - 横持ち（Landscape 短辺画面）でタッチ操作パッドを表示した際は、スピードメーターを画面下部中央へピル型コンパクト配置し、左右の操舵・ペダルクラスターと重ならないレイアウトを実現。
  - 道路標識作成モーダル内のフォーム要素（`input` / `select` / `textarea`）はモバイル環境で `font-size: 16px` を適用し、フォーカス時のブラウザ自動ズームを抑止。
- **タッチコントローラー表示モード切替 (`auto` / `on` / `off`)**:
  - タッチデバイスやコンパクト画面を自動検出する `auto` モードに加え、PC ブラウザ上でのデバッグや常時表示・非表示を切り替えられるボタンおよび URL クエリ（`?touch=on` / `?touch=off`）をサポート。
- **UI OFF モード（HUD全非表示・没入モード）**:
  - 3D 都市空間・雨滴シェーダー・車内コックピットを HUD オーバーレイ無しで鑑賞・運転できるよう、`MobileHudController.setHudVisible(visible, source)` と `parseHudVisibilityQuery(search)` を実装。
  - `body.ui-off-mode`（`data-hud-visibility="hidden"`）適用時は `.hud-header`、`.footer-left-stack`（操作ガイド）、`.speedometer-box`、および明示的に `touch=on` が指定されていない `#virtual-touch-controls` を `opacity: 0; pointer-events: none; visibility: hidden;` で滑らかに非表示化する。
  - **4つのトグル導線**:
    1. **キーボードショートカット (`Tab`)**: A〜Z の全アルファベットキー（26個）が既存の運転・環境・ワイパー・視線・GISショートカットで使用済みのため、未割り当ての `Tab` キーを `InputManager.onHudVisibilityToggle` にバインド（モーダル・タイトル画面非表示時は `e.preventDefault()` でフォーカスリング移動も抑止）。
    2. **ヘッダー & クイックバーのワンクリックボタン**: タイトル横の `#hud-ui-toggle-btn`（`👁 UI OFF [Tab]`）、モバイルクイックバーの `#quick-ui-off-btn`（`👁 UI OFF`）、および環境設定ドロワー内の `#ui-visibility-buttons`。
    3. **右上の控えめな復帰ピルボタン (`#ui-restore-fab`)**: UI OFF モード中のみ画面右上に半透明（`opacity: 0.42`、ホバー時 `1.0`）で常駐する `👁 UI表示 [Tab]` ボタンを配置し、マウス操作やスマホ・タブレットでも迷わず1タップで UI を再表示可能にした。
    4. **URL クエリパラメータ**: `?hud=0`, `?hud=off`, `?hud=false`, `?ui=0`, `?ui=off`, `?ui=false` で起動時から UI OFF モードを開始可能。
  - 切り替え時は `logger.withTrace` により `hud.visibility.change` イベント（`visible`, `source`, `touchMode`）を構造化ログへ記録する。

### 2.3 スマホ縦持ち（Portrait）時の適応型垂直 FOV 補正（[`apps/web/src/core/cameraController.ts`](../apps/web/src/core/cameraController.ts)）

- `CameraController.computeResponsiveFov(aspect)` を導入：
  - **横持ち・PC (`aspect >= 1.0`)**: 従来通り垂直 FOV = `60°` を厳密に維持（既存の速度不変カメラテストと完全互換）。
  - **縦持ち (`aspect < 1.0`)**: アスペクト比を `[0.38, 1.0]` にクランプした上でべき乗ブースト `baseFov * (1 / clampedAspect)^0.38` により垂直 FOV を滑らかに拡大し、パース歪みが過剰にならない上限 `80°` でクランプ。これにより縦持ちでも車内ダッシュボード・左右ミラー方向・交差点の見通しが自然になる。

---
title: Nintendo Switch Pro コントローラー (ProCon 1 / HAC-013) 対応と Gamepad API ハイブリッド入力アーキテクチャ
tags:
  - ui
  - architecture
trust_signals:
  verified_date: 2026-11-03
  author: antigravity
  verification: "just format-code && just verify-all (Vitest 16ファイル 117テスト全通過、tsc --noEmit、oxlint、Vite build + tsdown minify 成功)"
---

# Nintendo Switch Pro コントローラー (ProCon 1 / HAC-013) 対応と Gamepad API ハイブリッド入力アーキテクチャ

## 1. 背景と目的

Antigravity Deep Drive において、キーボードおよびモバイルタッチ操作に加え、**Nintendo Switch Pro コントローラー（第1世代 / 型番 HAC-013 / USB・Bluetooth 両対応）** による高精度なアナログステアリング・自由視線操作・ショートカットボタン操作・デュアルモーター振動フィードバック（Rumble）をサポートした。

## 2. デバイス識別と W3C Standard Mapping / Raw HID フォールバック (`apps/web/src/core/gamepadController.ts`)

1. **Vendor / Product ID とデバイス文字列による自動識別 (`isSwitchProController`)**:
   - Nintendo Vendor ID (`057e`) × Switch Pro Controller (1st Gen) Product ID (`2009`)、および Chrome / Safari / Firefox が USB または Bluetooth 接続時に付与する識別文字列（`Pro Controller`, `Nintendo Switch Pro Controller`, `HAC-013`, `057e-2009`, `Vendor: 057e Product: 2009` 等）を正規表現で判定する。
   - 複数ゲームパッドが接続されている環境では、接続中の Switch ProCon 1 を最優先でアクティブスロットとして選択する。
2. **W3C Standard Gamepad Mapping (`mapping === "standard"`) と Raw HID フォールバックの両立**:
   - **Standard Mapping 環境**（Chrome / Edge / Firefox / macOS 14+ Safari 等）では W3C 標準インデックス（`buttons[0..16]`, `axes[0..3]`）を使用する。 Switch ProCon の物理印字と W3C 位置ベース配置の対応（物理 B=下=`buttons[0]`, 物理 A=右=`buttons[1]`, 物理 Y=左=`buttons[2]`, 物理 X=上=`buttons[3]`）を明確に定義し、直感的なドライビング操作へ割り当てた。
   - **Non-Standard (Raw HID) 環境**（一部 Linux / 旧ドライバ等で `mapping === ""` となるケース）では、DirectInput 互換ボタン配列および `axes[9]` の Hat Switch 数値（`-1.0`〜`+1.0` の8方向エンコード）を `decodeRawHidHatSwitch()` でデコードして十字キー入力へフォールバックする。

## 3. アナログスティックのデッドゾーンと非線形レスポンスカーブ

- Switch ProCon 1（HAC-013）の静電容量方式アナログスティックが持つ微細なセンタードリフトを吸収するため、ラジアル/軸デッドゾーン `DEFAULT_STICK_DEADZONE = 0.09` を設定し、デッドゾーン外 `[0.09, 1.0]` を `[0.0, 1.0]` に連続再正規化する。
- 高速走行時の直進安定性と交差点での繊細な舵角調整を両立するため、指数 `DEFAULT_STICK_CURVE_EXPONENT = 1.35` の非線形レスポンスカーブ（$\text{sign}(x) \cdot |x_{\text{norm}}|^{1.35}$）を適用する (`applyStickDeadzoneAndCurve`)。

## 4. ボタン・スティック割り当て仕様

| 物理入力 (Switch ProCon 1) | 機能・アクション | 備考 |
| :--- | :--- | :--- |
| **Lスティック左右 (`axes[0]`)** | アナログステアリング (`-1.0` 左 〜 `+1.0` 右) | 指数 1.35 カーブ・操舵角速度への連続入力＋自動セルフセンタリング連動 |
| **ZR (`buttons[7]`) / A (`buttons[1]`)** | アクセル（前進・加速） | アナログ/デジタル最大値統合 |
| **ZL (`buttons[6]`) / B (`buttons[0]`)** | ブレーキ / 後退 | アナログ/デジタル最大値統合 |
| **Y (`buttons[2]`)** | サイドブレーキ (Handbrake) | ホールド中 ON |
| **X (`buttons[3]`)** | カメラ視点切替 (`C` キー相当) | 立ち上がりエッジ検出 |
| **Rスティック (`axes[2]`, `axes[3]`)** | ドライバー自由視線パン（Yaw / Pitch） | `getGazePanDelta(dt)` でキーボード首振り (`J`/`L`) と合算 |
| **Rスティック押込 (`buttons[11]`)** | 視線を正面へリセット (`forward`) | 立ち上がりエッジ検出 |
| **Lスティック押込 (`buttons[10]`)** | 路面状態切替 DRY / WET / SNOW (`G` キー相当) | 立ち上がりエッジ検出 |
| **L (`buttons[4]`) / R (`buttons[5]`)** | 左 / 右ドアミラー確認 (`ZL+L` / `ZR+R` で左右死角目視) | 立ち上がりエッジ検出 |
| **十字キー 上 (`buttons[12]`)** | ルームミラー確認 (`I` キー相当) | 立ち上がりエッジ検出 |
| **十字キー 下 (`buttons[13]`)** | 計器・11インチナビ確認 (`K` キー相当) | 立ち上がりエッジ検出 |
| **十字キー 左 (`buttons[14]`)** | ワイパーモード切替 (`X` キー相当) | 立ち上がりエッジ検出 |
| **十字キー 右 (`buttons[15]`)** | 時間帯切替 (`T` キー相当) | 立ち上がりエッジ検出 |
| **- ボタン (`buttons[8]`)** | エリア切替 東京駅 ⇄ 渋谷 (`P` キー相当) | 立ち上がりエッジ検出 |
| **+ ボタン (`buttons[9]`)** | 車両を初期位置へリセット (`R` キー相当) | 立ち上がりエッジ検出 |
| **キャプチャ (`buttons[17]`) / HOME (`buttons[16]`)** | グラフィック品質切替 High / Med / Low (`F` キー相当) | 立ち上がりエッジ検出 |

## 5. 構造化トレースログ・多言語 HUD 連携・モーダルガード

- **構造化ログ (`logger.withTrace`)**:
  - `gamepadconnected` / `gamepaddisconnected` およびポーリングによる初回検出時に、`module: "input"`, `event: "gamepad.connected"` / `"gamepad.disconnected"` として `traceId` 付き構造化ログを記録する。
- **モーダル表示中の誤操作防止**:
  - 道路標識作成モーダル（`#road-sign-modal`）が開いている間は、ゲームパッドの走行入力およびショートカット発火をすべてブロックし、モーダルを閉じた瞬間に押しっぱなしボタンの立ち上がりエッジが誤発火しないようボタン状態だけを同期する。
- **多言語 UI 対応 (`ja` / `en` / `zh`)**:
  - 設定ドロワー内 `#gamepad-status-badge`、画面上部 HUD `#gamepad-hud-status`、および下部操作ガイド `#controls-guide-line-4` を日本語・英語・中国語の3言語でリアルタイム更新する。

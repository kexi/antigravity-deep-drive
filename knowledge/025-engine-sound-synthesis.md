---
title: "プロシージャル Web Audio API エンジン音響合成（2.5L 直列4気筒マルチステージハイブリッド再現）"
tags:
  - physics
  - architecture
  - ui
trust_signals:
  verified_date: 2026-11-03
  author: antigravity
  verification_method: "Vitest 単体テスト (engineAudioSystem.test.ts, i18n.test.ts) + tsc 型チェック + oxlint + tsdown 本番ビルド検証"
---

# プロシージャル Web Audio API エンジン音響合成（2.5L 直列4気筒マルチステージハイブリッド再現）

## 1. 背景と課題（Why）

本ドライビングシミュレーターでは、トヨタ クラウン セダン（AZSH32、2.5L 直列4気筒ダイナミックフォースエンジン A25A-FXS マルチステージハイブリッド）の Rapier レイキャスト車両物理（800〜6,800 rpm、D1〜D4 自動変速、リバース R、回生ブレーキ）と 3D デジタルメータークラスターが稼働している。
しかし聴覚フィードバックが欠如していたため、加減速・変速・エンジン負荷・視点切り替え（車内コックピット視点 vs 車外チェイス視点）に対する臨場感が視覚情報のみに依存していた。

外部の録音音声ファイル（MP3/WAV ループ素材）に依存する方式ではなく、**Web Audio API による完全プロシージャル音響合成**を採用した理由（Why not 外部サンプルファイル方式）は以下の通りである。

1. **ピッチシフト境界のクロスフェード違和感の排除**: 単一または少数の録音ループを `playbackRate` で 800〜6,800 rpm（約 8.5 倍の周波数比）に伸縮するとフォルマントが破綻し、帯域分割サンプルでもクロスフェード境界で位相干渉が生じる。
2. **燃焼次数（Engine Order）と負荷（Throttle Load）の独立制御**: 同じ 3,000 rpm でも「アクセル全開加速中」と「アクセルオフ惰性走行中」では、吸気マニホールド負圧や気筒内燃焼圧の違いにより倍音構成が大きく異なる。プロシージャル合成であればクランク回転次数（1次・2次・4次・6次）のゲインや排気サチュレーション、吸気バンドパス Q 値を物理テレメトリから直接・連続的に変調できる。
3. **ゼロ外部バイナリアセット**: ネットワーク転送量を増やさず、オフラインやヘッドレス検証環境でも決定論的に動作する。

---

## 2. 音響物理モデルと実装詳細（How）

[`apps/web/src/audio/engineAudioSystem.ts`](../apps/web/src/audio/engineAudioSystem.ts) にて、4ストローク直列4気筒エンジンの音響特性とハイブリッド駆動系の倍音を以下の Web Audio ノードグラフで合成している。

### 2.1 クランク回転高調波（Engine Order Harmonics）

エンジン回転数を $N\,\text{[rpm]}$ とすると、クランクシャフト基本回転周波数 $f_1$ および各次数周波数 $f_k$ は次式で与えられる。

$$f_1 = \frac{N}{60}\,\text{[Hz]}, \quad f_k = k \cdot f_1$$

4ストローク直列4気筒エンジンではクランク1回転につき2気筒が点火するため、**2次高調波（$f_2 = 2 f_1$）が支配的な点火基本周波数（Firing Order Fundamental）**となる（800 rpm 時 $26.7\,\text{Hz}$、6,000 rpm 時 $200\,\text{Hz}$）。

| 次数 / 音源ノード | 波形 / 生成方式 | 物理的な役割 |
| :--- | :--- | :--- |
| **1.0次 (`subOsc`, $1.0 f_1$)** | `triangle` | クランクシャフト1回転周期の一次振動・重低音サブハーモニクス脈動 |
| **2.0次 (`fundamentalOsc`, $2.0 f_1$)** | `sawtooth` | 直列4気筒の主燃焼・排気基本周波数（最も支配的なエンジン音成分） |
| **4.0次 (`secondHarmonicOsc`, $4.0 f_1$)** | `sawtooth` | 高回転・高負荷時に立ち上がる直4特有のメカニカルな咆哮倍音 |
| **6.0次 (`thirdHarmonicOsc`, $6.0 f_1$)** | `triangle` | 3,500 rpm 以上の高回転域で金属的な伸びを与える高次倍音 |
| **吸気・バルブトレイン (`intakeNoiseSource` + `intakeBandpassFilter`)** | ブラウン/ピンク混合ノイズ + `bandpass` | スロットル開度に応じて中心周波数 ($320\text{〜}2,200\,\text{Hz}$) と Q 値が変化する吸気乱流音 |
| **ハイブリッド MG2 インバーター (`hybridOsc`)** | `sine` | クラウン マルチステージハイブリッド特有のモーター駆動・回生ブレーキ高周波ウィーン音 ($420\text{〜}2,100\,\text{Hz}$) および後退時（`R`）のパルス変調 |

### 2.2 非対称ソフトクリッピングと排気ローパスフィルタリング

オシレーターの単純加算だけでは電子的なブザー音に聞こえるため、燃焼高調波群を以下の排気音響チェーンに通している。

1. **非対称 `WaveShaperNode` (`exhaustWaveShaper` / `createExhaustSaturationCurve`)**:
   $\tanh(k x + \text{bias})$ に基づく非対称ソフトクリッピング曲線を適用し、気筒内の急激な圧力立ち上がりに伴う偶数次・奇数次倍音の厚み（温かみのある歪み）を付与する。
2. **排気管ローパスフィルター (`exhaustLowpassFilter`, `lowpass` $260\text{〜}4,400\,\text{Hz}$)**:
   RPM とスロットル負荷に応じてカットオフ周波数とレゾナンス Q 値を動的に変化させ、アイドリング時の落ち着いた重低音から高回転フルスロットル時の抜けの良い排気音までを連続的に表現する。

### 2.3 ギア変速トランジェント・リバースパルス変調・イグニッション（セル始動音）

- **変速トランジェント (`D 1` $\leftrightarrow$ `D 2` $\leftrightarrow$ `D 3` $\leftrightarrow$ `D 4`)**:
  ギア段の変化を検知すると `shiftTransient` エンベロープを発火させる。シフトアップ時は点火時期リタード（トルク制御）による一瞬の燃焼ゲイン減衰と実効 RPM 引き込みを再現し、シフトダウン時は回転合わせブリッピングによる倍音強調を付与する。
- **リバース（`R`）ギア後退パルス変調 (`reversePulseGain`)**:
  リバースギア選択時はハイブリッド MG2 インバーター音（`hybridOsc` / `hybridGain`）に対して約 $2.2\,\text{Hz}$ の周期的な周波数・ゲイン変調（`reverseModulationGain` および `reversePitchOffsetHz`）を重畳し、後退走行状態であることを聴覚的にも識別可能にしている。
- **初回イグニッション音 (`playStarterSound`) と Autoplay サスペンド復帰**:
  ブラウザの Autoplay Policy 解除（`#start-drive-btn` クリック、または走行キー・タッチステアパッド・ゲームパッド入力）のアンロック時に、`AudioContext.state === "running"` となったタイミングでハイブリッド MG1 スターターによるクランキング音と初爆吹き上がりを1回だけ合成する。`?autostart=1` 等で初回生成時に `suspended` のままだった場合も、`needsUnlockRetry()` により後続のユーザー操作で確実に `resume()` と始動音再生へ復帰する。

### 2.4 カメラ視点（車内コックピット vs 車外チェイス）による空間遮音フィルタリング

| カメラモード | キャビン遮音ローパス (`cabinLowpassFilter`) | 車室低域共鳴 (`cabinBassFilter`, `lowshelf`) | 音響的特徴 |
| :--- | :--- | :--- | :--- |
| **`cockpit`（車内運転席視点）** | $680\text{〜}1,880\,\text{Hz}$ | $+5.5\,\text{dB}$ (@ $135\,\text{Hz}$) | 高級セダンの遮音ガラス・バルクヘッド吸音材により高域が穏やかに減衰し、車体骨格を伝わる重厚な低域こもり音が強調される |
| **`chase`（三人称追跡視点）** | $2,400\text{〜}6,200\,\text{Hz}$ | $+1.8\,\text{dB}$ (@ $135\,\text{Hz}$) | マフラー直後のダイレクトでクリアな排気倍音と吸気ノイズが開放的に響く |

---

## 3. UI・ショートカット・多言語対応・構造化ログ

- **操作系**:
  - キーボードショートカット: `[H]` キーでエンジン音の ON / OFF（ミュート）を即座にトグル、`[` / `]` キーで音量を 10% 刻みで増減
  - デスクトップ HUD 設定ドロワー: `#sound-buttons`（`🔊 ON [H]` / `🔇 OFF [H]`）、音量スライダー `#sound-volume-slider`（`0〜100%`）＋数値表示 `#sound-volume-value`、およびステータスバッジ `#hud-sound-badge`（有効時は音量 `%` も併記）
  - スピードメータークラスター内インジケーター: `#sound-status`（有効時は音量 `%` も併記）
  - モバイルクイックバー: `#quick-sound-btn`
  - URL クエリ初期設定: `?sound=off`, `?mute=1`, `?volume=0.5`, `?vol=60` 等で初期状態を制御可能
- **多言語対応 (`ja` / `en` / `zh`)**:
  [`apps/web/src/core/i18n.ts`](../apps/web/src/core/i18n.ts) にて日本語・英語・中国語の全ラベル、音量スライダー ARIA ラベル（`soundVolumeAria`）、および操作ガイド（`controlsGuideLine3` 等）を統合。
- **構造化ログ**:
  [`apps/web/src/core/logger.ts`](../apps/web/src/core/logger.ts) の `logger.withTrace` を通じて `traceId` / `spanId` を伝播させ、`engine_audio.unlocked`, `engine_audio.mute_changed`, `engine_audio.volume_changed` イベントを Zod スキーマ検証付き JSON として出力する。

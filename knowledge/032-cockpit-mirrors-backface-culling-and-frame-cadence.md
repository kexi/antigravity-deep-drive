---
title: 車内ルームミラー・左右ドアミラーの描画バジェット階層化と BMesh 法線カリング防止設計
tags:
  - graphics
  - architecture
trust_signals:
  verified_date: 2026-11-04
  author: antigravity
---

# 車内ルームミラー・左右ドアミラーの描画バジェット階層化と BMesh 法線カリング防止設計

## 1. 概要と背景課題

Antigravity Deep Drive のコックピット（ドライバー）視点における後方鏡面反射システム（ルームミラー・右ドアミラー・左ドアミラー）において、以下の2つの重大な課題が発生していた。

1. **ミラー更新が極端に遅い・フリーズする（「遅い」問題）**:
   従来の描画ループでは、`hasMirrorFrameBudget = isTitleScreenDismissed && rawFrameMs <= 28.0 && smoothedFrameMs <= 26.0` という極めて過酷な条件（38.5 FPS 以上が必須）が課されていた。通常の 30〜35 FPS 走行環境ではフレーム時間が 28ms〜33ms 程度となり、この判定がほぼ常時 `false` に倒れ、ミラーの更新が 0 FPS（完全停止）になっていた。
2. **左サイドミラーが表示されない（「左は表示されてない」問題）**:
   Blender スクリプト (`blender/scripts/generate_vehicle_model.py`) の `build_side_mirror_glasses` において、BMesh で `f_glass = bm.faces.new(...)` した直後の面法線 `f_glass.normal` は `(0.0, 0.0, 0.0)` の初期値である。事前の `bm.normal_update()` が呼ばれていなかったため、`if f_glass.normal.y < 0:` が常に `false` と判定され、左ミラーガラスの法線反転処理がスキップされていた。その結果、左ミラーの法線が車両前方（+Z 方向）を向いたまま GLB にエクスポートされ、Three.js の裏面カリング (`THREE.FrontSide`) によって運転席から見たときに完全に消失していた。
3. **左ミラー注視アングルの見切れ**:
   カメラコントローラーの視線プリセット `left_mirror` が `yawDeg: 47` に設定されていたが、右ハンドル運転席 (`x = -0.38m, y = 1.13m, z = 0.06m`) から左ドアミラー中心 (`x = 0.915m, y = 0.965m, z = 0.873m`) への実幾何ベクトルは水平約 55.2° であり、47° ではビューポートの左端ギリギリに見切れていた。

---

## 2. アーキテクチャと改善設計

### 2.1 Blender BMesh 法線更新と Three.js DoubleSide 防御策

- **BMesh 面生成後の事前法線計算**:
  `f_glass = bm.faces.new(...)` 後、法線判定を行う前に必ず `bm.normal_update()` を実行し、車両後方（+Y 軸方向、Three.js では -Z 方向）を向いているか正しく検証して反転する。
- **Three.js 鏡面シェーダーマテリアルの `side: THREE.DoubleSide` 化**:
  `carModel.ts` の `createMirrorShaderMaterial` において `side: THREE.DoubleSide` を明示指定。万が一の法線や頂点インデックスの巻き順不整合に対しても、運転席から確実に両面描画される多重防御壁を構築した。
- **GLB ロード時の法線再計算・可視性保証**:
  GLB 内の `RearviewMirrorGlass`, `SideMirrorGlass_R`, `SideMirrorGlass_L` ノード取得時に `computeVertexNormals()` を明示実行し、`visible = true` を保証。

### 2.2 フレームバジェットの階層化と注視優先制御

単一のしきい値による全カットを廃止し、以下の階層化更新パイプラインを `main.ts` に導入した。

```mermaid
flowchart TD
    A["コックピット視点かつタイトル画面解除"] --> B{"ドライバーがミラーを注視中か？<br>(rearview / left / right)"}
    B -- Yes --> C["最優先即時更新<br>(carModel.updateMirrors force=true)"]
    B -- No --> D{"超高負荷か？<br>(rawFrameMs > 42.0 && smoothedFrameMs > 38.0)"}
    D -- No (通常走行) --> E["品質プリセット間隔で更新<br>(High: 1f / Med: 2f / Low: 6f)"]
    D -- Yes (重負荷) --> F{"frameCounter % 4 === 0 ?"}
    F -- Yes --> G["最低保証間隔で更新 (フォールバック)"]
    F -- No --> H["当フレームのみスキップ"]
```

- **注視中 (`isLookingAtMirror = true`)**:
  ドライバーがミラーを注視している瞬間は `force = true` で即時描画し、一切の遅延・カクつきを排除。
- **通常運転中**:
  `isUnderSevereLoad` でない限り更新パイプラインを維持し、`CarModel` 側のグラフィックス品質プリセット間隔（高: 毎フレーム、中: 2フレームに1回、低: 6フレームに1回）に委ねる。
- **超高負荷時**:
  フレームレート崩壊を防ぎつつ、最低でも 4 フレームに 1 回の更新を保証し、完全停止（0 FPS）を防ぐ。

### 2.3 JDM RHD 実幾何ベクトルに基づく視線プリセット最適化

UN R125 に基づくドライバー頭部・体幹回旋ピボットから、左ドアミラー実寸位置への幾何ベクトルを計算し、`GAZE_PRESET_SPECS.left_mirror` を `yawDeg: 54, pitchDeg: -6` に修正。左ミラーがビューポート中央に正確に捉えられるようにした。

---

## 3. 実機検証と Trust Signals

Chrome DevTools MCP を用いた実ブラウザ (`localhost:3000`) 上での自動検証を実施した。

- **法線・オブジェクト検証**:
  GLB ロード後の `SideMirrorGlass_L` が `visible: true` かつ `material: "ShaderMaterial"` として正常に認識されることを確認。
- **視線アングル検証**:
  カメラの向きと左ミラー中心へのベクトルが $\cos \theta \approx 0.9999$ で完全に一致することを確認。
- **フレームレート実測**:
  時速 30km/h 走行時、535ms の間に 12 回のミラー描画が実行され、約 22.4 FPS で安定して滑らかに更新され続けることを確認（完全停止・ラグの解消を証明）。
- **視覚的キャプチャ確認**:
  - `verified_left_mirror_cockpit.png`: 左サイドミラー内に後方の道路と地平線が鮮明に反射表示されていることを確認。
  - `verified_right_mirror_cockpit.png`: 右サイドミラー内に後方のビル群と夕暮れが明瞭に反射表示されていることを確認。
  - `verified_rearview_mirror_cockpit.png`: ルームミラー内に夕景の車線と道路がリアルタイム描画されていることを確認。

# Blender モデリング & アセットパイプライン ガイド

本プロジェクト（Tokyo Station Deep Drive）向けのBlenderモデリング規格およびglTF/GLBエクスポート手順です。

---

## 1. 車両モデルの階層構造（Hierarchy）

Three.js 側のローダー・コントローラーと完全に連動させるため、以下のオブジェクト命名規則と親子関係を維持してください：

```
CarRoot (Empty)
├── Chassis (メッシュ: 外装ボディ、バンパー、グリル)
├── Interior (メッシュ: ダッシュボード、センターコンソール、シート)
├── SteeringWheel (メッシュ: ステアリングハンドル - ピボットは回転軸の中心)
├── Windshield (メッシュ: フロントガラス - UV展開必須)
├── WiperDriver (Empty または ボーン: 運転席ワイパーピボット)
│   └── WiperBladeDriver (メッシュ: ワイパーアーム＆ブレード)
├── WiperPassenger (Empty または ボーン: 助手席ワイパーピボット)
│   └── WiperBladePassenger (メッシュ: ワイパーアーム＆ブレード)
├── Wheel_FL (メッシュ: 前左タイヤ・ホイール)
├── Wheel_FR (メッシュ: 前右タイヤ・ホイール)
├── Wheel_RL (メッシュ: 後左タイヤ・ホイール)
└── Wheel_RR (メッシュ: 後右タイヤ・ホイール)
```

---

## 2. フロントガラス（Windshield）のUV展開ルール

フロントガラスに雨滴およびワイパー拭き取りシェーダー（`src/shaders/windshield.ts`）を正しくマッピングするために、以下のUV設定を行ってください：

1. **UVアイランドの向き**:
   - U軸（横方向）：左（運転席側）が `0.0`、右（助手席側）が `1.0`（※日本右ハンドルの場合）
   - V軸（縦方向）：ガラス下端（カウル・ボンネット側）が `0.0`、ガラス上端（ルーフ側）が `1.0`
2. **歪みの抑制**:
   - 均等割り付け（Smart UV Project または シームを入れて Unwrap）を行い、雨滴が均等に流れるようにアスペクト比を維持します。

---

## 3. ワイパーのピボット軸設定

- ワイパーの回転軸（Origin / Pivot Point）は、フロントガラス下端のワイパーモーター取り付け位置（根元）に設定してください。
- 回転軸はフロントガラスの傾斜法線（ローカルZ軸）に沿って回転（Rotation Z）するように配置します。

---

## 4. Blender からの glTF/GLB エクスポート設定

Blender 3.x / 4.x の `File > Export > glTF 2.0 (.glb)` で以下の項目を推奨します：

- **Format**: `glTF Binary (.glb)`
- **Include**:
  - `Selected Objects`（必要なモデルのみ選択）
  - `Custom Properties`（オン）
- **Transform**:
  - `+Y Up`（Three.js準拠）
- **Geometry**:
  - `Apply Modifiers`（オン）
  - `UVs`（オン）
  - `Normals`（オン）
  - `Tangents`（法線マップを使用する場合オン）
- **Animation**:
  - アニメーションやモディファイアベイクが必要な場合は `Bake Animation` をオン

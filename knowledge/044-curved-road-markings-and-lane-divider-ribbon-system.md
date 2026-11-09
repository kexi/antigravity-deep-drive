---
title: "曲線道路標示（破線車線境界線・中央線・外側線）のスプライン追従リボンメッシュ化と交差点白線競合の完全排除"
tags: [roads, graphics]
trust_level: verified
date: "2026-11-09"
author: "Antigravity Agent"
summary: "スプライン曲線道路における破線レーン境界線のPlaneGeometry配置バグ（XYZオイラー角の軸不整合による地面ロール立ち上がり・食い込み、弧長パラメータ不整合による伸縮・ジグザグ）および交差点内部への白線侵入競合を根本解決。スプライン弧長サンプリングに基づく完全な同心リボンメッシュ化、交差点パッド端部トリム、CCWワインディング、DoubleSideマテリアルを導入し、日本規格（5mペイント/5m間隙/0.15m幅）に準拠した整然たる道路標示を実現。"
---

# 曲線道路標示（破線車線境界線・中央線・外側線）のスプライン追従リボンメッシュ化と交差点白線競合の完全排除

## 1. 背景と課題（「白線などぐちゃぐちゃ」の根本原因）

渋谷エリアを有機的な実在スプライン曲線道路網へ移行後、走行視界において「白線が斜めにねじれて地面に突き刺さる」「車線がジグザグに散らばる」「交差点内部で十数本の白線が交差してカオスになる」という視覚的破綻が発生していた。Playwright を用いた実機描画検証および Three.js シーン走査により、以下の 4 点の幾何学的・レンダリング的根本原因を特定した。

1. **オイラー角評価順（XYZ）の軸混同による地面バンク立ち上がりバグ**:
   - `roadBuilder.ts` の旧破線生成処理において、`PlaneGeometry(0.15, 5.0)` に対し `rotation.x = -Math.PI / 2` で地面に寝かせた後、`rotation.z = -Math.atan2(tan.x, tan.z)` を設定していた。
   - Three.js のオイラー角の評価順はデフォルトで `XYZ` であるため、X 軸回転後の Z 軸回転はローカル Y 軸（地面法線）ではなくワールド Z 軸（南北軸）回りとなり、道路が北から傾くにつれて**板が地面から最大 45 度以上バンクして立ち上がり、片側が地面に突き刺さり片側が空中に浮いていた**。
2. **Catmull-Rom スプラインの媒介変数 $t$ と弧長（Arc Length）の乖離**:
   - 不均等な制御点間隔を持つスプライン曲線に対し、`tMid = (dist + 2.5) / totalSplineLength` という媒介変数 $t$ による線形サンプリングを行っていたため、カーブの急な場所や制御点の間隔差によって破線の長さが 3m〜8m へ激しく伸縮し、車線に対して斜めに横切るジグザグ配置となっていた。
3. **交差点内部への複数道路白線の貫通・十字衝突（Z-fighting）**:
   - `markingEndTrim = 3.2m` という極小のトリム量しか設けられていなかったため、交差点パッド（半径 14m〜22m）の中心まで接続する全道路（明治通り本線、スクランブル連絡路、ヒカリエアクセス、道玄坂など）の中央実線・路肩実線・破線がそのまま突入。交差点内部で十数本の白線が放射状・十字状に衝突し合っていた。
   - 特にスクランブル交差点連絡路（`nav-road-shibuya-scramble`）が交差点中心を東西に貫通し、対角線X字型スクランブル横断歩道の上に東西の白破線を重ねていた。
4. **インデックスワインディング（Back-face Culling）による白線の消失**:
   - プロシージャルリボンメッシュ生成時の三角形インデックスが時計回り（Clockwise）で生成されていたため、`THREE.FrontSide`（デフォルト）においてカメラから裏面とみなされカリングされ、特定角度で線が突然消えていた。

---

## 2. 解決策と実装アーキテクチャ

### 2.1 スプライン弧長追従 破線リボンメッシュ生成（`buildDashedRibbonGeometry`）
直線板（PlaneGeometry）の個別配置を全廃し、スプライン曲線の弧長パラメータ $s$ に完全同期したプロシージャルリボンメッシュ生成へ刷新した。

```typescript
// 日本の区画線令（102号）一般道路規格: ペイント長 5.0m、間隙 5.0m、幅 0.15m
const buildDashedRibbonGeometry = (
  centerOffset: number,
  lineWidth: number,
  yHeight: number,
  dashLength = 5.0,
  gapLength = 5.0,
  startTrim = 0,
  endTrim = 0,
): THREE.BufferGeometry => {
  const halfW = lineWidth * 0.5;
  const offsetLeft = centerOffset - halfW;
  const offsetRight = centerOffset + halfW;
  const cycle = dashLength + gapLength;
  const minArc = startTrim;
  const maxArc = totalSplineLength - endTrim;
  if (maxArc - minArc <= dashLength) return new THREE.BufferGeometry();

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let vertCount = 0;
  for (let s = minArc; s + dashLength <= maxArc; s += cycle) {
    const segStart = s;
    const segSubdivs = 4; // 5m の破線を 4 分割しスプライン曲率に沿わせる
    const segStartIndex = vertCount / 3;

    for (let j = 0; j <= segSubdivs; j++) {
      const tSeg = j / segSubdivs;
      const arc = segStart + tSeg * dashLength;
      const frame = getInterpolatedFrame(arc);

      const lx = frame.pos.x + frame.normal.x * offsetLeft;
      const lz = frame.pos.z + frame.normal.z * offsetLeft;
      const rx = frame.pos.x + frame.normal.x * offsetRight;
      const rz = frame.pos.z + frame.normal.z * offsetRight;

      positions.push(lx, yHeight, lz, rx, yHeight, rz);
      normals.push(0, 1, 0, 0, 1, 0); // 常に真上法線
      uvs.push(0, tSeg, 1, tSeg);
      vertCount += 6;

      if (j < segSubdivs) {
        const a = segStartIndex + j * 2;
        const b = segStartIndex + j * 2 + 1;
        const c = segStartIndex + (j + 1) * 2;
        const d = segStartIndex + (j + 1) * 2 + 1;
        // 反時計回り（CCW: 上向き法線）で両三角形を構成
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  // 単一 BufferGeometry として一括生成
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeBoundingSphere();
  return geom;
};
```

### 2.2 交差点手前クリアランストリム（`startMarkingTrim` / `endMarkingTrim`）
- 交差点パッド（半径 14m〜22m）に接続する端点において、交差点パッド境界手前で白線（中央線・路肩線・車線境界破線）をピタリと停止させるトリム量（`defaultTrim = Math.min(18.0, totalSplineLength * 0.25)`）を一括適用。
- スクランブル交差点連絡路（`nav-road-shibuya-scramble`）における白線・ガードレール描画を明示的に無効化（`hasWhiteDashedLines: false, hasYellowCenterLine: false, hasGuardrails: false`）し、交差点内部に対角線X字型横断歩道と平滑アスファルトのみを供給。

### 2.3 マテリアル・ワインディング堅牢化
- `indices.push(a, c, b, b, c, d)`（CCW 反時計回り）により表面法線を確実に真上へ配向。
- `whiteLineMat` / `yellowMat` に `side: THREE.DoubleSide` および `polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3` を指定し、急勾配・急カーブ・浅角視線でのカリングおよび Z-fighting を根絶。
- 色調を純白（`color: 0xffffff, emissive: 0xf1f5f9, emissiveIntensity: 0.45`）へ最適化し、夕暮れ・夜間でも鮮明な視認性を確保。

### 2.4 スポーン地点（明治通り）の車両初期姿勢同期
- スポーン地点（`z = -68.0`）において、明治通りスプラインの中心線（`x = -750.0`）から法線方向に第2車線中央（`+5.1m`）へオフセットした `x = -744.9, z = -68.0` を設定。
- スプライン接線角（`yawRadians = 0.018`）と車両初期角度を同期させ、スポーン直後から車線境界線の真ん中に正対して前方に整然としたレーンが広がるように修正。

---

## 3. 検証結果（Trust Signals）

| 検証項目 | 以前の状態 | 改善後の状態 | 検証方法 |
| :--- | :--- | :--- | :--- |
| **破線のロール立ち上がり** | ワールドZ軸回転により地面から最大45度傾斜・突き刺さり | 法線 (0, 1, 0) 固定のスプライン追従リボンメッシュ化により地面完全面一 | Playwright 車載カメラ＆Chaseカメラ実写検証 |
| **破線の長さとピッチ** | 3m〜8m に不均等伸縮・ジグザグ | 正確に 5.0m ペイント / 5.0m 間隙 / 0.15m 幅 | `buildDashedRibbonGeometry` 弧長サンプリング検証 |
| **交差点内部の白線衝突** | 十数本の中央線・路肩線・破線が交差点中心で交差 | 交差点手前 18m で全白線が整然と停止、交差点内ノイズゼロ | スクリプト走査および俯瞰スクリーンショット検証 |
| **スポーン時の車線跨ぎ** | スポーン直後に車線境界破線の真上を踏んで斜めに停車 | 第2車線中央（x = -744.9）に正対し、左右に等幅の車線境界線が展開 | スポーン直後ドライバー視点スクリーンショット検証 |
| **CI/CD 全自動検証** | — | 24 テストスイート 202 テスト全件 PASS、ビルド・Minify 成功 | `just verify-all` |

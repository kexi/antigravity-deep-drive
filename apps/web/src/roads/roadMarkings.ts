import * as THREE from "three";

/**
 * 日本の道路標示（路面ペイント）ジェネレーター
 * 国土交通省 道路標識、区画線及び道路標示に関する命令 準拠
 */
export class RoadMarkings {
  private whitePaintMat: THREE.MeshStandardMaterial;
  private yellowPaintMat: THREE.MeshStandardMaterial;
  private brailleTileMat: THREE.MeshStandardMaterial;

  constructor() {
    // Why not: polygonOffset を設定しないと、同一平面付近の路面や交差標示同士でカメラ俯角が浅いときに
    // 深度バッファの量子化誤差による Z ファイティング（チラつき・縞模様）が発生するため、polygonOffset で手前へバイアスする
    this.whitePaintMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.5,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.yellowPaintMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // 日本の道路中央線オレンジイエロー
      roughness: 0.5,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.brailleTileMat = new THREE.MeshStandardMaterial({
      color: 0xeab308, // 点字ブロック警戒色イエロー
      roughness: 0.6,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /**
   * 中央線（黄色実線または白破線）
   */
  public createCenterLine(length: number, isNoPassing = true): THREE.Group {
    const group = new THREE.Group();
    const width = 0.2; // 20cm幅

    if (isNoPassing) {
      // 追越し禁止：黄色実線
      const geo = new THREE.PlaneGeometry(width, length);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.yellowPaintMat);
      mesh.position.y = 0.02;
      group.add(mesh);
      return group;
    }

    // 破線：長さ5m、間隔5m
    const dashLength = 5.0;
    const gapLength = 5.0;
    const cycle = dashLength + gapLength;
    for (let z = -length / 2 + dashLength / 2; z < length / 2; z += cycle) {
      const geo = new THREE.PlaneGeometry(width, dashLength);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.whitePaintMat);
      mesh.position.set(0, 0.02, z);
      group.add(mesh);
    }

    return group;
  }

  /**
   * 車線境界線（白破線：5m線・5m空き）
   */
  public createLaneDividers(length: number, laneOffsets: number[]): THREE.Group {
    const group = new THREE.Group();
    const width = 0.15; // 15cm幅
    const dashLength = 5.0;
    const gapLength = 5.0;
    const cycle = dashLength + gapLength;

    for (let x of laneOffsets) {
      for (let z = -length / 2 + dashLength / 2; z < length / 2; z += cycle) {
        const geo = new THREE.PlaneGeometry(width, dashLength);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.whitePaintMat);
        mesh.position.set(x, 0.02, z);
        group.add(mesh);
      }
    }

    return group;
  }

  /**
   * 車道外側線（路肩白実線：幅15cm）
   */
  public createShoulderLines(length: number, leftX: number, rightX: number): THREE.Group {
    const group = new THREE.Group();
    const width = 0.15;

    const leftGeo = new THREE.PlaneGeometry(width, length);
    leftGeo.rotateX(-Math.PI / 2);
    const leftMesh = new THREE.Mesh(leftGeo, this.whitePaintMat);
    leftMesh.position.set(leftX, 0.02, 0);
    group.add(leftMesh);

    const rightGeo = new THREE.PlaneGeometry(width, length);
    rightGeo.rotateX(-Math.PI / 2);
    const rightMesh = new THREE.Mesh(rightGeo, this.whitePaintMat);
    rightMesh.position.set(rightX, 0.02, 0);
    group.add(rightMesh);

    return group;
  }

  /**
   * 横断歩道（ゼブラ標示：帯幅45cm、間隔45cm、奥行き4m）
   */
  public createCrosswalk(roadWidth: number, zPosition: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 0.025, zPosition);

    const stripeWidth = 0.45; // 45cm
    const stripeGap = 0.45;
    const stripeLength = 4.0; // 奥行き4m

    const count = Math.floor(roadWidth / (stripeWidth + stripeGap));
    const startX = -(count * (stripeWidth + stripeGap)) / 2 + stripeWidth / 2;

    for (let i = 0; i < count; i++) {
      const x = startX + i * (stripeWidth + stripeGap);
      const geo = new THREE.PlaneGeometry(stripeWidth, stripeLength);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.whitePaintMat);
      mesh.position.set(x, 0, 0);
      group.add(mesh);
    }

    // 停止線（横断歩道の手前2m、幅45cmの白実線）
    const stopLineGeo = new THREE.PlaneGeometry(roadWidth * 0.9, 0.45);
    stopLineGeo.rotateX(-Math.PI / 2);

    const stopLineNorth = new THREE.Mesh(stopLineGeo, this.whitePaintMat);
    stopLineNorth.position.set(0, 0, 3.5);
    group.add(stopLineNorth);

    const stopLineSouth = new THREE.Mesh(stopLineGeo, this.whitePaintMat);
    stopLineSouth.position.set(0, 0, -3.5);
    group.add(stopLineSouth);

    return group;
  }

  // 歩道用点字ブロック（インターロッキングブロック上の黄色誘導帯）
  public createBrailleTiles(length: number, xPosition: number, curbY: number): THREE.Mesh {
    const width = 0.3; // 30cm幅
    const geo = new THREE.PlaneGeometry(width, length);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.brailleTileMat);
    mesh.position.set(xPosition, curbY + 0.005, 0);
    return mesh;
  }

  /**
   * 指示標示（210）: 「横断歩道又は自転車横断帯あり」（路面ダイヤマーク ◇）
   * How: 横断歩道手前 30m / 50m の車線中央に、縦5.0m×横1.5mの中抜き白ひし形を4本の帯メッシュで形成する。
   */
  public createCrosswalkDiamondMarking(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0.024, z);

    // ひし形の4辺を細長い平面メッシュで構築（縦長 3.6m, 横幅 1.4m）
    const edgeLen = 1.95;
    const lineWidth = 0.22;
    const angle = Math.atan2(0.7, 1.8); // 約21度

    const configs = [
      { dx: -0.35, dz: -0.9, rotY: angle },
      { dx: 0.35, dz: -0.9, rotY: -angle },
      { dx: -0.35, dz: 0.9, rotY: -angle },
      { dx: 0.35, dz: 0.9, rotY: angle },
    ];

    for (const c of configs) {
      const geo = new THREE.PlaneGeometry(lineWidth, edgeLen);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.whitePaintMat);
      mesh.position.set(c.dx, 0, c.dz);
      mesh.rotation.y = c.rotY;
      group.add(mesh);
    }

    return group;
  }

  /**
   * 規制標示: 「進行方向別通行区分（路面進行方向矢印）」
   * How: 車線中央に直進・左折・右折の路面白色ペイント矢印（全長5.0m）を配置する。
   */
  public createLaneArrowMarking(
    x: number,
    z: number,
    type: "straight" | "straight-left" | "right" = "straight",
    rotationY = 0,
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0.024, z);
    group.rotation.y = rotationY;

    // 縦ステム（シャフト）
    const stemGeo = new THREE.PlaneGeometry(0.3, 3.2);
    stemGeo.rotateX(-Math.PI / 2);
    const stem = new THREE.Mesh(stemGeo, this.whitePaintMat);
    stem.position.set(0, 0, 0.6);
    group.add(stem);

    const hasStraight = type === "straight" || type === "straight-left";
    if (hasStraight) {
      // 直進矢尻（3角形）
      const headShape = new THREE.Shape();
      headShape.moveTo(0, 1.8);
      headShape.lineTo(-0.55, 0.2);
      headShape.lineTo(0.55, 0.2);
      headShape.closePath();

      const headGeo = new THREE.ShapeGeometry(headShape);
      headGeo.rotateX(-Math.PI / 2);
      const head = new THREE.Mesh(headGeo, this.whitePaintMat);
      head.position.set(0, 0, -1.2);
      group.add(head);
    }

    const isStraightLeft = type === "straight-left";
    if (isStraightLeft) {
      const branchGeo = new THREE.PlaneGeometry(0.9, 0.35);
      branchGeo.rotateX(-Math.PI / 2);
      const branch = new THREE.Mesh(branchGeo, this.whitePaintMat);
      branch.position.set(-0.5, 0, 0.2);
      group.add(branch);

      const leftHeadShape = new THREE.Shape();
      leftHeadShape.moveTo(-1.45, -0.2);
      leftHeadShape.lineTo(-0.85, 0.35);
      leftHeadShape.lineTo(-0.85, -0.75);
      leftHeadShape.closePath();
      const leftHeadGeo = new THREE.ShapeGeometry(leftHeadShape);
      leftHeadGeo.rotateX(-Math.PI / 2);
      const leftHead = new THREE.Mesh(leftHeadGeo, this.whitePaintMat);
      group.add(leftHead);
    }

    const isRight = type === "right";
    if (isRight) {
      const branchGeo = new THREE.PlaneGeometry(0.95, 0.38);
      branchGeo.rotateX(-Math.PI / 2);
      const branch = new THREE.Mesh(branchGeo, this.whitePaintMat);
      branch.position.set(0.5, 0, -0.8);
      group.add(branch);

      const rightHeadShape = new THREE.Shape();
      rightHeadShape.moveTo(1.5, 0.8);
      rightHeadShape.lineTo(0.9, 1.35);
      rightHeadShape.lineTo(0.9, 0.25);
      rightHeadShape.closePath();
      const rightHeadGeo = new THREE.ShapeGeometry(rightHeadShape);
      rightHeadGeo.rotateX(-Math.PI / 2);
      const rightHead = new THREE.Mesh(rightHeadGeo, this.whitePaintMat);
      group.add(rightHead);
    }

    return group;
  }

  /**
   * 規制標示: 「最高速度（路面速度ペイント 40 / 50）」
   * How: 幹線道路の車線上に縦長フォントで「40」「50」の路面標示を描画する。
   */
  public createSpeedLimitRoadMarking(
    x: number,
    z: number,
    speedLimit = 40,
    rotationY = 0,
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0.025, z);
    group.rotation.y = rotationY;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.clearRect(0, 0, 256, 512);
        // 運転席からの俯角で見やすいよう縦方向に引き伸ばした黄色・白文字
        ctx!.save();
        ctx!.scale(1.0, 2.2);
        ctx!.fillStyle = "#f59e0b";
        ctx!.font = "bold 148px sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(`${speedLimit}`, 128, 116);
        ctx!.restore();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        roughness: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 4.2), mat);
      plane.rotation.x = -Math.PI / 2;
      group.add(plane);
    } else {
      // SSR / テスト環境フォールバック
      const fallback = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.6), this.yellowPaintMat);
      fallback.rotation.x = -Math.PI / 2;
      group.add(fallback);
    }

    return group;
  }

  /**
   * 指示標示: 「導流帯（ゼブラゾーン）」
   * How: 交差点手前の中央帯に白枠と斜めゼブラストライプを配置する。
   */
  public createZebraZoneMarking(width: number, length: number, zPosition: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 0.023, zPosition);

    const stripeCount = Math.max(2, Math.floor(length / 2.2));
    for (let i = 0; i < stripeCount; i++) {
      const z = -length / 2 + 1.1 + i * 2.2;
      const stripeGeo = new THREE.PlaneGeometry(width * 0.85, 0.35);
      stripeGeo.rotateX(-Math.PI / 2);
      const stripe = new THREE.Mesh(stripeGeo, this.whitePaintMat);
      stripe.position.set(0, 0, z);
      stripe.rotation.y = Math.PI / 5;
      group.add(stripe);
    }

    return group;
  }
}

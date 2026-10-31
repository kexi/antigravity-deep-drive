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
    this.whitePaintMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.5,
      metalness: 0.05,
    });

    this.yellowPaintMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // 日本の道路中央線オレンジイエロー
      roughness: 0.5,
      metalness: 0.05,
    });

    this.brailleTileMat = new THREE.MeshStandardMaterial({
      color: 0xeab308, // 点字ブロック警戒色イエロー
      roughness: 0.6,
      metalness: 0.1,
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
    } else {
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

  /**
   * 歩道用点字ブロック（インターロッキングブロック上の黄色誘導帯）
   */
  public createBrailleTiles(length: number, xPosition: number, curbY: number): THREE.Mesh {
    const width = 0.3; // 30cm幅
    const geo = new THREE.PlaneGeometry(width, length);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.brailleTileMat);
    mesh.position.set(xPosition, curbY + 0.005, 0);
    return mesh;
  }
}

import * as THREE from "three";
import { JapaneseRoadSigns } from "./roadSigns";

/**
 * 日本の道路プロップ（付帯物）ジェネレーター
 * - パイプビーム型ガードレール（日本標準白塗装）
 * - マンホール（円形鋳鉄・段差リング）
 * - 排水桝・グレーチング
 * - 日本のLED交通信号機（青・黄・赤）
 * - 道路案内・規制標識・警戒標識・指示標識
 */
export class RoadProps {
  public signs: JapaneseRoadSigns;

  private guardrailMat: THREE.MeshStandardMaterial;
  private manholeMat: THREE.MeshStandardMaterial;
  private gratingMat: THREE.MeshStandardMaterial;
  private poleMat: THREE.MeshStandardMaterial;

  constructor() {
    this.signs = new JapaneseRoadSigns();

    this.guardrailMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9, // 日本標準ガードレール白
      metalness: 0.8,
      roughness: 0.35,
    });

    this.manholeMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // 鋳鉄ダークグレー
      metalness: 0.85,
      roughness: 0.5,
    });

    this.gratingMat = new THREE.MeshStandardMaterial({
      color: 0x475569, // 亜鉛メッキグレーチング
      metalness: 0.9,
      roughness: 0.4,
    });

    this.poleMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // 信号柱・標識柱グレー
      metalness: 0.8,
      roughness: 0.35,
    });
  }

  /**
   * 日本標準ガードレール（波形ビーム＋丸パイプ支柱）
   */
  public createGuardrail(length: number): THREE.Group {
    const group = new THREE.Group();
    const postSpacing = 3.0; // 支柱間隔3m
    const postHeight = 0.85;

    // 水平ビーム（波型断面を模した直方体ビーム）
    const beamGeo = new THREE.BoxGeometry(0.08, 0.32, length);
    const beam = new THREE.Mesh(beamGeo, this.guardrailMat);
    beam.position.y = 0.65;
    beam.castShadow = true;
    group.add(beam);

    // パイプ支柱
    const postCount = Math.floor(length / postSpacing);
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, postHeight, 12);

    for (let i = 0; i <= postCount; i++) {
      const z = -length / 2 + i * postSpacing;
      const post = new THREE.Mesh(postGeo, this.guardrailMat);
      post.position.set(0, postHeight / 2, z);
      post.castShadow = true;
      group.add(post);
    }

    return group;
  }

  /**
   * マンホール（鋳鉄丸型蓋：直径60cm、外周リング）
   */
  public createManhole(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0.015, z);

    // 外枠リング
    const rimGeo = new THREE.TorusGeometry(0.36, 0.03, 8, 24);
    rimGeo.rotateX(Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, this.manholeMat);
    group.add(rim);

    // 蓋本体
    const plateGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.02, 24);
    const plate = new THREE.Mesh(plateGeo, this.manholeMat);
    plate.position.y = 0.005;
    group.add(plate);

    // 中心紋章エンブレム
    const crestGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.025, 6);
    const crest = new THREE.Mesh(crestGeo, this.manholeMat);
    crest.position.y = 0.008;
    group.add(crest);

    return group;
  }

  /**
   * 側溝・グレーチング（集水桝）
   */
  public createGrating(x: number, z: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(0.4, 0.03, 0.8);
    const mesh = new THREE.Mesh(geo, this.gratingMat);
    mesh.position.set(x, 0.01, z);
    return mesh;
  }

  /**
   * 日本の横型LED信号機（左から青・黄・赤）
   */
  public createTrafficLight(x: number, z: number, rotationY = 0): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotationY;

    // 支柱（高さ6m）
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, 6.5, 16);
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.position.y = 3.25;
    pole.castShadow = true;
    group.add(pole);

    // 横アーム
    const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 4.0, 12);
    armGeo.rotateZ(Math.PI / 2);
    const arm = new THREE.Mesh(armGeo, this.poleMat);
    arm.position.set(2.0, 5.8, 0);
    group.add(arm);

    // 灯器本体（横長直方体）
    const boxGeo = new THREE.BoxGeometry(1.4, 0.45, 0.25);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(3.2, 5.8, 0);
    group.add(box);

    // レンズ（青・黄・赤）
    const lampGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16);
    lampGeo.rotateX(Math.PI / 2);

    // 青（緑）
    const greenMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const greenLamp = new THREE.Mesh(lampGeo, greenMat);
    greenLamp.position.set(-0.42, 0, 0.13);
    box.add(greenLamp);

    // 黄
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const yellowLamp = new THREE.Mesh(lampGeo, yellowMat);
    yellowLamp.position.set(0, 0, 0.13);
    box.add(yellowLamp);

    // 赤
    const redMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const redLamp = new THREE.Mesh(lampGeo, redMat);
    redLamp.position.set(0.42, 0, 0.13);
    box.add(redLamp);

    // 歩行者用縦型信号機
    const pedBoxGeo = new THREE.BoxGeometry(0.32, 0.65, 0.2);
    const pedBox = new THREE.Mesh(pedBoxGeo, boxMat);
    pedBox.position.set(0.35, 3.2, 0);
    group.add(pedBox);

    const pedLampGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.04, 16);
    pedLampGeo.rotateX(Math.PI / 2);
    const pedRed = new THREE.Mesh(pedLampGeo, redMat);
    pedRed.position.set(0, 0.15, 0.11);
    pedBox.add(pedRed);

    const pedGreen = new THREE.Mesh(pedLampGeo, greenMat);
    pedGreen.position.set(0, -0.15, 0.11);
    pedBox.add(pedGreen);

    // 信号機アーム横の「交差点名標識（地点名プレート）」
    const intersectionPlate = this.signs.createIntersectionNamePlateMesh(
      "東京駅丸の内中央口",
      "Tokyo Sta. Central",
    );
    intersectionPlate.position.set(1.55, 5.8, 0.08);
    group.add(intersectionPlate);

    return group;
  }

  /**
   * 日本の道路標識（丸型速度標識 50km/h）
   */
  public createSpeedLimitSign(x: number, z: number, limit = 50): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 支柱
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.8, 12);
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.position.y = 1.9;
    group.add(pole);

    // 丸型看板（外赤枠、白地、数字）
    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.4, 0);

    const borderGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    borderGeo.rotateX(Math.PI / 2);
    const borderMat = new THREE.MeshStandardMaterial({ color: 0xdc2626 });
    const border = new THREE.Mesh(borderGeo, borderMat);
    signGroup.add(border);

    const faceGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.025, 24);
    faceGeo.rotateX(Math.PI / 2);
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.z = 0.005;
    signGroup.add(face);

    // 数字ペイント用Canvas（ブラウザ環境でのみテクスチャ生成、Node/SSR/テスト環境ではフォールバック）
    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const hasContext = Boolean(ctx);
      if (hasContext) {
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(0, 0, 128, 128);
        ctx!.fillStyle = "#1d4ed8";
        ctx!.font = "bold 72px sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(limit.toString(), 64, 64);
      }
      const numTex = new THREE.CanvasTexture(canvas);
      const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
      const numGeo = new THREE.PlaneGeometry(0.45, 0.45);
      const numMesh = new THREE.Mesh(numGeo, numMat);
      numMesh.position.z = 0.025;
      signGroup.add(numMesh);
    }

    group.add(signGroup);
    return group;
  }
}

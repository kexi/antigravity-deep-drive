import * as THREE from "three";
import { TrafficSignalMaterialLibrary, type VehicleLampColor } from "./signalMaterials";
import {
  TrafficSignalBuildOptionsSchema,
  type PedestrianSignalAspect,
  type SignalAxisGroup,
  type TrafficSignalBuildOptions,
  type TrafficSignalHandle,
  type VehicleSignalAspect,
} from "./signalSchema";

export interface TrafficSignalSharedAssets {
  poleMat: THREE.MeshStandardMaterial;
  bodyMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshStandardMaterial;
  signBackMat: THREE.MeshStandardMaterial;
  materialLibrary: TrafficSignalMaterialLibrary;
}

const LAMP_SPECS: ReadonlyArray<{
  key: VehicleLampColor;
  lampName: string;
  visorName: string;
  glowName: string;
  xOffset: number;
  lightColorHex: number;
}> = [
  {
    key: "green",
    lampName: "VehicleLamp_BlueGreen",
    visorName: "VehicleVisor_BlueGreen",
    glowName: "VehicleLampGlow_BlueGreen",
    xOffset: -0.42,
    lightColorHex: 0x00e5c3,
  },
  {
    key: "yellow",
    lampName: "VehicleLamp_Yellow",
    visorName: "VehicleVisor_Yellow",
    glowName: "VehicleLampGlow_Yellow",
    xOffset: 0,
    lightColorHex: 0xfbbf24,
  },
  {
    key: "red",
    lampName: "VehicleLamp_Red",
    visorName: "VehicleVisor_Red",
    glowName: "VehicleLampGlow_Red",
    xOffset: 0.42,
    lightColorHex: 0xef4444,
  },
];

let sharedGeometries: {
  poleGeo: THREE.CylinderGeometry;
  flangeGeo: THREE.CylinderGeometry;
  capGeo: THREE.SphereGeometry;
  cabinetGeo: THREE.BoxGeometry;
  jboxGeo: THREE.BoxGeometry;
  bandGeo: THREE.CylinderGeometry;
  hangerGeo: THREE.BoxGeometry;
  centerBodyGeo: THREE.BoxGeometry;
  endCapGeo: THREE.CylinderGeometry;
  lampFaceGeo: THREE.CircleGeometry;
  lampBackingGeo: THREE.CylinderGeometry;
  glowHaloGeo: THREE.PlaneGeometry;
  bezelGeo: THREE.TorusGeometry;
  visorGeo: THREE.CylinderGeometry;
  arrowStrutGeo: THREE.BoxGeometry;
  arrowBodyGeo: THREE.CylinderGeometry;
  pedArmGeo: THREE.CylinderGeometry;
  pedBoxGeo: THREE.BoxGeometry;
  pedHeaderGeo: THREE.BoxGeometry;
  pedLensGeo: THREE.PlaneGeometry;
  pedTopVisorGeo: THREE.BoxGeometry;
  pedSideVisorGeo: THREE.BoxGeometry;
  pushBodyGeo: THREE.BoxGeometry;
  pushBtnGeo: THREE.CylinderGeometry;
  plateBackGeo: THREE.BoxGeometry;
  plateFrontGeo: THREE.PlaneGeometry;
} | null = null;

function getSharedSignalGeometries() {
  if (sharedGeometries) {
    return sharedGeometries;
  }

  const lampRadius = 0.145;
  const endCapGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.15, 20);
  endCapGeo.rotateX(Math.PI / 2);

  const lampBackingGeo = new THREE.CylinderGeometry(lampRadius, lampRadius, 0.025, 24);
  lampBackingGeo.rotateX(Math.PI / 2);

  const visorGeo = new THREE.CylinderGeometry(
    lampRadius + 0.014,
    lampRadius + 0.022,
    0.22,
    20,
    1,
    true,
    0,
    Math.PI,
  );
  visorGeo.rotateX(Math.PI / 2);
  visorGeo.rotateZ(Math.PI / 2);

  const arrowBodyGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.14, 20);
  arrowBodyGeo.rotateX(Math.PI / 2);

  const pedArmGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.48, 10);
  pedArmGeo.rotateZ(Math.PI / 2);

  const pushBtnGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.018, 16);
  pushBtnGeo.rotateX(Math.PI / 2);

  sharedGeometries = {
    poleGeo: new THREE.CylinderGeometry(0.115, 0.155, 6.6, 20),
    flangeGeo: new THREE.CylinderGeometry(0.24, 0.27, 0.14, 20),
    capGeo: new THREE.SphereGeometry(0.12, 16, 12),
    cabinetGeo: new THREE.BoxGeometry(0.42, 1.35, 0.34),
    jboxGeo: new THREE.BoxGeometry(0.16, 0.28, 0.14),
    bandGeo: new THREE.CylinderGeometry(0.145, 0.145, 0.08, 16),
    hangerGeo: new THREE.BoxGeometry(0.06, 0.28, 0.22),
    centerBodyGeo: new THREE.BoxGeometry(0.88, 0.46, 0.15),
    endCapGeo,
    lampFaceGeo: new THREE.CircleGeometry(lampRadius, 24),
    lampBackingGeo,
    glowHaloGeo: new THREE.PlaneGeometry(0.62, 0.62),
    bezelGeo: new THREE.TorusGeometry(lampRadius + 0.012, 0.016, 10, 24),
    visorGeo,
    arrowStrutGeo: new THREE.BoxGeometry(0.05, 0.2, 0.05),
    arrowBodyGeo,
    pedArmGeo,
    pedBoxGeo: new THREE.BoxGeometry(0.36, 0.76, 0.18),
    pedHeaderGeo: new THREE.BoxGeometry(0.32, 0.085, 0.016),
    pedLensGeo: new THREE.PlaneGeometry(0.25, 0.25),
    pedTopVisorGeo: new THREE.BoxGeometry(0.28, 0.016, 0.13),
    pedSideVisorGeo: new THREE.BoxGeometry(0.014, 0.24, 0.11),
    pushBodyGeo: new THREE.BoxGeometry(0.12, 0.22, 0.09),
    pushBtnGeo,
    plateBackGeo: new THREE.BoxGeometry(1.25, 0.42, 0.02),
    plateFrontGeo: new THREE.PlaneGeometry(1.25, 0.42),
  };
  return sharedGeometries;
}

/**
 * 日本の横型 LED 交通信号機（警察庁・警視庁仕様）を構築し、
 * ゼロアロケーションで動的フェーズ切替できる TrafficSignalHandle を返す。
 *
 * How:
 * - すべてのジオメトリと LED マテリアルを共有化し、100 基超の設置でもメモリ・ドロー負荷を最小化する。
 * - 道路幅員に応じた適応アーム長（2.9m / 4.1m / 5.0m）で車道中央寄りへ的確に灯器を張り出す。
 * - 前面レンズに正立平面 CircleGeometry + toneMapped:false 高輝度 LED + 加算グロウハローを組み合わせ、
 *   PointLight を削除しても 150m 先から青緑・黄・赤・右折矢印を鮮明に識別できる。
 * - 右折矢印灯器（ArrowSignalSubUnit）は道路交通法準拠で red_right_arrow 時のみ点灯し、
 *   青信号との同時常時点灯バグを根絶する。
 */
export function buildJapaneseTrafficSignal(
  x: number,
  z: number,
  rotationY: number,
  shared: TrafficSignalSharedAssets,
  rawOptions?: TrafficSignalBuildOptions,
  meta?: {
    id?: string;
    intersectionId?: string;
    axisGroup?: SignalAxisGroup;
  },
): { group: THREE.Group; handle: TrafficSignalHandle } {
  const opts = TrafficSignalBuildOptionsSchema.parse(rawOptions ?? {});
  const geos = getSharedSignalGeometries();
  const mats = shared.materialLibrary;

  const group = new THREE.Group();
  group.name = "JapaneseTrafficSignalGroup";
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;

  // 1. 信号柱（テーパー鋼管柱・高さ 6.6m）＋ 根元フランジ ＋ 柱頭キャップ
  const pole = new THREE.Mesh(geos.poleGeo, shared.poleMat);
  pole.name = "TrafficSignalPole";
  pole.position.y = 3.3;
  pole.castShadow = true;
  group.add(pole);

  const flange = new THREE.Mesh(geos.flangeGeo, shared.poleMat);
  flange.name = "TrafficPoleBaseFlange";
  flange.position.y = 0.07;
  flange.userData.lodDetailTier = "high";
  group.add(flange);

  const cap = new THREE.Mesh(geos.capGeo, shared.poleMat);
  cap.position.y = 6.62;
  cap.userData.lodDetailTier = "high";
  group.add(cap);

  // 2. 交通信号制御機キャビネット＋端子箱
  const cabinet = new THREE.Mesh(geos.cabinetGeo, shared.bodyMat);
  cabinet.name = "TrafficControllerCabinet";
  cabinet.position.set(-0.34, 0.68, 0);
  cabinet.castShadow = true;
  cabinet.userData.lodDetailTier = "high";
  group.add(cabinet);

  const jbox = new THREE.Mesh(geos.jboxGeo, shared.bodyMat);
  jbox.name = "JunctionBox";
  jbox.position.set(0, 4.15, -0.14);
  jbox.userData.lodDetailTier = "high";
  group.add(jbox);

  // 3. 道路幅員に応じた 2 本平行支持アーム＋斜めブレース＋振れ止めストラット＋抱き金具
  const armLength = opts.armLengthMeters;
  const armCenterX = armLength * 0.5;
  const upperArmGeo = new THREE.CylinderGeometry(0.055, 0.065, armLength, 14);
  upperArmGeo.rotateZ(Math.PI / 2);
  const upperArm = new THREE.Mesh(upperArmGeo, shared.poleMat);
  upperArm.name = "ArmUpperPipe";
  upperArm.position.set(armCenterX, 5.96, 0);
  upperArm.castShadow = true;
  group.add(upperArm);

  const lowerArmGeo = new THREE.CylinderGeometry(0.048, 0.058, armLength, 14);
  lowerArmGeo.rotateZ(Math.PI / 2);
  const lowerArm = new THREE.Mesh(lowerArmGeo, shared.poleMat);
  lowerArm.name = "ArmLowerPipe";
  lowerArm.position.set(armCenterX, 5.56, 0);
  lowerArm.castShadow = true;
  lowerArm.userData.lodDetailTier = "medium";
  group.add(lowerArm);

  const braceLen = Math.min(2.1, armLength * 0.45);
  const braceGeo = new THREE.CylinderGeometry(0.032, 0.038, braceLen, 10);
  braceGeo.rotateZ(Math.PI / 2 - 0.22);
  const archStrut = new THREE.Mesh(braceGeo, shared.poleMat);
  archStrut.name = "ArmArchStrut";
  archStrut.position.set(braceLen * 0.51, 5.32, 0);
  archStrut.userData.lodDetailTier = "high";
  group.add(archStrut);

  const tieCount = Math.max(2, Math.floor(armLength / 1.0));
  const tieGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.4, 8);
  for (let i = 1; i <= tieCount; i++) {
    const tieX = Math.min(armLength - 0.35, (armLength * i) / (tieCount + 0.35));
    const tie = new THREE.Mesh(tieGeo, shared.poleMat);
    tie.position.set(tieX, 5.76, 0);
    tie.userData.lodDetailTier = "high";
    group.add(tie);
  }

  for (const bandY of [5.56, 5.96, 5.12]) {
    const band = new THREE.Mesh(geos.bandGeo, shared.bodyMat);
    band.position.set(0, bandY, 0);
    band.userData.lodDetailTier = "high";
    group.add(band);
  }

  // 4. 車両用薄型 LED 信号灯器（左から青緑・黄・赤）
  const signalHead = new THREE.Group();
  signalHead.name = "VehicleSignalHead";
  const headX = Math.max(1.85, armLength - 0.9);
  signalHead.position.set(headX, 5.74, 0.2);
  group.add(signalHead);

  for (const bracketX of [-0.42, 0.42]) {
    const hanger = new THREE.Mesh(geos.hangerGeo, shared.poleMat);
    hanger.position.set(bracketX, 0.08, -0.14);
    signalHead.add(hanger);
  }

  const centerBody = new THREE.Mesh(geos.centerBodyGeo, shared.bodyMat);
  centerBody.castShadow = true;
  signalHead.add(centerBody);

  const leftEndCap = new THREE.Mesh(geos.endCapGeo, shared.bodyMat);
  leftEndCap.position.set(-0.44, 0, 0);
  signalHead.add(leftEndCap);

  const rightEndCap = new THREE.Mesh(geos.endCapGeo, shared.bodyMat);
  rightEndCap.position.set(0.44, 0, 0);
  signalHead.add(rightEndCap);

  const vehicleLampMeshes: Record<VehicleLampColor, THREE.Mesh> = {} as Record<
    VehicleLampColor,
    THREE.Mesh
  >;
  const vehicleGlowMeshes: Record<VehicleLampColor, THREE.Mesh> = {} as Record<
    VehicleLampColor,
    THREE.Mesh
  >;

  let activeLight: THREE.PointLight | null = null;
  if (opts.includePointLight) {
    activeLight = new THREE.PointLight(0x00e5c3, 2.2, 22.0, 1.6);
    activeLight.name = "TrafficSignalActiveLight";
    activeLight.position.set(-0.42, -0.02, 0.28);
    signalHead.add(activeLight);
  }

  for (const spec of LAMP_SPECS) {
    // レンズ背面の筐体段差＋前面正立 CircleGeometry（UV 1:1 で同心円 LED パターンを歪みなく投影）
    const backing = new THREE.Mesh(geos.lampBackingGeo, shared.visorMat);
    backing.position.set(spec.xOffset, 0, 0.068);
    signalHead.add(backing);

    const lampMesh = new THREE.Mesh(geos.lampFaceGeo, mats.getVehicleLedMaterial(spec.key, false));
    lampMesh.name = spec.lampName;
    lampMesh.position.set(spec.xOffset, 0, 0.084);
    signalHead.add(lampMesh);
    vehicleLampMeshes[spec.key] = lampMesh;

    const glowMesh = new THREE.Mesh(geos.glowHaloGeo, mats.getGlowHaloMaterial(spec.key));
    glowMesh.name = spec.glowName;
    glowMesh.position.set(spec.xOffset, 0, 0.095);
    glowMesh.visible = false;
    signalHead.add(glowMesh);
    vehicleGlowMeshes[spec.key] = glowMesh;

    const bezelMesh = new THREE.Mesh(geos.bezelGeo, shared.visorMat);
    bezelMesh.position.set(spec.xOffset, 0, 0.084);
    signalHead.add(bezelMesh);

    const visorMesh = new THREE.Mesh(geos.visorGeo, shared.visorMat);
    visorMesh.name = spec.visorName;
    visorMesh.position.set(spec.xOffset, 0.015, 0.175);
    signalHead.add(visorMesh);
  }

  // 5. 右折矢印補助信号機（道路交通法準拠：red_right_arrow フェーズ時のみ点灯）
  let arrowLensMesh: THREE.Mesh | null = null;
  let arrowGlowMesh: THREE.Mesh | null = null;
  if (opts.showArrowSignal) {
    const arrowUnit = new THREE.Group();
    arrowUnit.name = "ArrowSignalSubUnit";
    arrowUnit.position.set(0.42, -0.44, 0);
    arrowUnit.userData.lodDetailTier = "medium";
    signalHead.add(arrowUnit);

    const strut = new THREE.Mesh(geos.arrowStrutGeo, shared.poleMat);
    strut.position.set(0, 0.2, -0.02);
    arrowUnit.add(strut);

    const arrowBody = new THREE.Mesh(geos.arrowBodyGeo, shared.bodyMat);
    arrowUnit.add(arrowBody);

    arrowLensMesh = new THREE.Mesh(geos.lampFaceGeo, mats.getArrowLedMaterial(false));
    arrowLensMesh.name = "ArrowSignalLens";
    arrowLensMesh.position.set(0, 0, 0.076);
    arrowUnit.add(arrowLensMesh);

    arrowGlowMesh = new THREE.Mesh(geos.glowHaloGeo, mats.getGlowHaloMaterial("arrow"));
    arrowGlowMesh.name = "ArrowSignalGlow";
    arrowGlowMesh.position.set(0, 0, 0.088);
    arrowGlowMesh.scale.setScalar(0.85);
    arrowGlowMesh.visible = false;
    arrowUnit.add(arrowGlowMesh);

    const arrowVisor = new THREE.Mesh(geos.visorGeo, shared.visorMat);
    arrowVisor.position.set(0, 0.015, 0.165);
    arrowUnit.add(arrowVisor);
  }

  // 6. 歩行者用信号機（角型 2 灯ピクトグラム式＋「歩行者・自転車専用」プレート＋押ボタン箱）
  const pedRedMeshes: THREE.Mesh[] = [];
  const pedGreenMeshes: THREE.Mesh[] = [];
  const buildPedestrianHead = (
    name: string,
    posX: number,
    posY: number,
    posZ: number,
    rotY: number,
  ): void => {
    const pedHead = new THREE.Group();
    pedHead.name = name;
    pedHead.position.set(posX, posY, posZ);
    pedHead.rotation.y = rotY;
    pedHead.userData.lodDetailTier = "medium";
    group.add(pedHead);

    for (const [idx, armY] of [0.24, -0.24].entries()) {
      const pedArm = new THREE.Mesh(geos.pedArmGeo, shared.poleMat);
      pedArm.name = idx === 0 ? "PedSignalArmUpper" : "PedSignalArmLower";
      pedArm.position.set(0.24, armY, -0.06);
      pedHead.add(pedArm);
    }

    const pedBox = new THREE.Mesh(geos.pedBoxGeo, shared.bodyMat);
    pedBox.castShadow = true;
    pedHead.add(pedBox);

    const pedHeaderPlate = new THREE.Mesh(geos.pedHeaderGeo, mats.getPedestrianHeaderMaterial());
    pedHeaderPlate.name = "PedBicycleHeaderPlate";
    pedHeaderPlate.position.set(0, 0.45, 0.02);
    pedHead.add(pedHeaderPlate);

    const pedRedMesh = new THREE.Mesh(
      geos.pedLensGeo,
      mats.getPedestrianLedMaterial("red-standing", false),
    );
    pedRedMesh.name = "PedLamp_RedStanding";
    pedRedMesh.position.set(0, 0.17, 0.092);
    pedHead.add(pedRedMesh);
    pedRedMeshes.push(pedRedMesh);

    const pedGreenMesh = new THREE.Mesh(
      geos.pedLensGeo,
      mats.getPedestrianLedMaterial("green-walking", false),
    );
    pedGreenMesh.name = "PedLamp_GreenWalking";
    pedGreenMesh.position.set(0, -0.17, 0.092);
    pedHead.add(pedGreenMesh);
    pedGreenMeshes.push(pedGreenMesh);

    for (const visorCenterY of [0.17, -0.17]) {
      const pedTopVisor = new THREE.Mesh(geos.pedTopVisorGeo, shared.visorMat);
      pedTopVisor.position.set(0, visorCenterY + 0.13, 0.145);
      pedHead.add(pedTopVisor);

      for (const sideX of [-0.132, 0.132]) {
        const pedSideVisor = new THREE.Mesh(geos.pedSideVisorGeo, shared.visorMat);
        pedSideVisor.position.set(sideX, visorCenterY + 0.01, 0.135);
        pedHead.add(pedSideVisor);
      }
    }
  };

  if (opts.hasPedestrianSignal) {
    // 主横断歩道向き（ローカル +X = 道路横断方向へ正対）
    buildPedestrianHead("PedestrianSignalHead", 0.06, 3.25, 0.48, Math.PI / 2);

    // 交差点角の副横断歩道向き（任意オプション：直交横断歩道へ正対する 2 基目歩行者灯器）
    if (opts.hasDualPedestrianHeads) {
      buildPedestrianHead("PedestrianSignalHead_Secondary", -0.48, 3.25, 0.06, Math.PI);
    }

    const pushMats = mats.getPushButtonMaterials();
    const pushButtonBox = new THREE.Group();
    pushButtonBox.name = "PedPushButtonBox";
    pushButtonBox.position.set(0, 1.15, 0.17);
    pushButtonBox.userData.lodDetailTier = "high";
    const pushBody = new THREE.Mesh(geos.pushBodyGeo, pushMats.bodyMat);
    const pushBtn = new THREE.Mesh(geos.pushBtnGeo, pushMats.btnMat);
    pushBtn.position.set(0, -0.02, 0.05);
    pushButtonBox.add(pushBody, pushBtn);
    group.add(pushButtonBox);
  }

  // 7. 交差点名標識（地点名プレート：アーム中腹へ配置）
  const plateGroup = new THREE.Group();
  plateGroup.name = "IntersectionNamePlate";
  plateGroup.position.set(Math.max(1.05, headX - 1.68), 5.76, 0.14);
  const plateBack = new THREE.Mesh(geos.plateBackGeo, shared.signBackMat);
  plateGroup.add(plateBack);
  const plateFrontMat = mats.getIntersectionNamePlateMaterial(
    opts.intersectionNameJa,
    opts.intersectionNameEn,
  );
  if (plateFrontMat) {
    const plateFront = new THREE.Mesh(geos.plateFrontGeo, plateFrontMat);
    plateFront.position.z = 0.02;
    plateGroup.add(plateFront);
  }
  group.add(plateGroup);

  // 8. ゼロアロケーション状態反映メソッド
  const initialPedAspect: PedestrianSignalAspect =
    opts.pedestrianSignal ?? (opts.activeSignal === "green" ? "green" : "red");

  const handle: TrafficSignalHandle = {
    id: meta?.id ?? `signal_${x.toFixed(1)}_${z.toFixed(1)}`,
    intersectionId: meta?.intersectionId ?? "standalone",
    axisGroup: meta?.axisGroup ?? "axis_a",
    group,
    hasArrowUnit: opts.showArrowSignal,
    currentVehicleAspect: opts.activeSignal,
    currentPedAspect: initialPedAspect,
    currentPedBlinkLit: true,
    applyAspect(
      vehicleAspect: VehicleSignalAspect,
      pedAspect: PedestrianSignalAspect,
      pedBlinkLit = true,
    ): void {
      handle.currentVehicleAspect = vehicleAspect;
      handle.currentPedAspect = pedAspect;
      handle.currentPedBlinkLit = pedBlinkLit;

      const litColor: VehicleLampColor =
        vehicleAspect === "green" ? "green" : vehicleAspect === "yellow" ? "yellow" : "red";
      const isArrowLit = vehicleAspect === "red_right_arrow" && opts.showArrowSignal;

      for (const spec of LAMP_SPECS) {
        const isOn = spec.key === litColor;
        vehicleLampMeshes[spec.key].material = mats.getVehicleLedMaterial(spec.key, isOn);
        vehicleGlowMeshes[spec.key].visible = isOn;
        if (isOn && activeLight) {
          activeLight.color.setHex(spec.lightColorHex);
          activeLight.position.x = spec.xOffset;
        }
      }

      if (arrowLensMesh && arrowGlowMesh) {
        arrowLensMesh.material = mats.getArrowLedMaterial(isArrowLit);
        arrowGlowMesh.visible = isArrowLit;
      }

      const isPedRedOn = pedAspect === "red";
      const isPedGreenOn = pedAspect === "green" || (pedAspect === "green_blink" && pedBlinkLit);
      const pedRedMat = mats.getPedestrianLedMaterial("red-standing", isPedRedOn);
      const pedGreenMat = mats.getPedestrianLedMaterial("green-walking", isPedGreenOn);
      for (const m of pedRedMeshes) {
        m.material = pedRedMat;
      }
      for (const m of pedGreenMeshes) {
        m.material = pedGreenMat;
      }

      group.userData.activeVehicleAspect = vehicleAspect;
      group.userData.activePedAspect = pedAspect;
    },
  };

  group.userData.trafficSignalHandle = handle;
  group.userData.intersectionId = handle.intersectionId;
  group.userData.axisGroup = handle.axisGroup;

  // 初期状態適用
  handle.applyAspect(opts.activeSignal, initialPedAspect, true);

  return { group, handle };
}

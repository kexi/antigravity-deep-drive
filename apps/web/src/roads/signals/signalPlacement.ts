import { isPointInPolygon2D, leftNormal2D } from "../lanes/junctionTopology";
import type { JunctionTopology, Point2D } from "../lanes/laneSchema";
import type { SignalAxisGroup, TrafficSignalPlacementSpec } from "./signalSchema";

interface NamedIntersectionPreset {
  x: number;
  z: number;
  nameJa: string;
  nameEn: string;
}

const KNOWN_INTERSECTION_NAMES: ReadonlyArray<NamedIntersectionPreset> = [
  // 丸の内・東京駅・皇居・銀座エリア
  { x: 0, z: 5, nameJa: "東京駅丸の内中央口", nameEn: "Tokyo Sta. Central" },
  { x: 0, z: 165, nameJa: "丸の内仲通り・行幸通", nameEn: "Marunouchi Naka-dori" },
  { x: 0, z: 250, nameJa: "和田倉門・日比谷通り", nameEn: "Wadakuramon" },
  { x: 0, z: 365, nameJa: "皇居外苑・内堀通り", nameEn: "Kokyo Gaien" },
  { x: -268, z: 5, nameJa: "丸の内南口・鍛冶橋", nameEn: "Marunouchi South" },
  { x: -268, z: 95, nameJa: "永代通り・国道246号", nameEn: "Eitai / Route 246" },
  { x: -268, z: 165, nameJa: "丸の内北仲通り", nameEn: "Marunouchi North" },
  { x: -268, z: 250, nameJa: "大手町交差点", nameEn: "Otemachi" },
  { x: -268, z: 365, nameJa: "大手門・内堀通り", nameEn: "Otemon" },
  { x: 270, z: 5, nameJa: "鍛冶橋交差点", nameEn: "Kajibashi" },
  { x: 270, z: 165, nameJa: "国際フォーラム前", nameEn: "Tokyo Int'l Forum" },
  { x: 270, z: 250, nameJa: "馬場先門交差点", nameEn: "Babasakimon" },
  { x: 270, z: 365, nameJa: "祝田橋・内堀通り", nameEn: "Iwaidabashi" },
  { x: -156, z: 250, nameJa: "丸の内一丁目・日比谷通", nameEn: "Marunouchi 1" },
  { x: 156, z: 250, nameJa: "日比谷・丸の内二丁目", nameEn: "Hibiya / Marunouchi 2" },
  { x: 0, z: -350, nameJa: "数寄屋橋交差点", nameEn: "Sukiyabashi" },
  { x: 156, z: -350, nameJa: "銀座四丁目交差点", nameEn: "Ginza 4-chome" },
  { x: 650, z: -350, nameJa: "東銀座・三原橋", nameEn: "Higashi-Ginza" },
  { x: 0, z: -750, nameJa: "新橋交差点", nameEn: "Shimbashi" },
  { x: 650, z: -750, nameJa: "汐留交差点", nameEn: "Shiodome" },
  { x: -350, z: 365, nameJa: "三宅坂交差点", nameEn: "Miyakezaka" },
  { x: -350, z: 850, nameJa: "半蔵門・千鳥ヶ淵", nameEn: "Hanzomon" },
  { x: 0, z: 850, nameJa: "竹橋交差点", nameEn: "Takebashi" },
  { x: 156, z: 850, nameJa: "神田橋交差点", nameEn: "Kandabashi" },
  // 渋谷エリア
  { x: -990.7, z: 275.8, nameJa: "渋谷駅前スクランブル交差点", nameEn: "Shibuya Scramble" },
  { x: -818.4, z: 245.8, nameJa: "宮益坂下交差点", nameEn: "Miyamasuzaka-shita" },
  { x: -762.8, z: 435.5, nameJa: "渋谷駅東口・国道246号", nameEn: "Shibuya Sta. East" },
  { x: -501.1, z: 194.8, nameJa: "宮益坂上交差点", nameEn: "Miyamasuzaka-ue" },
  { x: -1440.0, z: 675.0, nameJa: "道玄坂上交差点", nameEn: "Dogenzaka-ue" },
  { x: -1625.0, z: 740.0, nameJa: "山手神泉交差点", nameEn: "Yamate Shinsen" },
  { x: -974.8, z: 519.7, nameJa: "セルリアンタワー前", nameEn: "Cerulean Tower" },
  { x: -1325.0, z: 151.3, nameJa: "東急本店前交差点", nameEn: "Bunkamura-dori" },
  { x: -1108.1, z: -43.6, nameJa: "渋谷PARCO前", nameEn: "Shibuya PARCO" },
  { x: -1210.0, z: -202.0, nameJa: "渋谷区役所前", nameEn: "Shibuya City Office" },
  { x: -457.3, z: 725.0, nameJa: "渋谷橋交差点", nameEn: "Shibuyabashi" },
];

/**
 * 交差点座標から実在の交差点名（和英併記）を解決する。
 */
export function resolveIntersectionDisplayName(
  x: number,
  z: number,
  fallbackName?: string,
): { nameJa: string; nameEn: string } {
  let best: NamedIntersectionPreset | null = null;
  let bestDist = 42.0;
  for (const preset of KNOWN_INTERSECTION_NAMES) {
    const d = Math.hypot(x - preset.x, z - preset.z);
    if (d < bestDist) {
      bestDist = d;
      best = preset;
    }
  }
  if (best) {
    return { nameJa: best.nameJa, nameEn: best.nameEn };
  }
  const isShibuya = x < -395;
  return {
    nameJa: isShibuya ? "渋谷交差点" : (fallbackName ?? "丸の内交差点"),
    nameEn: isShibuya ? "Shibuya Crossing" : "Marunouchi Crossing",
  };
}

/**
 * 車道全幅（m）から日本の道路規格に適合する信号アーム長を算出する。
 * 1車線細街路では対向車線へはみ出さず、3車線幹線では走行車線中央寄りへしっかり張り出す。
 */
export function resolveAdaptiveArmLength(carriagewayWidth: number): number {
  if (carriagewayWidth <= 10.5) {
    return 2.9;
  }
  if (carriagewayWidth <= 18.5) {
    return 4.1;
  }
  return 5.0;
}

/**
 * JunctionTopology（任意角度アーム付き）から、日本標準の「遠方左歩道（far-side left sidewalk）」
 * 信号機配置リストを自動生成する。
 *
 * How:
 * - 各アームの外向き単位ベクトル outDir = (sin a, cos a) と左側歩道方向 leftDir = leftNormal2D(outDir) から、
 *   交差点パッド外縁の少し外側（+1.4m）かつ接続道路の歩道上（halfCarriageway + 0.65m）へ支柱を配置する。
 * - rotationY = atan2(-outDir.x, -outDir.z) により、灯器正面が交差点を進入してくるドライバーに正対し、
 *   水平アームが歩道側から車道内側へ正しく張り出す。
 * - 南北系アーム（|cos a| >= |sin a|）を axis_a、東西系アームを axis_b として排他フェーズ群を自動割当する。
 */
export function computeIntersectionSignalPlacements(
  topology: JunctionTopology,
  options: {
    /** 交差点パッド外縁から接続道路歩道方向への後退距離（m） */
    padClearanceM?: number;
    /** 車道外縁（縁石内縁）から歩道上へのオフセット距離（m） */
    sidewalkInsetM?: number;
    /** 歩道支持・車道非侵入のカスタム検証関数 */
    validatePosition?: (x: number, z: number) => boolean;
  } = {},
): TrafficSignalPlacementSpec[] {
  const hasAnyCrosswalk = topology.arms.some((a) => a.hasCrosswalk);
  if (!hasAnyCrosswalk && !topology.isScramble) {
    return [];
  }
  if (topology.arms.length < 2) {
    return [];
  }

  const padClearance = options.padClearanceM ?? 1.45;
  const sidewalkInset = options.sidewalkInsetM ?? 0.65;
  const labels = resolveIntersectionDisplayName(topology.x, topology.z, topology.name);
  const specs: TrafficSignalPlacementSpec[] = [];

  for (const arm of topology.arms) {
    const outX = Math.sin(arm.angleRad);
    const outZ = Math.cos(arm.angleRad);
    const leftDir = leftNormal2D(outX, outZ);
    const halfCarry = arm.carriagewayWidth * 0.5;

    const px = arm.entryPoint.x + outX * padClearance + leftDir.x * (halfCarry + sidewalkInset);
    const pz = arm.entryPoint.z + outZ * padClearance + leftDir.z * (halfCarry + sidewalkInset);

    if (options.validatePosition && !options.validatePosition(px, pz)) {
      continue;
    }

    // 交差点を越えて進行してくるドライバー（travelDir = outDir）へ正対するヨー角
    const rotationY = Math.atan2(-outX, -outZ);
    const isPrimaryNS = Math.abs(outZ) >= Math.abs(outX);
    const axisGroup: SignalAxisGroup = isPrimaryNS ? "axis_a" : "axis_b";
    const isMajorArterialArm = arm.inboundLaneCount >= 2 && topology.arms.length >= 3;

    specs.push({
      id: `${topology.id}_sig_${arm.armId}`,
      intersectionId: topology.id,
      axisGroup,
      x: px,
      z: pz,
      rotationY,
      armLengthMeters: resolveAdaptiveArmLength(arm.carriagewayWidth),
      intersectionNameJa: labels.nameJa,
      intersectionNameEn: labels.nameEn,
      showArrowSignal: isMajorArterialArm && !topology.isScramble,
      hasDualPedestrianHeads: topology.arms.length >= 3,
      isScramble: topology.isScramble,
    });
  }

  return specs;
}

/**
 * 既存の個別交差点信号（渋谷放射道路の歩道角信号等）を最寄りの JunctionTopology へ紐付け、
 * 排他制御グループ（axis_a / axis_b）とスクランブル判定を自動解決する。
 */
export function resolveSignalIntersectionBinding(
  x: number,
  z: number,
  rotationY: number,
  junctions: ReadonlyArray<JunctionTopology>,
): {
  intersectionId: string;
  axisGroup: SignalAxisGroup;
  isScramble: boolean;
  phaseOffsetSec: number;
} {
  let nearest: JunctionTopology | null = null;
  let bestDist = 48.0;
  for (const j of junctions) {
    const d = Math.hypot(x - j.x, z - j.z);
    if (d < bestDist) {
      bestDist = d;
      nearest = j;
    }
  }

  // 灯器正面（ローカル +Z）のワールド向きベクトルから主軸(NS) / 交差軸(EW) を判定
  const faceX = Math.sin(rotationY);
  const faceZ = Math.cos(rotationY);
  const axisGroup: SignalAxisGroup = Math.abs(faceZ) >= Math.abs(faceX) ? "axis_a" : "axis_b";

  if (!nearest) {
    const gridKey = `standalone_${Math.round(x / 60)}_${Math.round(z / 60)}`;
    const hashOffset = Math.abs(Math.round(x * 0.17 + z * 0.13)) % 24;
    return {
      intersectionId: gridKey,
      axisGroup,
      isScramble: false,
      phaseOffsetSec: hashOffset,
    };
  }

  // グリーンウェーブ風オフセット（交差点座標から決定的に算出）
  const phaseOffsetSec = Math.abs(Math.round(nearest.x * 0.09 + nearest.z * 0.07)) % 26;
  return {
    intersectionId: nearest.id,
    axisGroup,
    isScramble: nearest.isScramble,
    phaseOffsetSec,
  };
}

function closestPointOnPolyline2D(
  px: number,
  pz: number,
  pts: ReadonlyArray<Point2D>,
): { distSq: number; cx: number; cz: number } {
  let bestDistSq = Infinity;
  let bestCx = px;
  let bestCz = pz;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const t =
      lenSq > 1e-8 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    const dSq = (px - cx) ** 2 + (pz - cz) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestCx = cx;
      bestCz = cz;
    }
  }
  return { distSq: bestDistSq, cx: bestCx, cz: bestCz };
}

function distanceToRoadwayGeometry2D(
  px: number,
  pz: number,
  roadPolylines: ReadonlyArray<ReadonlyArray<Point2D>>,
  junctionPolygons: ReadonlyArray<ReadonlyArray<Point2D>>,
): { dist: number; nearestX: number; nearestZ: number } {
  let bestDistSq = Infinity;
  let nearestX = px;
  let nearestZ = pz;
  for (const line of roadPolylines) {
    if (line.length < 2) {
      continue;
    }
    const res = closestPointOnPolyline2D(px, pz, line);
    if (res.distSq < bestDistSq) {
      bestDistSq = res.distSq;
      nearestX = res.cx;
      nearestZ = res.cz;
    }
  }
  if (bestDistSq <= 24.0 * 24.0) {
    return {
      dist: Math.sqrt(bestDistSq),
      nearestX,
      nearestZ,
    };
  }
  for (const poly of junctionPolygons) {
    if (poly.length >= 3 && isPointInPolygon2D(px, pz, poly)) {
      return { dist: 0, nearestX: px, nearestZ: pz };
    }
    if (poly.length < 3) {
      continue;
    }
    const closedPoly = [...poly, poly[0]];
    const res = closestPointOnPolyline2D(px, pz, closedPoly);
    if (res.distSq < bestDistSq) {
      bestDistSq = res.distSq;
      nearestX = res.cx;
      nearestZ = res.cz;
    }
  }
  return {
    dist: Math.sqrt(bestDistSq),
    nearestX,
    nearestZ,
  };
}

/**
 * 歩道上に設置された信号柱のヨー角を検証し、水平アーム（ローカル +X = (cos yaw, -sin yaw)）が
 * 必ず車道／交差点側へ張り出すように補正する。
 *
 * How:
 * - 候補角のままアーム先端方向へ 1.5m 進んだ点が車道中心線・交差点ポリゴンへ近づくならそのまま維持する。
 * - 180°反転で車道側へ近づくなら +π 反転して日本標準の遠方左歩道向きへ修正する。
 * - どちらも車道と平行（歩道沿い）になる場合は、最寄り車道中心への単位ベクトル (ux, uz) へ
 *   アームが直交張り出しする atan2(-uz, ux) へスナップする。
 */
export function alignSignalYawToRoadOverhang(
  x: number,
  z: number,
  candidateRotY: number,
  roadPolylines: ReadonlyArray<ReadonlyArray<Point2D>>,
  junctionPolygons: ReadonlyArray<ReadonlyArray<Point2D>> = [],
): number {
  const poleSample = distanceToRoadwayGeometry2D(x, z, roadPolylines, junctionPolygons);
  if (!Number.isFinite(poleSample.dist) || poleSample.dist < 0.2) {
    return candidateRotY;
  }

  const probeDist = 1.5;
  const evalProbeDelta = (yaw: number): number => {
    const armX = Math.cos(yaw);
    const armZ = -Math.sin(yaw);
    const probe = distanceToRoadwayGeometry2D(
      x + armX * probeDist,
      z + armZ * probeDist,
      roadPolylines,
      junctionPolygons,
    );
    return poleSample.dist - probe.dist;
  };

  const currentGain = evalProbeDelta(candidateRotY);
  const flippedYaw = candidateRotY + Math.PI;
  const flippedGain = evalProbeDelta(flippedYaw);

  const isCurrentPointingToRoad = currentGain >= 0.35;
  if (isCurrentPointingToRoad) {
    return candidateRotY;
  }
  const isFlippedPointingToRoad = flippedGain >= 0.35;
  if (isFlippedPointingToRoad) {
    return flippedYaw;
  }

  // 歩道と平行だった場合：最寄り車道中心点へ向かう単位ベクトルへ水平アーム (+X) を一致させる
  const toRoadX = poleSample.nearestX - x;
  const toRoadZ = poleSample.nearestZ - z;
  const toRoadLen = Math.hypot(toRoadX, toRoadZ);
  if (toRoadLen <= 1e-4) {
    return candidateRotY;
  }
  const ux = toRoadX / toRoadLen;
  const uz = toRoadZ / toRoadLen;
  return Math.atan2(-uz, ux);
}

import {
  RoadLaneProfileSchema,
  type BoundaryLineStyle,
  type CenterFeatureType,
  type LaneArrowType,
  type LaneDefinition,
  type LaneSection,
  type RightTurnPocketPlacement,
  type RoadLaneCatalogEntry,
  type RoadLaneProfile,
} from "./laneSchema";
import type { JapaneseRoadSegmentConfig } from "../types";

export interface EvaluatedLaneSlot {
  id: string;
  direction: "inbound" | "oncoming";
  laneIndex: number;
  innerOffset: number;
  outerOffset: number;
  centerOffset: number;
  width: number;
  arrow: LaneArrowType;
  outerLineStyle: BoundaryLineStyle;
  speedLimit: number;
  hasStopText: boolean;
}

export interface EvaluatedLaneCrossSection {
  s: number;
  centerFeature: CenterFeatureType;
  medianHalfWidth: number;
  inboundLanes: EvaluatedLaneSlot[];
  oncomingLanes: EvaluatedLaneSlot[];
  /** 車線境界線の横方向オフセットと線種（中央線・路肩線を除く） */
  dividers: Array<{
    direction: "inbound" | "oncoming";
    laneBoundaryIndex: number;
    offset: number;
    style: BoundaryLineStyle;
  }>;
  shoulderLeftOffset: number;
  shoulderRightOffset: number;
}

/**
 * 日本の左側通行における標準的な進行方向別通行区分矢印（内側から外側へ index 0..n-1）を解決する。
 * - 片側1車線: ["straight-left"]
 * - 片側2車線: ["straight-right", "straight-left"]（標識令327の7・明治通り看板と完全一致）
 * - 片側3車線以上: ["right", "straight", ..., "straight-left"]
 */
export function resolveDefaultLaneArrow(laneIndex: number, totalLanes: number): LaneArrowType {
  const isSingleLane = totalLanes <= 1;
  if (isSingleLane) {
    return "straight-left";
  }
  const isTwoLane = totalLanes === 2;
  if (isTwoLane) {
    return laneIndex === 0 ? "straight-right" : "straight-left";
  }
  const isInnermost = laneIndex === 0;
  if (isInnermost) {
    return "right";
  }
  const isOutermost = laneIndex === totalLanes - 1;
  if (isOutermost) {
    return "straight-left";
  }
  return "straight";
}

/**
 * ドライバーから見た「左端車線 → 右端車線」の順で進行方向矢印配列を返す。
 * Why 逆順（index n-1 -> 0）にするか:
 * 日本の左側通行では、進行方向に向かって左端が歩道側の最外車線（index = n-1）、
 * 右端が中央線側の最内車線（index = 0）となるため。
 * 進行方向別通行区分標識（327の7）はこの配列をそのまま左から右へ描画する。
 */
export function resolveDriverLeftToRightArrows(
  lanes: ReadonlyArray<LaneDefinition>,
): LaneArrowType[] {
  const total = lanes.length;
  const result: LaneArrowType[] = [];
  for (let i = total - 1; i >= 0; i--) {
    const lane = lanes[i];
    result.push(lane.arrow ?? resolveDefaultLaneArrow(i, total));
  }
  return result;
}

function buildDirectionLanes(
  direction: "inbound" | "oncoming",
  count: number,
  laneWidth: number,
  speedLimit: number,
  arrowOverrides?: ReadonlyArray<LaneArrowType>,
  hasStopText = false,
): LaneDefinition[] {
  const lanes: LaneDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const arrow = arrowOverrides?.[i] ?? resolveDefaultLaneArrow(i, count);
    lanes.push({
      id: `${direction}_${i}`,
      width: laneWidth,
      arrow,
      outerLineStyle: i < count - 1 ? "white_dashed" : "white_solid",
      speedLimit,
      hasStopText,
    });
  }
  return lanes;
}

function resolveBaseCenterFeature(
  config: JapaneseRoadSegmentConfig,
  inboundCount: number,
  oncomingCount: number,
  medianWidth: number,
  catalogEntry?: RoadLaneCatalogEntry,
): CenterFeatureType {
  if (catalogEntry?.centerFeatureOverride) {
    return catalogEntry.centerFeatureOverride;
  }
  const isOneWay = inboundCount === 0 || oncomingCount === 0;
  const hasCenterLine = config.hasCenterLine ?? true;
  if (isOneWay || !hasCenterLine) {
    return "none";
  }
  if (medianWidth > 0) {
    return "raised_median";
  }
  if (config.hasDoubleYellowCenterLine) {
    return "double_yellow";
  }
  const isMultiLane = Math.max(inboundCount, oncomingCount) >= 2;
  if (isMultiLane) {
    return "white_solid";
  }
  if (config.hasYellowCenterLine) {
    return "yellow_solid";
  }
  return "white_dashed";
}

/**
 * 既存の車道半幅（halfDriveableWidth）を不変に保ったまま、
 * 中央分離帯／導流帯の絞り込みと直進車線幅の微調整（最小 2.75m）によって
 * 右折専用ポケット車線（width ~2.9m, arrow: "right"）を収める断面を構築する。
 */
function createRightTurnPocketLanes(
  baseLanes: ReadonlyArray<LaneDefinition>,
  halfDriveableWidth: number,
  shoulderWidth: number,
  direction: "inbound" | "oncoming",
  speedLimit: number,
): { lanes: LaneDefinition[]; medianWidth: number } | null {
  const throughCount = baseLanes.length;
  if (throughCount < 2) {
    return null;
  }
  // 歩道側路肩（交差点部最小 0.5m）を確保しつつ、中央分離帯を右折ポケット部でペイント中央線へ絞り込んで
  // 既存の halfDriveableWidth（縁石・歩道位置）を一切変えずに右折専用車線を収める（道路構造令 第4種交差点特例準拠）
  const shrunkMedian = 0;
  const effectiveShoulder = Math.min(shoulderWidth, 0.5);
  const availableSideWidth = halfDriveableWidth - effectiveShoulder - shrunkMedian * 0.5;
  const targetPocketWidth = 2.75;
  const minThroughWidth = 2.75;

  const remainingForThrough = availableSideWidth - targetPocketWidth;
  const throughWidth = remainingForThrough / throughCount;
  if (throughWidth < minThroughWidth) {
    // 車道半幅が狭すぎて歩道・縁石を変えずに物理的に追加できない場合は安全にスキップ
    return null;
  }

  const clampedThroughWidth = Math.min(3.35, throughWidth);
  const pocketLanes: LaneDefinition[] = [
    {
      id: `${direction}_rt_pocket`,
      width: targetPocketWidth,
      arrow: "right",
      outerLineStyle: "yellow_solid",
      speedLimit,
    },
  ];
  for (let i = 0; i < throughCount; i++) {
    const isOutermost = i === throughCount - 1;
    pocketLanes.push({
      id: `${direction}_thru_${i}`,
      width: clampedThroughWidth,
      arrow: isOutermost ? "straight-left" : "straight",
      outerLineStyle: isOutermost ? "white_solid" : "white_dashed",
      speedLimit,
    });
  }

  return {
    lanes: pocketLanes,
    medianWidth: shrunkMedian,
  };
}

function applyRightTurnPocketsToSections(
  baseSection: LaneSection,
  totalLength: number,
  halfDriveableWidth: number,
  shoulderWidth: number,
  pockets: ReadonlyArray<RightTurnPocketPlacement>,
  speedLimit: number,
  startClearanceM = 6.0,
  endClearanceM = 6.0,
): LaneSection[] {
  if (pockets.length === 0 || totalLength < 70) {
    return [baseSection];
  }

  // 右折ポケットは各区間の重なりを避けるため弧長上の明示区間へ分解して構築する
  interface PocketInterval {
    chevronStart: number;
    chevronEnd: number;
    pocketStart: number;
    pocketEnd: number;
    direction: "inbound" | "oncoming";
  }

  const resolvedIntervals: PocketInterval[] = [];
  for (const p of pockets) {
    const pocketLen = Math.min(p.pocketLengthM, totalLength * 0.28);
    const chevronLen = Math.min(p.chevronTaperLengthM, totalLength * 0.16);
    if (p.anchor === "end") {
      // 終端交差点の停止線直前へ向かう inbound（+s 進行）のアプローチ
      const pocketEnd = Math.max(24.0, totalLength - endClearanceM);
      const pocketStart = pocketEnd - pocketLen;
      const chevronEnd = pocketStart;
      const chevronStart = Math.max(8.0, chevronEnd - chevronLen);
      if (pocketStart > chevronStart + 4.0) {
        resolvedIntervals.push({
          chevronStart,
          chevronEnd,
          pocketStart,
          pocketEnd,
          direction: p.direction,
        });
      }
    } else if (p.anchor === "start") {
      // 始端交差点の停止線直前へ向かう oncoming（-s 進行）のアプローチ
      const pocketStart = Math.min(totalLength - 24.0, startClearanceM);
      const pocketEnd = pocketStart + pocketLen;
      const chevronStart = pocketEnd;
      const chevronEnd = Math.min(totalLength - 8.0, chevronStart + chevronLen);
      if (chevronEnd > pocketEnd + 4.0) {
        resolvedIntervals.push({
          chevronStart,
          chevronEnd,
          pocketStart,
          pocketEnd,
          direction: p.direction,
        });
      }
    } else if (p.arcPosition !== undefined) {
      const targetS = Math.max(24.0, Math.min(totalLength - 24.0, p.arcPosition));
      if (p.direction === "inbound") {
        const pocketEnd = targetS;
        const pocketStart = Math.max(12.0, pocketEnd - pocketLen);
        const chevronEnd = pocketStart;
        const chevronStart = Math.max(4.0, chevronEnd - chevronLen);
        if (pocketEnd - pocketStart >= 10.0 && chevronEnd - chevronStart >= 6.0) {
          resolvedIntervals.push({
            chevronStart,
            chevronEnd,
            pocketStart,
            pocketEnd,
            direction: "inbound",
          });
        }
      } else {
        const pocketStart = targetS;
        const pocketEnd = Math.min(totalLength - 12.0, pocketStart + pocketLen);
        const chevronStart = pocketEnd;
        const chevronEnd = Math.min(totalLength - 4.0, chevronStart + chevronLen);
        if (pocketEnd - pocketStart >= 10.0 && chevronEnd - chevronStart >= 6.0) {
          resolvedIntervals.push({
            chevronStart,
            chevronEnd,
            pocketStart,
            pocketEnd,
            direction: "oncoming",
          });
        }
      }
    }
  }

  if (resolvedIntervals.length === 0) {
    return [baseSection];
  }

  // 全ブレイクポイントを収集し、昇順の非重複セクション列へ分割する
  const breakSet = new Set<number>([0, totalLength]);
  for (const iv of resolvedIntervals) {
    breakSet.add(Number(iv.chevronStart.toFixed(3)));
    breakSet.add(Number(iv.chevronEnd.toFixed(3)));
    breakSet.add(Number(iv.pocketStart.toFixed(3)));
    breakSet.add(Number(iv.pocketEnd.toFixed(3)));
  }
  const breaks = Array.from(breakSet)
    .filter((s) => s >= 0 && s <= totalLength)
    .sort((a, b) => a - b);

  const sections: LaneSection[] = [];
  for (let i = 0; i < breaks.length - 1; i++) {
    const sStart = breaks[i];
    const sEnd = breaks[i + 1];
    if (sEnd - sStart < 1.0) {
      continue;
    }
    const mid = (sStart + sEnd) * 0.5;

    let inboundLanes = baseSection.inboundLanes;
    let oncomingLanes = baseSection.oncomingLanes;
    let centerFeature = baseSection.centerFeature;
    let medianWidth = baseSection.medianWidth;
    let hasRightTurnPocketInbound = false;
    let hasRightTurnPocketOncoming = false;

    for (const iv of resolvedIntervals) {
      const inChevron = mid >= iv.chevronStart && mid <= iv.chevronEnd;
      const inPocket = mid >= iv.pocketStart && mid <= iv.pocketEnd;

      if (inChevron) {
        centerFeature = "zebra_chevron";
        medianWidth = Math.max(medianWidth, 1.4);
      }

      if (inPocket) {
        if (iv.direction === "inbound") {
          const expanded = createRightTurnPocketLanes(
            baseSection.inboundLanes,
            halfDriveableWidth,
            shoulderWidth,
            "inbound",
            speedLimit,
          );
          if (expanded) {
            inboundLanes = expanded.lanes;
            medianWidth = Math.min(medianWidth, expanded.medianWidth);
            if (centerFeature === "raised_median" || centerFeature === "zebra_chevron") {
              centerFeature = "white_solid";
            }
            hasRightTurnPocketInbound = true;
          }
        } else {
          const expanded = createRightTurnPocketLanes(
            baseSection.oncomingLanes,
            halfDriveableWidth,
            shoulderWidth,
            "oncoming",
            speedLimit,
          );
          if (expanded) {
            oncomingLanes = expanded.lanes;
            medianWidth = Math.min(medianWidth, expanded.medianWidth);
            if (centerFeature === "raised_median" || centerFeature === "zebra_chevron") {
              centerFeature = "white_solid";
            }
            hasRightTurnPocketOncoming = true;
          }
        }
      }
    }

    sections.push({
      sStart,
      sEnd,
      centerFeature,
      medianWidth,
      inboundLanes,
      oncomingLanes,
      hasRightTurnPocketInbound,
      hasRightTurnPocketOncoming,
      taperLengthM: 12.0,
      noLaneChangeLengthM: 14.0,
    });
  }

  return sections.length > 0 ? sections : [baseSection];
}

/**
 * 任意の道路セグメント設定（直線・曲線共通）とカタログ上書き定義から、
 * Zod 検証済みの統一 RoadLaneProfile（SSOT）を生成する。
 */
export function buildRoadLaneProfile(
  config: JapaneseRoadSegmentConfig,
  totalLength: number,
  options: {
    roadId?: string;
    crosswalkArcs?: ReadonlyArray<number>;
    catalogEntry?: RoadLaneCatalogEntry;
    startClearanceM?: number;
    endClearanceM?: number;
  } = {},
): RoadLaneProfile {
  const safeLength = Math.max(2.0, totalLength);
  const laneWidth = Math.max(2.5, config.laneWidth);
  const shoulderWidth = Math.max(0, config.shoulderWidth);
  const medianWidth = Math.max(0, config.medianWidth ?? 0);
  const catalog = options.catalogEntry;

  const baseLanesPerDir = Math.max(1, Math.floor(config.lanesPerDirection));
  const inboundCount = catalog?.inboundLaneCount ?? baseLanesPerDir;
  const oncomingCount = catalog?.oncomingLaneCount ?? baseLanesPerDir;
  const speedLimit = catalog?.speedLimitOverride ?? config.speedLimitSign ?? 40;
  const hasStopText = Boolean(config.hasStopText || catalog?.hasStopTextOnApproaches);

  // 既存の道路断面システム（roadCrossSection.ts）と一致する不変の車道半幅
  const halfDriveableWidth =
    Math.max(baseLanesPerDir, inboundCount, oncomingCount) * laneWidth +
    shoulderWidth +
    medianWidth * 0.5;

  const centerFeature = resolveBaseCenterFeature(
    config,
    inboundCount,
    oncomingCount,
    medianWidth,
    catalog,
  );

  const inboundLanes = buildDirectionLanes(
    "inbound",
    inboundCount,
    laneWidth,
    speedLimit,
    catalog?.inboundArrows,
    hasStopText,
  );
  const oncomingLanes = buildDirectionLanes(
    "oncoming",
    oncomingCount,
    laneWidth,
    speedLimit,
    catalog?.oncomingArrows,
    hasStopText,
  );

  const baseSection: LaneSection = {
    sStart: 0,
    sEnd: safeLength,
    centerFeature,
    medianWidth,
    inboundLanes,
    oncomingLanes,
    taperLengthM: 12.0,
    noLaneChangeLengthM: 14.0,
  };

  const pockets = catalog?.rightTurnPockets ?? [];
  const sections =
    pockets.length > 0
      ? applyRightTurnPocketsToSections(
          baseSection,
          safeLength,
          halfDriveableWidth,
          shoulderWidth,
          pockets,
          speedLimit,
          options.startClearanceM ?? 6.0,
          options.endClearanceM ?? 6.0,
        )
      : [baseSection];

  const crosswalkArcs = (options.crosswalkArcs ?? []).filter((s) => s >= 0 && s <= safeLength);

  return RoadLaneProfileSchema.parse({
    roadId: options.roadId ?? config.name ?? "unnamed-road",
    roadName: config.name ?? options.roadId ?? "unnamed-road",
    totalLength: safeLength,
    halfDriveableWidth,
    shoulderWidth,
    sections,
    crosswalkArcs,
    stopOnlyArcs: [],
    hasShoulderLines: config.hasShoulderLines ?? true,
    hasWhiteDashedLines: config.hasWhiteDashedLines ?? true,
    speedLimit,
  });
}

function findSectionAtArc(profile: RoadLaneProfile, s: number): LaneSection {
  const clamped = Math.max(0, Math.min(profile.totalLength, s));
  for (const sec of profile.sections) {
    if (clamped >= sec.sStart && clamped <= sec.sEnd) {
      return sec;
    }
  }
  return profile.sections[profile.sections.length - 1];
}

/**
 * 弧長 s における車線断面（各車線の内側・外側オフセット、中心オフセット、車線境界線オフセット）を評価する。
 * セクション境界では滑らかな S 字（smoothstep）補間を行い、白線の不連続ジャンプを防ぐ。
 */
export function evaluateLaneCrossSectionAt(
  profile: RoadLaneProfile,
  s: number,
): EvaluatedLaneCrossSection {
  const clampedS = Math.max(0, Math.min(profile.totalLength, s));
  const sec = findSectionAtArc(profile, clampedS);
  const medianHalf = sec.medianWidth * 0.5;

  // 一方通行道路の場合は車道中心を軸に対称展開する
  const isInboundOnly = sec.inboundLanes.length > 0 && sec.oncomingLanes.length === 0;
  const isOncomingOnly = sec.oncomingLanes.length > 0 && sec.inboundLanes.length === 0;

  const inboundLanes: EvaluatedLaneSlot[] = [];
  const oncomingLanes: EvaluatedLaneSlot[] = [];
  const dividers: EvaluatedLaneCrossSection["dividers"] = [];

  if (isInboundOnly) {
    const totalW = sec.inboundLanes.reduce((sum, l) => sum + l.width, 0);
    let cursor = -totalW * 0.5;
    for (let i = 0; i < sec.inboundLanes.length; i++) {
      const lane = sec.inboundLanes[i];
      const inner = cursor;
      const outer = cursor + lane.width;
      const style =
        lane.outerLineStyle ?? (i < sec.inboundLanes.length - 1 ? "white_dashed" : "white_solid");
      inboundLanes.push({
        id: lane.id,
        direction: "inbound",
        laneIndex: i,
        innerOffset: inner,
        outerOffset: outer,
        centerOffset: (inner + outer) * 0.5,
        width: lane.width,
        arrow: lane.arrow ?? resolveDefaultLaneArrow(i, sec.inboundLanes.length),
        outerLineStyle: style,
        speedLimit: lane.speedLimit ?? profile.speedLimit,
        hasStopText: Boolean(lane.hasStopText),
      });
      if (i < sec.inboundLanes.length - 1) {
        dividers.push({
          direction: "inbound",
          laneBoundaryIndex: i,
          offset: outer,
          style,
        });
      }
      cursor = outer;
    }
  } else if (isOncomingOnly) {
    const totalW = sec.oncomingLanes.reduce((sum, l) => sum + l.width, 0);
    let cursor = totalW * 0.5;
    for (let i = 0; i < sec.oncomingLanes.length; i++) {
      const lane = sec.oncomingLanes[i];
      const inner = cursor;
      const outer = cursor - lane.width;
      const style =
        lane.outerLineStyle ?? (i < sec.oncomingLanes.length - 1 ? "white_dashed" : "white_solid");
      oncomingLanes.push({
        id: lane.id,
        direction: "oncoming",
        laneIndex: i,
        innerOffset: inner,
        outerOffset: outer,
        centerOffset: (inner + outer) * 0.5,
        width: lane.width,
        arrow: lane.arrow ?? resolveDefaultLaneArrow(i, sec.oncomingLanes.length),
        outerLineStyle: style,
        speedLimit: lane.speedLimit ?? profile.speedLimit,
        hasStopText: Boolean(lane.hasStopText),
      });
      if (i < sec.oncomingLanes.length - 1) {
        dividers.push({
          direction: "oncoming",
          laneBoundaryIndex: i,
          offset: outer,
          style,
        });
      }
      cursor = outer;
    }
  } else {
    // 対面交通（+normal = inbound 自車進行方向 / -normal = oncoming 対向方向）
    let inCursor = medianHalf;
    for (let i = 0; i < sec.inboundLanes.length; i++) {
      const lane = sec.inboundLanes[i];
      const inner = inCursor;
      const outer = inCursor + lane.width;
      const style =
        lane.outerLineStyle ?? (i < sec.inboundLanes.length - 1 ? "white_dashed" : "white_solid");
      inboundLanes.push({
        id: lane.id,
        direction: "inbound",
        laneIndex: i,
        innerOffset: inner,
        outerOffset: outer,
        centerOffset: (inner + outer) * 0.5,
        width: lane.width,
        arrow: lane.arrow ?? resolveDefaultLaneArrow(i, sec.inboundLanes.length),
        outerLineStyle: style,
        speedLimit: lane.speedLimit ?? profile.speedLimit,
        hasStopText: Boolean(lane.hasStopText),
      });
      if (i < sec.inboundLanes.length - 1) {
        dividers.push({
          direction: "inbound",
          laneBoundaryIndex: i,
          offset: outer,
          style,
        });
      }
      inCursor = outer;
    }

    let onCursor = -medianHalf;
    for (let i = 0; i < sec.oncomingLanes.length; i++) {
      const lane = sec.oncomingLanes[i];
      const inner = onCursor;
      const outer = onCursor - lane.width;
      const style =
        lane.outerLineStyle ?? (i < sec.oncomingLanes.length - 1 ? "white_dashed" : "white_solid");
      oncomingLanes.push({
        id: lane.id,
        direction: "oncoming",
        laneIndex: i,
        innerOffset: inner,
        outerOffset: outer,
        centerOffset: (inner + outer) * 0.5,
        width: lane.width,
        arrow: lane.arrow ?? resolveDefaultLaneArrow(i, sec.oncomingLanes.length),
        outerLineStyle: style,
        speedLimit: lane.speedLimit ?? profile.speedLimit,
        hasStopText: Boolean(lane.hasStopText),
      });
      if (i < sec.oncomingLanes.length - 1) {
        dividers.push({
          direction: "oncoming",
          laneBoundaryIndex: i,
          offset: outer,
          style,
        });
      }
      onCursor = outer;
    }
  }

  const shoulderOffset = Math.max(1.5, profile.halfDriveableWidth - profile.shoulderWidth);
  return {
    s: clampedS,
    centerFeature: sec.centerFeature,
    medianHalfWidth: medianHalf,
    inboundLanes,
    oncomingLanes,
    dividers,
    shoulderLeftOffset: -shoulderOffset,
    shoulderRightOffset: shoulderOffset,
  };
}

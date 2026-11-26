import { z } from "zod";

/**
 * 統一車線システム（Unified Lane System）の Zod スキーマ＆型定義（SSOT）
 *
 * - Why OpenDRIVE 風の「弧長セクション付きレーンプロファイル」を採用するか:
 *   直線道路・曲線道路・交差点を単一の中心線フレーム列（RoadFrame）上で統一的に扱い、
 *   標準の対称道路（lanesPerDirection）は自動展開で簡潔に保ちつつ、
 *   上下非対称車線・一方通行・交差点手前の右折ポケット（中央ゼブラ導流帯＋テーパー拡幅）・
 *   路面「止まれ」標示・進行方向別通行区分標識との完全同期を 1 つの真実源で表現するため。
 */

export const LaneArrowTypeSchema = z.enum([
  "straight",
  "left",
  "right",
  "straight-left",
  "straight-right",
  "left-right",
  "straight-left-right",
]);
export type LaneArrowType = z.infer<typeof LaneArrowTypeSchema>;

export const BoundaryLineStyleSchema = z.enum([
  "none",
  "white_dashed",
  "white_solid",
  "yellow_solid",
  "double_yellow",
  "double_white",
]);
export type BoundaryLineStyle = z.infer<typeof BoundaryLineStyleSchema>;

export const CenterFeatureTypeSchema = z.enum([
  "none",
  "white_solid",
  "white_dashed",
  "yellow_solid",
  "double_yellow",
  "raised_median",
  "zebra_chevron",
]);
export type CenterFeatureType = z.infer<typeof CenterFeatureTypeSchema>;

export const LaneDefinitionSchema = z.object({
  id: z.string().min(1),
  width: z.number().min(2.2).max(5.5),
  arrow: LaneArrowTypeSchema.optional(),
  outerLineStyle: BoundaryLineStyleSchema.optional(),
  speedLimit: z.number().int().min(20).max(100).optional(),
  hasStopText: z.boolean().optional(),
});
export type LaneDefinition = z.infer<typeof LaneDefinitionSchema>;

export const LaneSectionSchema = z
  .object({
    sStart: z.number().min(0),
    sEnd: z.number().positive(),
    centerFeature: CenterFeatureTypeSchema,
    medianWidth: z.number().min(0).max(12),
    /**
     * 日本の左側通行（+tangent 進行方向 = +normal 側、index 0 = 中央寄り最内車線、n-1 = 歩道寄り最外車線）
     * 一方通行（逆方向のみ）の場合は空配列を許容する。
     */
    inboundLanes: z.array(LaneDefinitionSchema),
    /**
     * 対向方向（-tangent 進行方向 = -normal 側、index 0 = 中央寄り最内車線、n-1 = 歩道寄り最外車線）
     * 一方通行（順方向のみ）の場合は空配列を許容する。
     */
    oncomingLanes: z.array(LaneDefinitionSchema),
    hasRightTurnPocketInbound: z.boolean().optional(),
    hasRightTurnPocketOncoming: z.boolean().optional(),
    taperLengthM: z.number().min(0).max(40).optional(),
    noLaneChangeLengthM: z.number().min(0).max(35).optional(),
  })
  .refine((val) => val.sEnd > val.sStart, {
    message: "LaneSection sEnd must be greater than sStart",
  })
  .refine((val) => val.inboundLanes.length + val.oncomingLanes.length >= 1, {
    message: "LaneSection must have at least one lane",
  });
export type LaneSection = z.infer<typeof LaneSectionSchema>;

export const StopOnlyArcSchema = z.object({
  s: z.number().min(0),
  direction: z.enum(["inbound", "oncoming"]),
  hasStopText: z.boolean().default(true),
});
export type StopOnlyArc = z.infer<typeof StopOnlyArcSchema>;

export const RoadLaneProfileSchema = z.object({
  roadId: z.string().min(1),
  roadName: z.string().min(1),
  totalLength: z.number().positive(),
  /** 道路断面システム（roadCrossSection.ts）と共有する不変の車道半幅（歩道・縁石との干渉を防ぐ） */
  halfDriveableWidth: z.number().positive(),
  shoulderWidth: z.number().min(0).max(4.0),
  sections: z.array(LaneSectionSchema).min(1),
  crosswalkArcs: z.array(z.number().min(0)),
  stopOnlyArcs: z.array(StopOnlyArcSchema).default([]),
  hasShoulderLines: z.boolean().default(true),
  hasWhiteDashedLines: z.boolean().default(true),
  speedLimit: z.number().int().min(20).max(100).default(40),
});
export type RoadLaneProfile = z.infer<typeof RoadLaneProfileSchema>;

export const RightTurnPocketPlacementSchema = z.object({
  /** 始端側 (start) / 終端側 (end) / 任意弧長 (arc) */
  anchor: z.enum(["start", "end", "arc"]),
  direction: z.enum(["inbound", "oncoming"]),
  arcPosition: z.number().min(0).optional(),
  pocketLengthM: z.number().min(12).max(55).default(24),
  chevronTaperLengthM: z.number().min(8).max(30).default(14),
});
export type RightTurnPocketPlacement = z.infer<typeof RightTurnPocketPlacementSchema>;

export const RoadLaneCatalogEntrySchema = z.object({
  idPattern: z.string().min(1),
  description: z.string().min(1),
  inboundLaneCount: z.number().int().min(0).max(5).optional(),
  oncomingLaneCount: z.number().int().min(0).max(5).optional(),
  inboundArrows: z.array(LaneArrowTypeSchema).optional(),
  oncomingArrows: z.array(LaneArrowTypeSchema).optional(),
  centerFeatureOverride: CenterFeatureTypeSchema.optional(),
  rightTurnPockets: z.array(RightTurnPocketPlacementSchema).optional(),
  hasStopTextOnApproaches: z.boolean().optional(),
  speedLimitOverride: z.number().int().min(20).max(100).optional(),
});
export type RoadLaneCatalogEntry = z.infer<typeof RoadLaneCatalogEntrySchema>;

export const Point2DSchema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
});
export type Point2D = z.infer<typeof Point2DSchema>;

export const JunctionArmTopologySchema = z.object({
  armId: z.string().min(1),
  roadId: z.string().optional(),
  /** 交差点中心からアーム外向きへの方位角 (rad: 0=+Z北/南基準, atan2(dx, dz)) */
  angleRad: z.number().finite(),
  /** 交差点境界ポリゴン上でアーム車道中心が交差する点 */
  entryPoint: Point2DSchema,
  carriagewayWidth: z.number().min(3.0).max(48.0),
  medianWidth: z.number().min(0).max(10.0).default(0),
  inboundLaneCount: z.number().int().min(0).max(5).default(2),
  oncomingLaneCount: z.number().int().min(0).max(5).default(2),
  inboundLaneWidth: z.number().min(2.2).max(4.5).default(3.4),
  oncomingLaneWidth: z.number().min(2.2).max(4.5).default(3.4),
  inboundArrows: z.array(LaneArrowTypeSchema).optional(),
  hasCrosswalk: z.boolean().default(true),
  hasStopLine: z.boolean().default(true),
  hasStopText: z.boolean().default(false),
  /** 交差点中心から横断歩道中心までの距離 (m) */
  crosswalkDistanceFromCenter: z.number().positive(),
  /** 横断歩道の安全最大半幅 (m: 隣接アームとの隅干渉を防ぐ) */
  maxCrosswalkHalfSpan: z.number().positive(),
});
export type JunctionArmTopology = z.infer<typeof JunctionArmTopologySchema>;

export const JunctionTurnGuideArcSchema = z.object({
  fromArmId: z.string().min(1),
  toArmId: z.string().min(1),
  kind: z.enum(["right_turn", "through"]),
  controlPoints: z.array(Point2DSchema).min(3),
});
export type JunctionTurnGuideArc = z.infer<typeof JunctionTurnGuideArcSchema>;

export const JunctionTopologySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  x: z.number().finite(),
  z: z.number().finite(),
  widthX: z.number().positive(),
  depthZ: z.number().positive(),
  /** 交差点内部領域を定義する反時計回り 2D XZ ポリゴン */
  boundaryPolygon: z.array(Point2DSchema).min(4),
  arms: z.array(JunctionArmTopologySchema),
  isScramble: z.boolean().default(false),
  hasCenterDiamond: z.boolean().default(true),
  hasGuideDots: z.boolean().default(true),
  turnGuideArcs: z.array(JunctionTurnGuideArcSchema).default([]),
});
export type JunctionTopology = z.infer<typeof JunctionTopologySchema>;

/**
 * 将来の AI トラフィック・車載ナビ車線案内・デバッグ可視化向けの構造化車線グラフ（SSOT）
 */
export interface LaneCenterlineSample {
  x: number;
  y: number;
  z: number;
  s: number;
  tx: number;
  tz: number;
  width: number;
}

export interface LaneGraphEdge {
  laneId: string;
  roadId: string;
  roadName: string;
  direction: "inbound" | "oncoming";
  laneIndex: number;
  arrow: LaneArrowType;
  speedLimit: number;
  leftAdjacentLaneId: string | null;
  rightAdjacentLaneId: string | null;
  startJunctionId: string | null;
  endJunctionId: string | null;
  samples: LaneCenterlineSample[];
}

export interface JunctionConnectionArc {
  id: string;
  junctionId: string;
  fromArmId: string;
  toArmId: string;
  kind: "right_turn" | "through";
  samples: Array<{ x: number; y: number; z: number }>;
}

export interface LaneGraph {
  version: "1.0.0";
  edges: LaneGraphEdge[];
  junctions: JunctionTopology[];
  junctionArcs: JunctionConnectionArc[];
}

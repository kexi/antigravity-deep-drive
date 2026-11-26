import { z } from "zod";
import { Point2DSchema } from "../lanes/laneSchema";

/**
 * 統一歩道作成システム（Unified Sidewalk Creation System）の Zod スキーマ定義。
 * 国土交通省「道路構造令」および「道路の移動等円滑化整備ガイドライン」（JIS T 9251・縁石切下げ 2cm・横断勾配 1.5%）に準拠する。
 */

export const SidewalkPavingStyleSchema = z.enum([
  "granite_slab",
  "interlocking_brick",
  "concrete_tile",
]);
export type SidewalkPavingStyleValue = z.infer<typeof SidewalkPavingStyleSchema>;

export const SidewalkDistrictPresetIdSchema = z.enum([
  "marunouchi_granite",
  "ginza_promenade",
  "shibuya_brick",
  "imperial_moat",
  "tokyo_concrete",
]);
export type SidewalkDistrictPresetId = z.infer<typeof SidewalkDistrictPresetIdSchema>;

export const SidewalkGuardrailStyleSchema = z.enum([
  "tokyo_white_pipe",
  "marunouchi_dark_bronze",
  "none",
]);
export type SidewalkGuardrailStyle = z.infer<typeof SidewalkGuardrailStyleSchema>;

/**
 * 歩道 1 辺の断面ゾーニング仕様（道路構造令準拠）
 * - L型側溝（車道外縁）→ 面取り縁石 → 植樹・施設帯 → 有効歩行空間 → 民地境界ブロック
 */
export const SidewalkZoneSpecSchema = z.object({
  presetId: SidewalkDistrictPresetIdSchema,
  pavingStyle: SidewalkPavingStyleSchema,
  totalWidthMeters: z.number().min(0).max(20),
  curbWidthMeters: z.number().min(0).max(0.4),
  curbHeightMeters: z.number().min(0.05).max(0.35),
  curbBevelWidthMeters: z.number().min(0.01).max(0.1),
  curbBevelHeightMeters: z.number().min(0.01).max(0.1),
  gutterWidthMeters: z.number().min(0).max(0.5),
  crossSlopeRatio: z.number().min(0).max(0.05),
  furnitureZoneWidthMeters: z.number().min(0).max(6),
  pedestrianClearWidthMeters: z.number().min(0).max(16),
  backCurbWidthMeters: z.number().min(0).max(0.25),
  guardrailStyle: SidewalkGuardrailStyleSchema,
  hasCatchBasins: z.boolean(),
  catchBasinSpacingMeters: z.number().min(8).max(50),
  hasTactileWarningPads: z.boolean(),
});
export type SidewalkZoneSpec = z.infer<typeof SidewalkZoneSpecSchema>;

export const SidewalkKindSchema = z.enum([
  "straight",
  "curved",
  "intersection_corner",
  "intersection_edge",
]);
export type SidewalkKind = z.infer<typeof SidewalkKindSchema>;

export const SidewalkSideTagSchema = z.enum([
  "left",
  "right",
  "corner_NE",
  "corner_NW",
  "corner_SE",
  "corner_SW",
  "edge_North",
  "edge_South",
  "edge_East",
  "edge_West",
]);
export type SidewalkSideTag = z.infer<typeof SidewalkSideTagSchema>;

export const SidewalkSpineSampleSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  tx: z.number().finite(),
  tz: z.number().finite(),
  widthMeters: z.number().positive(),
});
export type SidewalkSpineSample = z.infer<typeof SidewalkSpineSampleSchema>;

export const SidewalkBounds2DSchema = z.object({
  minX: z.number().finite(),
  maxX: z.number().finite(),
  minZ: z.number().finite(),
  maxZ: z.number().finite(),
});
export type SidewalkBounds2D = z.infer<typeof SidewalkBounds2DSchema>;

/**
 * 都市内の 1 連続歩道セグメント／交差点隅切り歩道の構造化レコード（SSOT）
 */
export const SidewalkSegmentRecordSchema = z.object({
  id: z.string().min(1),
  roadId: z.string().min(1),
  roadName: z.string().min(1),
  kind: SidewalkKindSchema,
  side: SidewalkSideTagSchema,
  presetId: SidewalkDistrictPresetIdSchema,
  pavingStyle: SidewalkPavingStyleSchema,
  widthMeters: z.number().positive(),
  curbHeightMeters: z.number().positive(),
  lengthMeters: z.number().positive(),
  areaSqMeters: z.number().positive(),
  rampCount: z.number().int().min(0),
  tactilePadCount: z.number().int().min(0),
  catchBasinCount: z.number().int().min(0),
  hasGuardrail: z.boolean(),
  polygonXZ: z.array(Point2DSchema).min(3),
  walkableSpine: z.array(SidewalkSpineSampleSchema),
  bounds: SidewalkBounds2DSchema,
});
export type SidewalkSegmentRecord = z.infer<typeof SidewalkSegmentRecordSchema>;

export const SidewalkNetworkSummarySchema = z.object({
  version: z.literal("1.0.0"),
  totalSegments: z.number().int().min(0),
  straightSegments: z.number().int().min(0),
  curvedSegments: z.number().int().min(0),
  intersectionCorners: z.number().int().min(0),
  intersectionEdges: z.number().int().min(0),
  totalAreaSqMeters: z.number().min(0),
  totalRampCount: z.number().int().min(0),
  totalTactilePadCount: z.number().int().min(0),
  totalCatchBasinCount: z.number().int().min(0),
  pavingStyleBreakdown: z.record(z.string(), z.number().int().min(0)),
});
export type SidewalkNetworkSummary = z.infer<typeof SidewalkNetworkSummarySchema>;

export interface SidewalkNetwork {
  version: "1.0.0";
  segments: SidewalkSegmentRecord[];
}

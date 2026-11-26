import { z } from "zod";

/**
 * 日本の道路防護柵・安全施設システム（Unified Road Barrier & Safety System）Zod スキーマ定義。
 * 御影石ボラード・反射帯付き車止めポール・道路反射鏡（カーブミラー）・視線誘導標を一元管理する。
 */

export const RoadBarrierTypeSchema = z.enum([
  "granite_bollard",
  "reflective_bollard",
  "convex_curve_mirror",
  "median_delineator",
]);
export type RoadBarrierType = z.infer<typeof RoadBarrierTypeSchema>;

export const RoadBarrierPlacementSchema = z.object({
  id: z.string().min(1),
  type: RoadBarrierTypeSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  rotationY: z.number().finite(),
  mirrorDual: z.boolean().default(false),
  label: z.string().optional(),
});
export type RoadBarrierPlacement = z.infer<typeof RoadBarrierPlacementSchema>;

export const BarrierSummarySchema = z.object({
  version: z.literal("1.0.0"),
  totalBarriers: z.number().int().min(0),
  typeBreakdown: z.record(z.string(), z.number().int().min(0)),
  cachedMaterialCount: z.number().int().min(0),
});
export type BarrierSummary = z.infer<typeof BarrierSummarySchema>;

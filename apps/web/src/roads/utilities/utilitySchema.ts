import { z } from "zod";

/**
 * 日本の路面・地下インフラ・地上機器システム（Unified Road Utility System）Zod スキーマ定義。
 * 東京都下水道桜マンホール・通信電力ハンドホール・無電柱化地上変圧器（地上機器）・赤ポール消火栓標識・街路樹植樹桝を一元管理する。
 */

export const RoadUtilityTypeSchema = z.enum([
  "tokyo_sewer_manhole",
  "telecom_handhole",
  "pad_transformer",
  "fire_hydrant_sign",
  "tree_pit_curb",
]);
export type RoadUtilityType = z.infer<typeof RoadUtilityTypeSchema>;

export const RoadUtilityPlacementSchema = z.object({
  id: z.string().min(1),
  type: RoadUtilityTypeSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  rotationY: z.number().finite(),
  operator: z.string().optional(),
});
export type RoadUtilityPlacement = z.infer<typeof RoadUtilityPlacementSchema>;

export const RoadUtilitySummarySchema = z.object({
  version: z.literal("1.0.0"),
  totalUtilities: z.number().int().min(0),
  typeBreakdown: z.record(z.string(), z.number().int().min(0)),
  cachedMaterialCount: z.number().int().min(0),
});
export type RoadUtilitySummary = z.infer<typeof RoadUtilitySummarySchema>;

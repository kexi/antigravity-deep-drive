import { z } from "zod";

/**
 * 日本の道路照明システム（Unified Road Lighting System）Zod スキーマ定義。
 * 丸の内伝統の2灯ランタン街灯・幹線道路向けLEDコブラ道路照明灯・渋谷モダン歩道街路灯を統一管理する。
 */

export const RoadLampStyleSchema = z.enum([
  "marunouchi_twin_globe",
  "tokyo_arterial_cobra",
  "shibuya_modern_arm",
]);
export type RoadLampStyle = z.infer<typeof RoadLampStyleSchema>;

export const RoadLampPlacementSchema = z.object({
  id: z.string().min(1),
  style: RoadLampStyleSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  rotationY: z.number().finite(),
  poleHeightMeters: z.number().positive(),
  armLengthMeters: z.number().min(0),
  district: z.string().min(1),
});
export type RoadLampPlacement = z.infer<typeof RoadLampPlacementSchema>;

export const RoadLightingSummarySchema = z.object({
  version: z.literal("1.0.0"),
  totalLamps: z.number().int().min(0),
  styleBreakdown: z.record(z.string(), z.number().int().min(0)),
  cachedMaterialCount: z.number().int().min(0),
  nightFactor: z.number().min(0).max(1),
});
export type RoadLightingSummary = z.infer<typeof RoadLightingSummarySchema>;

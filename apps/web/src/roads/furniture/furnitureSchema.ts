import { z } from "zod";

/**
 * 日本の沿道公共交通・都市ストリートファニチャーシステム（Unified Street Furniture System）Zod スキーマ定義。
 * 都営バス／東急バス停留所・赤い郵便ポスト（〒）・街区/地下鉄案内サイン・時間制限パーキングメーター・歩道ベンチを一元管理する。
 */

export const StreetFurnitureTypeSchema = z.enum([
  "bus_stop_toei",
  "bus_stop_tokyu",
  "japan_postbox",
  "district_info_kiosk",
  "parking_meter",
  "sidewalk_bench",
]);
export type StreetFurnitureType = z.infer<typeof StreetFurnitureTypeSchema>;

export const StreetFurniturePlacementSchema = z.object({
  id: z.string().min(1),
  type: StreetFurnitureTypeSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  rotationY: z.number().finite(),
  titleJa: z.string().optional(),
  titleEn: z.string().optional(),
});
export type StreetFurniturePlacement = z.infer<typeof StreetFurniturePlacementSchema>;

export const StreetFurnitureSummarySchema = z.object({
  version: z.literal("1.0.0"),
  totalItems: z.number().int().min(0),
  typeBreakdown: z.record(z.string(), z.number().int().min(0)),
  cachedMaterialCount: z.number().int().min(0),
});
export type StreetFurnitureSummary = z.infer<typeof StreetFurnitureSummarySchema>;

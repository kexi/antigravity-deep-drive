import { z } from "zod";

export const ModelAssetSchema = z.object({
  id: z.string(),
  path: z.string(),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
  offset: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  subparts: z.record(z.string(), z.string()).optional(),
  fallbackColor: z.number().default(0x888888),
});

export const Texture3DAssetSchema = z.object({
  id: z.string(),
  resolution: z.number().int().min(8).max(128).default(32),
  type: z.enum([
    "asphalt_pbr",
    "foliage_bark",
    "architecture_stone",
    "volumetric_fog",
    "volumetric_cloud",
    "crown_interior",
    "road_marking_prop",
    "vehicle_exterior",
    "water_caustics",
  ]),
  roughnessScale: z.number().min(0.1).max(10.0).default(1.0),
});

export const RoadMarkingConfigSchema = z.object({
  centerLineType: z
    .enum(["solid_white", "solid_yellow", "dashed_white", "none"])
    .default("solid_white"),
  hasCrosswalks: z.boolean().default(true),
  hasTactilePaving: z.boolean().default(true),
  hasShoulderLines: z.boolean().default(true),
});

export const RoadPropsConfigSchema = z.object({
  hasGuardrails: z.boolean().default(true),
  hasManholes: z.boolean().default(true),
  hasGratings: z.boolean().default(true),
  hasTrafficLights: z.boolean().default(true),
});

export const RoadDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  center: z.tuple([z.number(), z.number(), z.number()]),
  length: z.number().positive(),
  width: z.number().positive(),
  lanes: z.number().int().positive().default(2),
  speedLimit: z.number().int().positive().default(40),
  hasSidewalk: z.boolean().default(true),
  sidewalkWidth: z.number().default(3.0),
  hasMedian: z.boolean().default(false),
  markings: RoadMarkingConfigSchema.default({
    centerLineType: "solid_yellow",
    hasCrosswalks: true,
    hasTactilePaving: true,
    hasShoulderLines: true,
  }),
  props: RoadPropsConfigSchema.default({
    hasGuardrails: true,
    hasManholes: true,
    hasGratings: true,
    hasTrafficLights: true,
  }),
});

export const RoadSignTypeSchema = z.enum([
  "overhead_guide",
  "speed_limit",
  "stop",
  "no_entry",
  "direction_mandatory",
  "traffic_light_ahead",
  "crosswalk",
  "street_name",
  "no_parking",
  "no_stopping",
  "no_uturn",
  "one_way",
  "lane_direction",
  "intersection_name",
  "delineator",
]);

export const RoadSignPlacementSchema = z.object({
  id: z.string(),
  type: RoadSignTypeSchema,
  position: z.tuple([z.number(), z.number(), z.number()]),
  rotationY: z.number().default(0),
  label: z.string().optional(),
  subLabel: z.string().optional(),
  auxiliaryText: z.string().optional(),
  speedLimit: z.number().int().optional(),
  arrowDirections: z.array(z.string()).optional(),
  leftLabel: z.string().optional(),
  leftSubLabel: z.string().optional(),
  rightLabel: z.string().optional(),
  rightSubLabel: z.string().optional(),
  intersectionName: z.string().optional(),
  roadNumber: z.string().optional(),
  subRoadNumber: z.string().optional(),
  supportType: z.enum(["cantilever", "portal"]).optional(),
  spanWidth: z.number().positive().optional(),
  directionType: z.enum(["straight-left", "straight-right", "straight-only"]).optional(),
});

export const WeatherPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  sunPosition: z.tuple([z.number(), z.number(), z.number()]),
  sunColor: z.number(),
  ambientColor: z.number(),
  skyColor: z.number(),
  fogDensity: z.number().min(0),
  fogColor: z.number(),
  rain: z.object({
    enabled: z.boolean().default(false),
    intensity: z.number().min(0).max(1).default(0),
    wiperSpeed: z.number().min(0).default(0),
    windshieldWetness: z.number().min(0).max(1).default(0),
  }),
  lensflare: z.object({
    enabled: z.boolean().default(true),
    intensity: z.number().min(0).default(1.0),
    color: z.number().default(0xfffaed),
  }),
});

export const AssetManifestSchema = z.object({
  version: z.string().default("1.0.0"),
  name: z.string().default("Tokyo Station Drive Game Asset Manifest"),
  models: z.array(ModelAssetSchema),
  textures3d: z.array(Texture3DAssetSchema),
  roads: z.array(RoadDefinitionSchema),
  signs: z.array(RoadSignPlacementSchema),
  weatherPresets: z.array(WeatherPresetSchema),
  defaultWeather: z.string().default("sunset"),
});

export type ModelAsset = z.infer<typeof ModelAssetSchema>;
export type Texture3DAsset = z.infer<typeof Texture3DAssetSchema>;
export type RoadDefinition = z.infer<typeof RoadDefinitionSchema>;
export type RoadSignType = z.infer<typeof RoadSignTypeSchema>;
export type RoadSignPlacement = z.infer<typeof RoadSignPlacementSchema>;
export type WeatherPreset = z.infer<typeof WeatherPresetSchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

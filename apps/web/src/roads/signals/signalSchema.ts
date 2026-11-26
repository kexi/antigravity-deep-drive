import type * as THREE from "three";
import { z } from "zod";

/**
 * 日本の交通信号作成・制御システム（Unified Traffic Signal System）の Zod スキーマ＆型定義
 *
 * - 道路交通法施行令第2条（青・黄・赤・青色矢印・歩行者青/青点滅/赤）および
 *   警察庁「交通信号制御機仕様書」の排他インターロック（全赤クリアランス）を型レベルで表現する。
 */

export const VehicleSignalAspectSchema = z.enum(["green", "yellow", "red", "red_right_arrow"]);
export type VehicleSignalAspect = z.infer<typeof VehicleSignalAspectSchema>;

export const PedestrianSignalAspectSchema = z.enum(["green", "green_blink", "red"]);
export type PedestrianSignalAspect = z.infer<typeof PedestrianSignalAspectSchema>;

export const SignalAxisGroupSchema = z.enum(["axis_a", "axis_b", "scramble_all"]);
export type SignalAxisGroup = z.infer<typeof SignalAxisGroupSchema>;

export const IntersectionTimingConfigSchema = z.object({
  greenSec: z.number().min(6).max(60).default(16),
  pedBlinkSec: z.number().min(2).max(10).default(4),
  yellowSec: z.number().min(2).max(6).default(3),
  allRedSec: z.number().min(1).max(5).default(2),
  rightArrowSec: z.number().min(0).max(15).default(0),
  scramblePedGreenSec: z.number().min(0).max(30).default(0),
  phaseOffsetSec: z.number().min(0).max(120).default(0),
});
export type IntersectionTimingConfig = z.infer<typeof IntersectionTimingConfigSchema>;

export const TrafficSignalBuildOptionsSchema = z.object({
  activeSignal: VehicleSignalAspectSchema.default("green"),
  pedestrianSignal: PedestrianSignalAspectSchema.optional(),
  intersectionNameJa: z.string().default("東京駅丸の内中央口"),
  intersectionNameEn: z.string().default("Tokyo Sta. Central"),
  showArrowSignal: z.boolean().default(true),
  armLengthMeters: z.number().min(2.4).max(6.2).default(4.1),
  hasPedestrianSignal: z.boolean().default(true),
  hasDualPedestrianHeads: z.boolean().default(false),
  includePointLight: z.boolean().default(true),
});
export type TrafficSignalBuildOptions = z.input<typeof TrafficSignalBuildOptionsSchema>;

export interface TrafficSignalHandle {
  id: string;
  intersectionId: string;
  axisGroup: SignalAxisGroup;
  group: THREE.Group;
  hasArrowUnit: boolean;
  currentVehicleAspect: VehicleSignalAspect;
  currentPedAspect: PedestrianSignalAspect;
  currentPedBlinkLit: boolean;
  applyAspect: (
    vehicleAspect: VehicleSignalAspect,
    pedAspect: PedestrianSignalAspect,
    pedBlinkLit?: boolean,
  ) => void;
}

export interface TrafficSignalPlacementSpec {
  id: string;
  intersectionId: string;
  axisGroup: SignalAxisGroup;
  x: number;
  z: number;
  rotationY: number;
  armLengthMeters: number;
  intersectionNameJa: string;
  intersectionNameEn: string;
  showArrowSignal: boolean;
  hasDualPedestrianHeads: boolean;
  isScramble: boolean;
}

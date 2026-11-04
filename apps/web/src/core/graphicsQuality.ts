import * as THREE from "three";
import type { GraphicsQuality } from "../types";

export interface GraphicsQualityPreset {
  quality: GraphicsQuality;
  label: string;
  badgeText: string;
  quickChipText: string;
  hudStatusText: string;
  maxPixelRatio: number;
  renderScale: number;
  shadowsEnabled: boolean;
  shadowMapType: THREE.ShadowMapType;
  shadowMapSize: number;
  cloudMarchSteps: number;
  cloudSunSteps: number;
  rainParticleCount: number;
  rainSplashCount: number;
  mirrorRenderInterval: number;
  mirrorRenderWidth: number;
  mirrorRenderHeight: number;
  postProcessLensFlare: boolean;
  postProcessMotionBlur: boolean;
}

export const GRAPHICS_QUALITY_ORDER: readonly GraphicsQuality[] = ["high", "medium", "low"];

/**
 * グラフィック品質の3段階プリセット定義（高 / 中 / 低）
 * - Why not 単一のピクセル比（DPR）スケーリングだけで済ませるか:
 *   本シミュレーターのGPU負荷は (1) フルスクリーンポストプロセス＆レンダーターゲット解像度、
 *   (2) 3Dボリュメトリック雲レイマーチングのステップ数と太陽方向セルフシャドウ評価、
 *   (3) 2048x2048 シャドウマップ生成パス、
 *   (4) ルームミラー・ドアミラー用の後方カメラ二次レンダリングパス、
 *   (5) 雨粒・路面スプラッシュの InstancedMesh 更新・描画数
 *   の複合要因で決まるため、各サブシステムを段階的に制御して視覚品質とフレームレートを両立させる。
 */
export const GRAPHICS_QUALITY_PRESETS: Record<GraphicsQuality, GraphicsQualityPreset> = {
  high: {
    quality: "high",
    label: "高",
    badgeText: "高 (HIGH)",
    quickChipText: "画質: 高",
    hudStatusText: "GRAPHICS: 高 (HIGH)",
    maxPixelRatio: 1.25,
    renderScale: 0.85,
    shadowsEnabled: true,
    shadowMapType: THREE.PCFSoftShadowMap,
    shadowMapSize: 2048,
    cloudMarchSteps: 14,
    cloudSunSteps: 2,
    rainParticleCount: 8500,
    rainSplashCount: 2600,
    mirrorRenderInterval: 1,
    mirrorRenderWidth: 512,
    mirrorRenderHeight: 256,
    postProcessLensFlare: true,
    postProcessMotionBlur: true,
  },
  medium: {
    quality: "medium",
    label: "中",
    badgeText: "中 (MEDIUM)",
    quickChipText: "画質: 中",
    hudStatusText: "GRAPHICS: 中 (MEDIUM)",
    maxPixelRatio: 1.0,
    renderScale: 0.65,
    shadowsEnabled: true,
    shadowMapType: THREE.PCFShadowMap,
    shadowMapSize: 1024,
    cloudMarchSteps: 8,
    cloudSunSteps: 1,
    rainParticleCount: 4500,
    rainSplashCount: 1200,
    mirrorRenderInterval: 2,
    mirrorRenderWidth: 256,
    mirrorRenderHeight: 128,
    postProcessLensFlare: true,
    postProcessMotionBlur: false,
  },
  low: {
    quality: "low",
    label: "低",
    badgeText: "低 (LOW)",
    quickChipText: "画質: 低",
    hudStatusText: "GRAPHICS: 低 (LOW)",
    maxPixelRatio: 0.75,
    renderScale: 0.5,
    shadowsEnabled: false,
    shadowMapType: THREE.BasicShadowMap,
    shadowMapSize: 512,
    cloudMarchSteps: 4,
    cloudSunSteps: 0,
    rainParticleCount: 1800,
    rainSplashCount: 0,
    mirrorRenderInterval: 6,
    mirrorRenderWidth: 128,
    mirrorRenderHeight: 64,
    postProcessLensFlare: false,
    postProcessMotionBlur: false,
  },
};

export function isGraphicsQuality(value: unknown): value is GraphicsQuality {
  const isNotString = typeof value !== "string";
  if (isNotString) {
    return false;
  }
  return value === "high" || value === "medium" || value === "low";
}

export function getGraphicsQualityPreset(quality: GraphicsQuality): GraphicsQualityPreset {
  const isInvalidQuality = !isGraphicsQuality(quality);
  if (isInvalidQuality) {
    return GRAPHICS_QUALITY_PRESETS.high;
  }
  return GRAPHICS_QUALITY_PRESETS[quality];
}

export function getNextGraphicsQuality(current: GraphicsQuality): GraphicsQuality {
  const currentIdx = GRAPHICS_QUALITY_ORDER.indexOf(current);
  const isNotFound = currentIdx < 0;
  if (isNotFound) {
    return "high";
  }
  const nextIdx = (currentIdx + 1) % GRAPHICS_QUALITY_ORDER.length;
  return GRAPHICS_QUALITY_ORDER[nextIdx];
}

/**
 * URL クエリ文字列 (`?graphics=high|medium|low` または `?quality=high|medium|low`) からグラフィック品質を解決する。
 */
export function parseGraphicsQualityQuery(
  search: string,
  fallback: GraphicsQuality = "high",
): GraphicsQuality {
  const isEmpty = !search || search.trim().length === 0;
  if (isEmpty) {
    return fallback;
  }

  const params = new URLSearchParams(search);
  const rawValue = params.get("graphics") ?? params.get("quality");
  const isMissingRawValue = rawValue === null || rawValue.trim().length === 0;
  if (isMissingRawValue) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  const isMediumAlias = normalized === "med" || normalized === "mid" || normalized === "中";
  if (isMediumAlias) {
    return "medium";
  }
  const isHighAlias = normalized === "高";
  if (isHighAlias) {
    return "high";
  }
  const isLowAlias = normalized === "低";
  if (isLowAlias) {
    return "low";
  }
  const isValid = isGraphicsQuality(normalized);
  if (isValid) {
    return normalized;
  }

  return fallback;
}

/**
 * ビューポート寸法とレンダースケール係数からポストプロセス用レンダーターゲットのピクセル寸法を算出する。
 */
export function computeScaledRenderDimensions(
  viewportWidth: number,
  viewportHeight: number,
  renderScale: number,
): { width: number; height: number } {
  const safeScale = Number.isFinite(renderScale)
    ? THREE.MathUtils.clamp(renderScale, 0.25, 2.0)
    : 1.0;
  const safeWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1;
  const safeHeight = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1;

  return {
    width: Math.max(1, Math.round(safeWidth * safeScale)),
    height: Math.max(1, Math.round(safeHeight * safeScale)),
  };
}

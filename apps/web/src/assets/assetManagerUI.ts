import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  assetManager,
  type AssetCategory,
  type AssetManager,
  type AssetManifestSummary,
} from "./assetManager";
import type {
  ModelAsset,
  RoadDefinition,
  RoadSignPlacement,
  RoadSignType,
  Texture3DAsset,
  WeatherPreset,
} from "./schema";
import { ROAD_SIGN_CATALOG, RoadSignSystem } from "../roads/roadSignSystem";
import {
  i18n,
  localizeRoadSignCategory,
  localizeRoadSignTitle,
  type SupportedLocale,
} from "../core/i18n";
import { logger } from "../core/logger";
import type { ShaderPrebuildReport } from "../core/shaderPrebuilder";

export type AssetManagerTab = AssetCategory | "yaml";

export interface AssetManagerUrlLocationLike {
  pathname?: string;
  search?: string;
  hash?: string;
}

/**
 * URL パス (`/assets`, `/boost/assets`)、クエリ (`?assets=1`, `?assetManager=1`)、
 * またはハッシュ (`#assets`, `#/assets`) から Web アセット管理システム自動起動オプションを判定する。
 */
export function hasAssetManagerPathSegment(pathname: string | null | undefined): boolean {
  const isMissing = typeof pathname !== "string" || pathname.trim().length === 0;
  if (isMissing) {
    return false;
  }
  const segments = pathname
    .trim()
    .toLowerCase()
    .split("/")
    .filter((seg) => seg.length > 0);
  return segments.includes("assets") || segments.includes("asset-manager");
}

function parseBooleanFlagValue(rawValue: string | null | undefined): boolean | null {
  const isUndefined = rawValue === undefined || rawValue === null;
  if (isUndefined) {
    return null;
  }
  const normalized = rawValue.trim().toLowerCase();
  const isEmptyFlag = normalized.length === 0;
  if (isEmptyFlag) {
    return true;
  }
  const isTrue =
    normalized === "1" ||
    normalized === "true" ||
    normalized === "on" ||
    normalized === "yes" ||
    normalized === "open";
  if (isTrue) {
    return true;
  }
  const isFalse =
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "no" ||
    normalized === "close";
  if (isFalse) {
    return false;
  }
  return null;
}

/**
 * URL ロケーション情報からアセット管理システムを開いた状態で起動すべきかを解決する。
 */
export function parseAssetManagerOption(
  locationInput?: AssetManagerUrlLocationLike | string | null,
): boolean {
  let pathname = "";
  let search = "";
  let hash = "";

  const isStringInput = typeof locationInput === "string";
  if (isStringInput) {
    const raw = locationInput.trim();
    const hashIdx = raw.indexOf("#");
    const withoutHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    hash = hashIdx >= 0 ? raw.slice(hashIdx) : "";
    const queryIdx = withoutHash.indexOf("?");
    if (queryIdx >= 0) {
      pathname = withoutHash.slice(0, queryIdx);
      search = withoutHash.slice(queryIdx);
    } else {
      pathname = withoutHash;
    }
  } else if (locationInput && typeof locationInput === "object") {
    pathname = locationInput.pathname ?? "";
    search = locationInput.search ?? "";
    hash = locationInput.hash ?? "";
  } else if (typeof window !== "undefined" && window.location) {
    pathname = window.location.pathname;
    search = window.location.search;
    hash = window.location.hash;
  }

  const hasSearch = search.trim().length > 0;
  if (hasSearch) {
    try {
      const normalizedSearch = search.startsWith("?") ? search : `?${search}`;
      const params = new URLSearchParams(normalizedSearch);
      const hasAssetsKey =
        params.has("assets") || params.has("assetManager") || params.has("asset_manager");
      if (hasAssetsKey) {
        const rawVal =
          params.get("assets") ?? params.get("assetManager") ?? params.get("asset_manager");
        const parsed = parseBooleanFlagValue(rawVal);
        const isExplicitBoolean = parsed !== null;
        if (isExplicitBoolean) {
          return parsed;
        }
      }
    } catch {
      // クエリ解析失敗時はパス・ハッシュ判定へフォールバック
    }
  }

  const hasHash = hash.trim().length > 0;
  if (hasHash) {
    const cleanHash = hash.replace(/^#\/?/, "").trim().toLowerCase();
    const isDirectHash =
      cleanHash === "assets" ||
      cleanHash === "asset-manager" ||
      cleanHash.endsWith("/assets") ||
      cleanHash.endsWith("/asset-manager");
    if (isDirectHash) {
      return true;
    }
    try {
      const hashParams = new URLSearchParams(cleanHash);
      const hasHashKey = hashParams.has("assets") || hashParams.has("assetmanager");
      if (hasHashKey) {
        const rawVal = hashParams.get("assets") ?? hashParams.get("assetmanager");
        const parsed = parseBooleanFlagValue(rawVal);
        const isExplicitBoolean = parsed !== null;
        if (isExplicitBoolean) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }

  return hasAssetManagerPathSegment(pathname);
}

/**
 * 数値カラー (`0xff9944`) を `<input type="color">` 用の 6 桁 HEX 文字列 (`"#ff9944"`) に変換する。
 */
export function numberToHexColorString(colorNum: number): string {
  const safeNum = Number.isFinite(colorNum) ? colorNum : 0;
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(safeNum)));
  return `#${clamped.toString(16).padStart(6, "0")}`;
}

/**
 * HEX カラー文字列 (`"#ff9944"` または `"0xff9944"`) を数値 (`0xff9944`) に変換する。
 */
export function hexColorStringToNumber(hexStr: string, fallback = 0x888888): number {
  const cleaned = hexStr.trim().replace(/^#/, "").replace(/^0x/i, "");
  const isValidHex = /^[0-9a-fA-F]{6}$/.test(cleaned);
  if (!isValidHex) {
    return fallback;
  }
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface AssetManagerLiveBridge {
  onApplyModelToScene?: (model: ModelAsset) => void;
  onApplyTexture3DToScene?: (texture: Texture3DAsset, texObj: THREE.Data3DTexture) => void;
  onApplyRoadToScene?: (road: RoadDefinition) => void;
  onApplySignToScene?: (sign: RoadSignPlacement) => void;
  onRemoveSignFromScene?: (signId: string) => void;
  onApplyWeatherPresetToScene?: (preset: WeatherPreset) => void;
  onManifestReloaded?: () => void;
  onTriggerShaderPrebuild?: () => Promise<ShaderPrebuildReport | null>;
  getShaderBoostState?: () => {
    enabled: boolean;
    prebuilt: boolean;
    lastReport: ShaderPrebuildReport | null;
  };
}

/**
 * Web アセット管理システム UI コントローラー (`<dialog id="asset-manager-dialog" closedby="any">`)
 *
 * 【機能】
 * - 5 大アセットカテゴリ (`models` / `textures3d` / `roads` / `signs` / `weatherPresets`) + `yaml` マニフェストエディタ
 * - 横断キーワード検索フィルタとリアルタイム統計カード（総アセット数・3D テクスチャ推定 VRAM・`/boost` 状態）
 * - インタラクティブ `<canvas>` プレビュー（3D ワイヤーフレーム＆サブパーツ階層・3D ボクセルスライス・道路断面図・標識描画・大気空＆雨プレビュー）
 * - パラメータフォームによるリアルタイム編集と 3D シーン即時反映 (`AssetManagerLiveBridge`)
 * - `/boost` シェーダープレビルドのワンクリック実行とコンパイル統計表示
 * - Zod スキーマ検証付き YAML インポート / エクスポート / ファイルダウンロード / デフォルト復元
 */
export class AssetManagerUI {
  private readonly manager: AssetManager;
  private readonly bridge: AssetManagerLiveBridge;
  private readonly dialog: HTMLDialogElement | null;
  private readonly previewCanvas: HTMLCanvasElement | null;
  private readonly statusBannerEl: HTMLElement | null;
  private readonly searchInput: HTMLInputElement | null;
  private readonly assetListEl: HTMLElement | null;
  private readonly editorPaneEl: HTMLElement | null;
  private readonly summaryBarEl: HTMLElement | null;

  private activeTab: AssetManagerTab = "models";
  private selectedAssetId = "car";
  private searchQuery = "";
  private previewYawDeg = 32;
  private previewPitchDeg = 18;
  private previewZoom = 1.0;
  private previewViewPreset: "exterior" | "cockpit" | "footwell" | "cutaway" = "exterior";
  private previewWireframeOverlay = true;
  private previewSliceZ = 0.5;
  private statusMessage = "";
  private statusTone: "ok" | "warn" | "error" = "ok";
  private readonly gltfCache = new Map<string, THREE.Group>();
  private readonly gltfLoading = new Set<string>();

  constructor(options: { manager?: AssetManager; bridge?: AssetManagerLiveBridge } = {}) {
    this.manager = options.manager ?? assetManager;
    this.bridge = options.bridge ?? {};

    const hasDoc = typeof document !== "undefined";
    this.dialog = hasDoc
      ? (document.getElementById("asset-manager-dialog") as HTMLDialogElement | null)
      : null;
    this.previewCanvas = hasDoc
      ? (document.getElementById("asset-manager-preview-canvas") as HTMLCanvasElement | null)
      : null;
    this.statusBannerEl = hasDoc ? document.getElementById("asset-manager-status-banner") : null;
    this.searchInput = hasDoc
      ? (document.getElementById("asset-manager-search-input") as HTMLInputElement | null)
      : null;
    this.assetListEl = hasDoc ? document.getElementById("asset-manager-item-list") : null;
    this.editorPaneEl = hasDoc ? document.getElementById("asset-manager-editor-pane") : null;
    this.summaryBarEl = hasDoc ? document.getElementById("asset-manager-summary-bar") : null;

    this.initDOMBindings();
    this.ensureValidSelection();
    this.renderAll();

    i18n.onChange(() => {
      this.renderAll();
    });

    this.manager.onChange(() => {
      this.renderSummaryBar();
    });
  }

  public isOpen(): boolean {
    return Boolean(this.dialog?.open);
  }

  public open(initialTab?: AssetManagerTab): void {
    const hasInitialTab = initialTab !== undefined;
    if (hasInitialTab) {
      this.activeTab = initialTab;
      this.ensureValidSelection();
    }
    const isMissingDialog = !this.dialog;
    if (isMissingDialog) {
      return;
    }
    const isNotOpen = !this.dialog.open;
    if (isNotOpen) {
      if (typeof this.dialog.showModal === "function") {
        this.dialog.showModal();
      } else {
        this.dialog.setAttribute("open", "");
      }
    }
    this.renderAll();

    logger.info("assetManagerUI", "dialog.open", "Opened Web Asset Management System dialog", {
      activeTab: this.activeTab,
      selectedAssetId: this.selectedAssetId,
    });
  }

  public close(): void {
    const isMissingOrClosed = !this.dialog || !this.dialog.open;
    if (isMissingOrClosed) {
      return;
    }
    if (typeof this.dialog.close === "function") {
      this.dialog.close();
    } else {
      this.dialog.removeAttribute("open");
    }
    logger.info("assetManagerUI", "dialog.close", "Closed Web Asset Management System dialog");
  }

  public toggle(): void {
    const isCurrentlyOpen = this.isOpen();
    if (isCurrentlyOpen) {
      this.close();
      return;
    }
    this.open();
  }

  public getActiveTab(): AssetManagerTab {
    return this.activeTab;
  }

  public setActiveTab(tab: AssetManagerTab): void {
    this.activeTab = tab;
    this.ensureValidSelection();
    this.renderAll();
  }

  public getSelectedAssetId(): string {
    return this.selectedAssetId;
  }

  public selectAsset(id: string): void {
    this.selectedAssetId = id;
    this.renderItemList();
    this.renderEditorPane();
    this.renderPreviewCanvas();
  }

  private initDOMBindings(): void {
    const hasDoc = typeof document !== "undefined";
    if (!hasDoc) {
      return;
    }

    const openBtnIds = [
      "open-asset-manager-btn",
      "quick-asset-manager-btn",
      "title-open-asset-manager-btn",
    ];
    for (const btnId of openBtnIds) {
      const btn = document.getElementById(btnId);
      btn?.addEventListener("click", () => {
        this.open();
      });
    }

    const closeBtn = document.getElementById("close-asset-manager-btn");
    closeBtn?.addEventListener("click", () => {
      this.close();
    });

    const tabContainer = document.getElementById("asset-manager-tabs");
    tabContainer?.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        "[data-asset-tab]",
      );
      const tab = target?.dataset.assetTab as AssetManagerTab | undefined;
      const isValidTab =
        tab === "models" ||
        tab === "textures3d" ||
        tab === "roads" ||
        tab === "signs" ||
        tab === "weatherPresets" ||
        tab === "yaml";
      if (isValidTab) {
        this.setActiveTab(tab);
      }
    });

    this.searchInput?.addEventListener("input", () => {
      this.searchQuery = (this.searchInput?.value ?? "").trim().toLowerCase();
      this.ensureValidSelection();
      this.renderItemList();
      this.renderEditorPane();
      this.renderPreviewCanvas();
    });

    const boostBtn = document.getElementById("asset-manager-run-boost-btn");
    boostBtn?.addEventListener("click", () => {
      void this.handleTriggerShaderPrebuild();
    });

    const resetAllBtn = document.getElementById("asset-manager-reset-all-btn");
    resetAllBtn?.addEventListener("click", () => {
      this.handleResetAllToDefault();
    });

    this.previewCanvas?.addEventListener("pointerdown", (e) => {
      const startX = e.clientX;
      const startY = e.clientY;
      const startYaw = this.previewYawDeg;
      const startPitch = this.previewPitchDeg;
      const onMove = (moveEv: PointerEvent): void => {
        const dx = moveEv.clientX - startX;
        const dy = moveEv.clientY - startY;
        this.previewYawDeg = (((startYaw + dx * 0.8) % 360) + 360) % 360;
        this.previewPitchDeg = Math.max(-75, Math.min(82, startPitch + dy * 0.55));
        this.renderPreviewCanvas();
      };
      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    this.previewCanvas?.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        this.previewZoom = Math.max(0.45, Math.min(3.5, this.previewZoom * factor));
        this.renderPreviewCanvas();
      },
      { passive: false },
    );
  }

  private async handleTriggerShaderPrebuild(): Promise<void> {
    const locale = i18n.getLocale();
    const triggerPrebuild = this.bridge.onTriggerShaderPrebuild;
    const isMissingTrigger = !triggerPrebuild;
    if (isMissingTrigger) {
      return;
    }

    const report = await triggerPrebuild();
    const hasReport = report !== null;
    if (hasReport) {
      const msg =
        locale === "en"
          ? `/boost Shader Prebuild completed: ${report.compiledMaterialsCount} materials / ${report.compiledObjectsCount} objects (${report.durationMs}ms)`
          : locale === "zh"
            ? `/boost 着色器预编译完成: ${report.compiledMaterialsCount} 材质 / ${report.compiledObjectsCount} 对象 (${report.durationMs}ms)`
            : `/boost シェーダープレビルド完了: ${report.compiledMaterialsCount} マテリアル / ${report.compiledObjectsCount} オブジェクト (${report.durationMs}ms)`;
      this.setStatus(msg, "ok");
      this.renderSummaryBar();
    }
  }

  private handleResetAllToDefault(): void {
    const locale = i18n.getLocale();
    this.manager.resetToDefault();
    this.bridge.onManifestReloaded?.();
    this.ensureValidSelection();
    const msg =
      locale === "en"
        ? "Reset all assets to default manifest (DEFAULT_ASSETS_YAML)."
        : locale === "zh"
          ? "已将所有资产重置为默认清单 (DEFAULT_ASSETS_YAML)。"
          : "全アセット定義を初期状態 (DEFAULT_ASSETS_YAML) にリセットしました。";
    this.setStatus(msg, "ok");
    this.renderAll();
  }

  private setStatus(message: string, tone: "ok" | "warn" | "error"): void {
    this.statusMessage = message;
    this.statusTone = tone;
    this.renderStatusBanner();
  }

  private ensureValidSelection(): void {
    const isYamlTab = this.activeTab === "yaml";
    if (isYamlTab) {
      return;
    }
    const items = this.getFilteredItemsForTab(this.activeTab);
    const hasItems = items.length > 0;
    if (!hasItems) {
      this.selectedAssetId = "";
      return;
    }
    const exists = items.some((item) => item.id === this.selectedAssetId);
    if (!exists) {
      this.selectedAssetId = items[0]!.id;
    }
  }

  private getFilteredItemsForTab(
    tab: AssetManagerTab,
  ): Array<{ id: string; title: string; subtitle: string; badge: string }> {
    const manifest = this.manager.getManifest();
    const locale = i18n.getLocale();
    const q = this.searchQuery;
    const matches = (id: string, title: string, sub: string): boolean => {
      const isNoQuery = q.length === 0;
      if (isNoQuery) {
        return true;
      }
      return (
        id.toLowerCase().includes(q) ||
        title.toLowerCase().includes(q) ||
        sub.toLowerCase().includes(q)
      );
    };

    if (tab === "models") {
      return manifest.models
        .map((m) => ({
          id: m.id,
          title: m.id,
          subtitle: m.path,
          badge: `GLB (${m.scale.join("×")})`,
        }))
        .filter((item) => matches(item.id, item.title, item.subtitle));
    }

    if (tab === "textures3d") {
      return manifest.textures3d
        .map((t) => ({
          id: t.id,
          title: t.id,
          subtitle: t.type,
          badge: `${t.resolution}³`,
        }))
        .filter((item) => matches(item.id, item.title, item.subtitle));
    }

    if (tab === "roads") {
      return manifest.roads
        .map((r) => ({
          id: r.id,
          title: r.name,
          subtitle: `${r.id} · ${r.width}m × ${r.length}m`,
          badge: `${r.lanes}L / ${r.speedLimit}km/h`,
        }))
        .filter((item) => matches(item.id, item.title, item.subtitle));
    }

    if (tab === "signs") {
      return manifest.signs
        .map((s) => {
          const typeTitle = localizeRoadSignTitle(s.type, locale);
          const labelPart = s.label ?? s.intersectionName ?? "";
          return {
            id: s.id,
            title: labelPart ? `${typeTitle} (${labelPart})` : typeTitle,
            subtitle: `${s.id} @ [${s.position.join(", ")}]`,
            badge: s.type,
          };
        })
        .filter((item) => matches(item.id, item.title, item.subtitle));
    }

    if (tab === "weatherPresets") {
      return manifest.weatherPresets
        .map((w) => ({
          id: w.id,
          title: w.name,
          subtitle: `id: ${w.id} · fog: ${w.fogDensity}`,
          badge: w.rain.enabled ? "RAIN" : "CLEAR",
        }))
        .filter((item) => matches(item.id, item.title, item.subtitle));
    }

    return [];
  }

  public renderAll(): void {
    this.renderSummaryBar();
    this.renderTabButtons();
    this.renderItemList();
    this.renderEditorPane();
    this.renderPreviewCanvas();
    this.renderStatusBanner();
  }

  private renderStatusBanner(): void {
    const isMissingBanner = !this.statusBannerEl;
    if (isMissingBanner) {
      return;
    }
    const locale = i18n.getLocale();
    const summary = this.manager.getManifestSummary();
    const defaultText =
      locale === "en"
        ? `Zod Schema Validated — ${summary.totalAssetsCount} assets managed (${summary.version})`
        : locale === "zh"
          ? `Zod 模式验证通过 — 共管理 ${summary.totalAssetsCount} 项资产 (${summary.version})`
          : `Zod スキーマ検証済み — 全 ${summary.totalAssetsCount} アセット管理中 (v${summary.version})`;

    this.statusBannerEl.textContent = this.statusMessage || defaultText;
    this.statusBannerEl.dataset.tone = this.statusMessage ? this.statusTone : "ok";
  }

  private renderSummaryBar(): void {
    const isMissingBar = !this.summaryBarEl;
    if (isMissingBar) {
      return;
    }
    const summary: AssetManifestSummary = this.manager.getManifestSummary();
    const locale: SupportedLocale = i18n.getLocale();
    const vramMb = (summary.estimated3DTextureVramBytes / (1024 * 1024)).toFixed(2);
    const boostState = this.bridge.getShaderBoostState?.() ?? {
      enabled: false,
      prebuilt: false,
      lastReport: null,
    };

    const boostLabel = boostState.prebuilt
      ? boostState.lastReport
        ? `PREBUILT (${boostState.lastReport.compiledMaterialsCount} mats / ${boostState.lastReport.durationMs}ms)`
        : "PREBUILT (/boost)"
      : boostState.enabled
        ? "READY (/boost)"
        : "STANDBY";

    const labels =
      locale === "en"
        ? {
            total: "Total Assets",
            models: "3D GLB Models",
            tex3d: "3D Textures (VRAM)",
            roadsSigns: "Roads / Signs",
            boost: "Shader Boost (/boost)",
          }
        : locale === "zh"
          ? {
              total: "资产总数",
              models: "3D GLB 模型",
              tex3d: "3D 纹理 (VRAM)",
              roadsSigns: "道路 / 标志",
              boost: "着色器预编译 (/boost)",
            }
          : {
              total: "管理アセット総数",
              models: "3D GLB モデル",
              tex3d: "3D テクスチャ (VRAM)",
              roadsSigns: "道路網 / 標識",
              boost: "シェーダー (/boost)",
            };

    this.summaryBarEl.innerHTML = `
      <div class="asset-stat-card">
        <span class="asset-stat-label">${labels.total}</span>
        <strong class="asset-stat-val">${summary.totalAssetsCount}</strong>
      </div>
      <div class="asset-stat-card">
        <span class="asset-stat-label">${labels.models}</span>
        <strong class="asset-stat-val">${summary.modelsCount} GLB</strong>
      </div>
      <div class="asset-stat-card">
        <span class="asset-stat-label">${labels.tex3d}</span>
        <strong class="asset-stat-val">${summary.textures3dCount} (${vramMb} MB)</strong>
      </div>
      <div class="asset-stat-card">
        <span class="asset-stat-label">${labels.roadsSigns}</span>
        <strong class="asset-stat-val">${summary.roadsCount} / ${summary.signsCount}</strong>
      </div>
      <div class="asset-stat-card">
        <span class="asset-stat-label">${labels.boost}</span>
        <strong class="asset-stat-val asset-stat-boost">${boostLabel}</strong>
      </div>
    `;
  }

  private renderTabButtons(): void {
    const hasDoc = typeof document !== "undefined";
    if (!hasDoc) {
      return;
    }
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      "#asset-manager-tabs [data-asset-tab]",
    );
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.assetTab === this.activeTab);
    });
  }

  private renderItemList(): void {
    const isMissingList = !this.assetListEl;
    if (isMissingList) {
      return;
    }
    this.assetListEl.innerHTML = "";

    const isYamlTab = this.activeTab === "yaml";
    if (isYamlTab) {
      const locale = i18n.getLocale();
      const info = document.createElement("div");
      info.className = "asset-empty-hint";
      info.textContent =
        locale === "en"
          ? "Full YAML Manifest mode: inspect, validate, export, or import config/assets.yml in the right pane."
          : locale === "zh"
            ? "完整 YAML 清单模式：可在右侧面板中检查、验证、导出或导入 config/assets.yml。"
            : "YAML マニフェスト全体編集モード：右ペインで config/assets.yml の検証・入出力を行えます。";
      this.assetListEl.appendChild(info);
      return;
    }

    const items = this.getFilteredItemsForTab(this.activeTab);
    const isEmpty = items.length === 0;
    if (isEmpty) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "asset-empty-hint";
      emptyEl.textContent = "No matching assets found.";
      this.assetListEl.appendChild(emptyEl);
      return;
    }

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `asset-list-item${item.id === this.selectedAssetId ? " active" : ""}`;
      btn.dataset.assetId = item.id;

      const topRow = document.createElement("div");
      topRow.className = "asset-list-item-top";
      const titleSpan = document.createElement("span");
      titleSpan.className = "asset-list-item-title";
      titleSpan.textContent = item.title;
      const badgeSpan = document.createElement("span");
      badgeSpan.className = "asset-list-item-badge";
      badgeSpan.textContent = item.badge;
      topRow.appendChild(titleSpan);
      topRow.appendChild(badgeSpan);

      const subRow = document.createElement("div");
      subRow.className = "asset-list-item-sub";
      subRow.textContent = item.subtitle;

      btn.appendChild(topRow);
      btn.appendChild(subRow);
      btn.addEventListener("click", () => {
        this.selectAsset(item.id);
      });
      this.assetListEl.appendChild(btn);
    }
  }

  private renderEditorPane(): void {
    const isMissingEditor = !this.editorPaneEl;
    if (isMissingEditor) {
      return;
    }
    this.editorPaneEl.innerHTML = "";

    if (this.activeTab === "models") {
      this.renderModelEditor(this.editorPaneEl);
      return;
    }
    if (this.activeTab === "textures3d") {
      this.renderTexture3DEditor(this.editorPaneEl);
      return;
    }
    if (this.activeTab === "roads") {
      this.renderRoadEditor(this.editorPaneEl);
      return;
    }
    if (this.activeTab === "signs") {
      this.renderSignEditor(this.editorPaneEl);
      return;
    }
    if (this.activeTab === "weatherPresets") {
      this.renderWeatherPresetEditor(this.editorPaneEl);
      return;
    }
    this.renderYamlEditor(this.editorPaneEl);
  }

  private renderModelEditor(container: HTMLElement): void {
    const model = this.manager.getModelConfig(this.selectedAssetId);
    const isMissing = !model;
    if (isMissing) {
      return;
    }
    const locale = i18n.getLocale();
    const subpartsEntries = Object.entries(model.subparts ?? {});
    const hexColor = numberToHexColorString(model.fallbackColor);

    container.innerHTML = `
      <div class="asset-editor-header">
        <div>
          <span class="asset-editor-badge">3D GLB MODEL</span>
          <h3 class="asset-editor-title">${model.id}</h3>
        </div>
        <code class="asset-editor-path">${model.path}</code>
      </div>
      <div class="sign-field-grid">
        <div class="sign-field">
          <label for="asset-model-scale-x">Scale X</label>
          <input id="asset-model-scale-x" type="number" step="0.05" min="0.05" max="20" value="${model.scale[0]}" />
        </div>
        <div class="sign-field">
          <label for="asset-model-scale-y">Scale Y</label>
          <input id="asset-model-scale-y" type="number" step="0.05" min="0.05" max="20" value="${model.scale[1]}" />
        </div>
        <div class="sign-field">
          <label for="asset-model-scale-z">Scale Z</label>
          <input id="asset-model-scale-z" type="number" step="0.05" min="0.05" max="20" value="${model.scale[2]}" />
        </div>
        <div class="sign-field">
          <label for="asset-model-color">Fallback Color (HEX)</label>
          <input id="asset-model-color" type="color" value="${hexColor}" />
        </div>
        <div class="sign-field">
          <label for="asset-model-offset-x">Offset X (m)</label>
          <input id="asset-model-offset-x" type="number" step="0.05" value="${model.offset[0]}" />
        </div>
        <div class="sign-field">
          <label for="asset-model-offset-y">Offset Y (m)</label>
          <input id="asset-model-offset-y" type="number" step="0.05" value="${model.offset[1]}" />
        </div>
        <div class="sign-field">
          <label for="asset-model-offset-z">Offset Z (m)</label>
          <input id="asset-model-offset-z" type="number" step="0.05" value="${model.offset[2]}" />
        </div>
      </div>
      <div class="sign-field full-width">
        <label>360° 3D Inspector Camera & Cutaway Presets</label>
        <div class="sign-action-row" style="gap: 6px; flex-wrap: wrap;">
          <button type="button" class="hud-btn ${this.previewViewPreset === "exterior" ? "active" : ""}" data-model-view-preset="exterior">
            ${locale === "en" ? "Exterior 360°" : locale === "zh" ? "外观 360°" : "車外 360°"}
          </button>
          <button type="button" class="hud-btn ${this.previewViewPreset === "cockpit" ? "active" : ""}" data-model-view-preset="cockpit">
            ${locale === "en" ? "Cockpit Interior 360°" : locale === "zh" ? "驾驶舱内部 360°" : "車内コックピット 360°"}
          </button>
          <button type="button" class="hud-btn ${this.previewViewPreset === "footwell" ? "active" : ""}" data-model-view-preset="footwell">
            ${locale === "en" ? "Footwell & Pedals" : locale === "zh" ? "脚踏板与下半部" : "運転席・足元＆下半分確認"}
          </button>
          <button type="button" class="hud-btn ${this.previewViewPreset === "cutaway" ? "active" : ""}" data-model-view-preset="cutaway">
            ${locale === "en" ? "Cabin Cutaway" : locale === "zh" ? "车厢剖面" : "車内断面カット"}
          </button>
          <button type="button" class="hud-btn ${this.previewWireframeOverlay ? "active" : ""}" id="asset-model-wire-toggle-btn">
            ${locale === "en" ? "Wireframe Overlay" : locale === "zh" ? "线框叠加" : "ワイヤーフレーム重畳"}
          </button>
        </div>
      </div>
      <div class="sign-field full-width">
        <label for="asset-model-yaw-slider">360° Azimuth Yaw (${Math.round(this.previewYawDeg)}°) / Pitch (${Math.round(this.previewPitchDeg)}°)</label>
        <input id="asset-model-yaw-slider" type="range" min="0" max="360" step="1" value="${Math.round(this.previewYawDeg)}" />
      </div>
      <div class="sign-field full-width">
        <label>Subparts Hierarchy (${subpartsEntries.length})</label>
        <div class="sign-custom-list">
          ${
            subpartsEntries.length > 0
              ? subpartsEntries
                  .map(([k, v]) => `<span class="sign-chip"><strong>${k}</strong>: ${v}</span>`)
                  .join("")
              : `<span class="sign-chip">Single Mesh Root</span>`
          }
        </div>
      </div>
      <div class="sign-action-row">
        <button type="button" class="hud-btn active" id="asset-apply-model-btn">
          ${locale === "en" ? "Apply to 3D Scene" : locale === "zh" ? "应用到 3D 场景" : "3Dシーンへ即時反映"}
        </button>
      </div>
    `;

    const presetBtns = container.querySelectorAll<HTMLButtonElement>("[data-model-view-preset]");
    presetBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.modelViewPreset as
          | "exterior"
          | "cockpit"
          | "footwell"
          | "cutaway"
          | undefined;
        if (!preset) {
          return;
        }
        this.previewViewPreset = preset;
        if (preset === "exterior") {
          this.previewYawDeg = 32;
          this.previewPitchDeg = 18;
          this.previewZoom = 1.0;
        } else if (preset === "cockpit") {
          this.previewYawDeg = 0;
          this.previewPitchDeg = 16;
          this.previewZoom = 1.35;
        } else if (preset === "footwell") {
          this.previewYawDeg = 8;
          this.previewPitchDeg = 38;
          this.previewZoom = 1.55;
        } else if (preset === "cutaway") {
          this.previewYawDeg = 82;
          this.previewPitchDeg = 22;
          this.previewZoom = 1.25;
        }
        this.renderEditorPane();
        this.renderPreviewCanvas();
      });
    });

    const wireBtn = container.querySelector<HTMLButtonElement>("#asset-model-wire-toggle-btn");
    wireBtn?.addEventListener("click", () => {
      this.previewWireframeOverlay = !this.previewWireframeOverlay;
      this.renderEditorPane();
      this.renderPreviewCanvas();
    });

    const yawSlider = container.querySelector<HTMLInputElement>("#asset-model-yaw-slider");
    yawSlider?.addEventListener("input", () => {
      this.previewYawDeg = Number.parseFloat(yawSlider.value) || 0;
      this.renderPreviewCanvas();
    });

    const applyBtn = container.querySelector<HTMLButtonElement>("#asset-apply-model-btn");
    applyBtn?.addEventListener("click", () => {
      const sx = Number.parseFloat(
        (container.querySelector("#asset-model-scale-x") as HTMLInputElement)?.value ?? "1",
      );
      const sy = Number.parseFloat(
        (container.querySelector("#asset-model-scale-y") as HTMLInputElement)?.value ?? "1",
      );
      const sz = Number.parseFloat(
        (container.querySelector("#asset-model-scale-z") as HTMLInputElement)?.value ?? "1",
      );
      const ox = Number.parseFloat(
        (container.querySelector("#asset-model-offset-x") as HTMLInputElement)?.value ?? "0",
      );
      const oy = Number.parseFloat(
        (container.querySelector("#asset-model-offset-y") as HTMLInputElement)?.value ?? "0",
      );
      const oz = Number.parseFloat(
        (container.querySelector("#asset-model-offset-z") as HTMLInputElement)?.value ?? "0",
      );
      const colorHexStr =
        (container.querySelector("#asset-model-color") as HTMLInputElement)?.value ?? hexColor;

      try {
        const updated = this.manager.updateModelConfig(model.id, {
          scale: [
            Number.isFinite(sx) && sx > 0 ? sx : 1,
            Number.isFinite(sy) && sy > 0 ? sy : 1,
            Number.isFinite(sz) && sz > 0 ? sz : 1,
          ],
          offset: [
            Number.isFinite(ox) ? ox : 0,
            Number.isFinite(oy) ? oy : 0,
            Number.isFinite(oz) ? oz : 0,
          ],
          fallbackColor: hexColorStringToNumber(colorHexStr, model.fallbackColor),
        });
        this.bridge.onApplyModelToScene?.(updated);
        this.setStatus(`Updated model '${updated.id}' and synced to 3D scene.`, "ok");
        this.renderItemList();
        this.renderPreviewCanvas();
      } catch (err) {
        this.setStatus(err instanceof Error ? err.message : String(err), "error");
      }
    });
  }

  private renderTexture3DEditor(container: HTMLElement): void {
    const tex = this.manager.getTexture3DConfig(this.selectedAssetId);
    const isMissing = !tex;
    if (isMissing) {
      return;
    }
    const locale = i18n.getLocale();
    const vramKb = ((tex.resolution ** 3 * 4) / 1024).toFixed(1);

    container.innerHTML = `
      <div class="asset-editor-header">
        <div>
          <span class="asset-editor-badge">PROCEDURAL 3D TEXTURE</span>
          <h3 class="asset-editor-title">${tex.id}</h3>
        </div>
        <code class="asset-editor-path">${tex.type} (${vramKb} KB VRAM)</code>
      </div>
      <div class="sign-field-grid">
        <div class="sign-field">
          <label for="asset-tex-res">Voxel Resolution (N³)</label>
          <select id="asset-tex-res">
            ${[16, 24, 32, 48, 64]
              .map(
                (r) =>
                  `<option value="${r}" ${tex.resolution === r ? "selected" : ""}>${r} × ${r} × ${r}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="sign-field">
          <label for="asset-tex-roughness">Roughness Scale</label>
          <input id="asset-tex-roughness" type="number" step="0.05" min="0.1" max="4.0" value="${tex.roughnessScale}" />
        </div>
        <div class="sign-field full-width">
          <label for="asset-tex-slice">Preview Z-Slice Depth (${Math.round(this.previewSliceZ * 100)}%)</label>
          <input id="asset-tex-slice" type="range" min="0" max="100" step="5" value="${Math.round(this.previewSliceZ * 100)}" />
        </div>
      </div>
      <div class="sign-action-row">
        <button type="button" class="hud-btn active" id="asset-apply-tex-btn">
          ${locale === "en" ? "Regenerate 3D Texture" : locale === "zh" ? "重新生成 3D 纹理" : "3Dテクスチャを再生成・適用"}
        </button>
      </div>
    `;

    const sliceSlider = container.querySelector<HTMLInputElement>("#asset-tex-slice");
    sliceSlider?.addEventListener("input", () => {
      this.previewSliceZ = Number.parseFloat(sliceSlider.value) / 100;
      this.renderPreviewCanvas();
    });

    const applyBtn = container.querySelector<HTMLButtonElement>("#asset-apply-tex-btn");
    applyBtn?.addEventListener("click", () => {
      const res = Number.parseInt(
        (container.querySelector("#asset-tex-res") as HTMLSelectElement)?.value ?? "32",
        10,
      );
      const rough = Number.parseFloat(
        (container.querySelector("#asset-tex-roughness") as HTMLInputElement)?.value ?? "1.0",
      );
      try {
        const updated = this.manager.updateTexture3DConfig(tex.id, {
          resolution: Number.isFinite(res) && res > 0 ? res : 32,
          roughnessScale: Number.isFinite(rough) && rough > 0 ? rough : 1.0,
        });
        const generated = this.manager.getOrCreate3DTexture(updated.id);
        this.bridge.onApplyTexture3DToScene?.(updated, generated);
        this.setStatus(
          `Regenerated 3D texture '${updated.id}' (${updated.resolution}³ voxels).`,
          "ok",
        );
        this.renderSummaryBar();
        this.renderItemList();
        this.renderEditorPane();
        this.renderPreviewCanvas();
      } catch (err) {
        this.setStatus(err instanceof Error ? err.message : String(err), "error");
      }
    });
  }

  private renderRoadEditor(container: HTMLElement): void {
    const road = this.manager.getRoad(this.selectedAssetId);
    const isMissing = !road;
    if (isMissing) {
      return;
    }
    const locale = i18n.getLocale();

    container.innerHTML = `
      <div class="asset-editor-header">
        <div>
          <span class="asset-editor-badge">GSI / PLATEAU ROAD SEGMENT</span>
          <h3 class="asset-editor-title">${road.name}</h3>
        </div>
        <code class="asset-editor-path">${road.id}</code>
      </div>
      <div class="sign-field-grid">
        <div class="sign-field">
          <label for="asset-road-width">Width (m)</label>
          <input id="asset-road-width" type="number" step="1" min="4" max="80" value="${road.width}" />
        </div>
        <div class="sign-field">
          <label for="asset-road-lanes">Lanes</label>
          <input id="asset-road-lanes" type="number" step="1" min="1" max="10" value="${road.lanes}" />
        </div>
        <div class="sign-field">
          <label for="asset-road-speed">Speed Limit (km/h)</label>
          <input id="asset-road-speed" type="number" step="10" min="20" max="100" value="${road.speedLimit}" />
        </div>
        <div class="sign-field">
          <label for="asset-road-sidewalk">Sidewalk Width (m)</label>
          <input id="asset-road-sidewalk" type="number" step="0.5" min="0" max="20" value="${road.sidewalkWidth}" />
        </div>
        <div class="sign-field">
          <label for="asset-road-centerline">Center Line Type</label>
          <select id="asset-road-centerline">
            <option value="solid_yellow" ${road.markings.centerLineType === "solid_yellow" ? "selected" : ""}>solid_yellow</option>
            <option value="dashed_white" ${road.markings.centerLineType === "dashed_white" ? "selected" : ""}>dashed_white</option>
            <option value="none" ${road.markings.centerLineType === "none" ? "selected" : ""}>none</option>
          </select>
        </div>
        <div class="sign-field">
          <label for="asset-road-median">Has Median Strip</label>
          <select id="asset-road-median">
            <option value="true" ${road.hasMedian ? "selected" : ""}>true</option>
            <option value="false" ${!road.hasMedian ? "selected" : ""}>false</option>
          </select>
        </div>
      </div>
      <div class="sign-action-row">
        <button type="button" class="hud-btn active" id="asset-apply-road-btn">
          ${locale === "en" ? "Update Road Config" : locale === "zh" ? "更新道路配置" : "道路仕様を更新"}
        </button>
      </div>
    `;

    const applyBtn = container.querySelector<HTMLButtonElement>("#asset-apply-road-btn");
    applyBtn?.addEventListener("click", () => {
      const width = Number.parseFloat(
        (container.querySelector("#asset-road-width") as HTMLInputElement)?.value ??
          String(road.width),
      );
      const lanes = Number.parseInt(
        (container.querySelector("#asset-road-lanes") as HTMLInputElement)?.value ??
          String(road.lanes),
        10,
      );
      const speedLimit = Number.parseInt(
        (container.querySelector("#asset-road-speed") as HTMLInputElement)?.value ??
          String(road.speedLimit),
        10,
      );
      const sidewalkWidth = Number.parseFloat(
        (container.querySelector("#asset-road-sidewalk") as HTMLInputElement)?.value ??
          String(road.sidewalkWidth),
      );
      const centerLineType = ((
        container.querySelector("#asset-road-centerline") as HTMLSelectElement
      )?.value ?? "solid_yellow") as "solid_yellow" | "dashed_white" | "none";
      const hasMedian =
        (container.querySelector("#asset-road-median") as HTMLSelectElement)?.value === "true";

      try {
        const updated = this.manager.updateRoadConfig(road.id, {
          width: Number.isFinite(width) && width > 0 ? width : road.width,
          lanes: Number.isFinite(lanes) && lanes > 0 ? lanes : road.lanes,
          speedLimit: Number.isFinite(speedLimit) && speedLimit > 0 ? speedLimit : road.speedLimit,
          sidewalkWidth: Number.isFinite(sidewalkWidth) ? sidewalkWidth : road.sidewalkWidth,
          hasMedian,
          markings: {
            ...road.markings,
            centerLineType,
          },
        });
        this.bridge.onApplyRoadToScene?.(updated);
        this.setStatus(`Updated road definition '${updated.id}'.`, "ok");
        this.renderItemList();
        this.renderPreviewCanvas();
      } catch (err) {
        this.setStatus(err instanceof Error ? err.message : String(err), "error");
      }
    });
  }

  private renderSignEditor(container: HTMLElement): void {
    const locale = i18n.getLocale();
    const sign = this.manager.getSign(this.selectedAssetId);
    const isMissing = !sign;
    if (isMissing) {
      container.innerHTML = `
        <div class="asset-empty-hint">
          <p>${locale === "en" ? "No road sign selected." : locale === "zh" ? "未选择道路标志。" : "道路標識が選択されていません。"}</p>
          <button type="button" class="hud-btn active" id="asset-new-sign-btn">
            ${locale === "en" ? "+ Add New Sign" : locale === "zh" ? "+ 新增标志" : "+ 新規標識を追加"}
          </button>
        </div>
      `;
      const newBtnEmpty = container.querySelector<HTMLButtonElement>("#asset-new-sign-btn");
      newBtnEmpty?.addEventListener("click", () => {
        this.createNewSignEntry();
      });
      return;
    }
    const spec = ROAD_SIGN_CATALOG[sign.type];
    const catLabel = localizeRoadSignCategory(spec.category, locale);

    container.innerHTML = `
      <div class="asset-editor-header">
        <div>
          <span class="asset-editor-badge">JDM ROAD SIGN (${catLabel})</span>
          <h3 class="asset-editor-title">${localizeRoadSignTitle(sign.type, locale)}</h3>
        </div>
        <code class="asset-editor-path">${sign.id}</code>
      </div>
      <div class="sign-field-grid">
        <div class="sign-field">
          <label for="asset-sign-type">Sign Type</label>
          <select id="asset-sign-type">
            ${Object.values(ROAD_SIGN_CATALOG)
              .map(
                (item) =>
                  `<option value="${item.type}" ${item.type === sign.type ? "selected" : ""}>${localizeRoadSignTitle(item.type, locale)}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="sign-field">
          <label for="asset-sign-label">Label</label>
          <input id="asset-sign-label" type="text" value="${sign.label ?? ""}" />
        </div>
        <div class="sign-field">
          <label for="asset-sign-sublabel">Sub Label</label>
          <input id="asset-sign-sublabel" type="text" value="${sign.subLabel ?? ""}" />
        </div>
        <div class="sign-field">
          <label for="asset-sign-speed">Speed Limit (km/h)</label>
          <input id="asset-sign-speed" type="number" step="10" min="10" max="120" value="${sign.speedLimit ?? 50}" />
        </div>
        <div class="sign-field">
          <label for="asset-sign-pos-x">Position X (m)</label>
          <input id="asset-sign-pos-x" type="number" step="0.5" value="${sign.position[0]}" />
        </div>
        <div class="sign-field">
          <label for="asset-sign-pos-z">Position Z (m)</label>
          <input id="asset-sign-pos-z" type="number" step="0.5" value="${sign.position[2]}" />
        </div>
      </div>
      <div class="sign-action-row">
        <button type="button" class="hud-btn active" id="asset-apply-sign-btn">
          ${locale === "en" ? "Save & Sync Sign" : locale === "zh" ? "保存并同步标志" : "標識設定を更新・3D反映"}
        </button>
        <button type="button" class="hud-btn" id="asset-new-sign-btn">
          ${locale === "en" ? "+ New Sign" : locale === "zh" ? "+ 新增标志" : "+ 新規標識を追加"}
        </button>
        <button type="button" class="hud-btn" id="asset-delete-sign-btn">
          ${locale === "en" ? "Delete Sign" : locale === "zh" ? "删除标志" : "この標識を削除"}
        </button>
      </div>
    `;

    const applyBtn = container.querySelector<HTMLButtonElement>("#asset-apply-sign-btn");
    applyBtn?.addEventListener("click", () => {
      const typeVal = ((container.querySelector("#asset-sign-type") as HTMLSelectElement)?.value ??
        sign.type) as RoadSignType;
      const labelVal = (
        container.querySelector("#asset-sign-label") as HTMLInputElement
      )?.value.trim();
      const subLabelVal = (
        container.querySelector("#asset-sign-sublabel") as HTMLInputElement
      )?.value.trim();
      const speedVal = Number.parseInt(
        (container.querySelector("#asset-sign-speed") as HTMLInputElement)?.value ?? "50",
        10,
      );
      const px = Number.parseFloat(
        (container.querySelector("#asset-sign-pos-x") as HTMLInputElement)?.value ??
          String(sign.position[0]),
      );
      const pz = Number.parseFloat(
        (container.querySelector("#asset-sign-pos-z") as HTMLInputElement)?.value ??
          String(sign.position[2]),
      );

      try {
        const updated = this.manager.upsertSign({
          ...sign,
          type: typeVal,
          label: labelVal || undefined,
          subLabel: subLabelVal || undefined,
          speedLimit: Number.isFinite(speedVal) ? speedVal : undefined,
          position: [
            Number.isFinite(px) ? px : sign.position[0],
            sign.position[1],
            Number.isFinite(pz) ? pz : sign.position[2],
          ],
        });
        this.bridge.onApplySignToScene?.(updated);
        this.setStatus(`Updated road sign '${updated.id}'.`, "ok");
        this.renderItemList();
        this.renderPreviewCanvas();
      } catch (err) {
        this.setStatus(err instanceof Error ? err.message : String(err), "error");
      }
    });

    const newBtn = container.querySelector<HTMLButtonElement>("#asset-new-sign-btn");
    newBtn?.addEventListener("click", () => {
      this.createNewSignEntry();
    });

    const deleteBtn = container.querySelector<HTMLButtonElement>("#asset-delete-sign-btn");
    deleteBtn?.addEventListener("click", () => {
      const removed = this.manager.removeSign(sign.id);
      if (removed) {
        this.bridge.onRemoveSignFromScene?.(sign.id);
        this.ensureValidSelection();
        this.setStatus(`Removed sign '${sign.id}' from manifest.`, "warn");
        this.renderAll();
      }
    });
  }

  private createNewSignEntry(): void {
    const existingCount = this.manager.getSigns().length;
    const newId = `sign_custom_${existingCount + 1}_${Date.now().toString(36).slice(-4)}`;
    const created = this.manager.upsertSign({
      id: newId,
      type: "speed_limit",
      position: [-6.5, 0, 12],
      rotationY: 0,
      speedLimit: 40,
      label: "40",
      subLabel: "高輪ゲートウェイ",
    });
    this.selectedAssetId = created.id;
    this.bridge.onApplySignToScene?.(created);
    this.setStatus(`Created new road sign '${created.id}'.`, "ok");
    this.renderAll();
  }

  private renderWeatherPresetEditor(container: HTMLElement): void {
    const preset = this.manager.getWeatherPreset(this.selectedAssetId);
    const isMissing = !preset;
    if (isMissing) {
      return;
    }
    const locale = i18n.getLocale();

    container.innerHTML = `
      <div class="asset-editor-header">
        <div>
          <span class="asset-editor-badge">ATMOSPHERIC / LIGHTING PRESET</span>
          <h3 class="asset-editor-title">${preset.name}</h3>
        </div>
        <code class="asset-editor-path">id: ${preset.id}</code>
      </div>
      <div class="sign-field-grid">
        <div class="sign-field">
          <label for="asset-weather-sky">Sky Zenith Color</label>
          <input id="asset-weather-sky" type="color" value="${numberToHexColorString(preset.skyColor)}" />
        </div>
        <div class="sign-field">
          <label for="asset-weather-sun">Sun / Moon Color</label>
          <input id="asset-weather-sun" type="color" value="${numberToHexColorString(preset.sunColor)}" />
        </div>
        <div class="sign-field">
          <label for="asset-weather-fog-color">Horizon / Fog Color</label>
          <input id="asset-weather-fog-color" type="color" value="${numberToHexColorString(preset.fogColor)}" />
        </div>
        <div class="sign-field">
          <label for="asset-weather-fog-density">Fog Density</label>
          <input id="asset-weather-fog-density" type="number" step="0.0005" min="0" max="0.05" value="${preset.fogDensity}" />
        </div>
        <div class="sign-field">
          <label for="asset-weather-rain-intensity">Rain Intensity (0.0 - 1.0)</label>
          <input id="asset-weather-rain-intensity" type="number" step="0.05" min="0" max="1" value="${preset.rain.intensity}" />
        </div>
        <div class="sign-field">
          <label for="asset-weather-flare-intensity">Lensflare Intensity</label>
          <input id="asset-weather-flare-intensity" type="number" step="0.1" min="0" max="3" value="${preset.lensflare.intensity}" />
        </div>
      </div>
      <div class="sign-action-row">
        <button type="button" class="hud-btn active" id="asset-apply-weather-btn">
          ${locale === "en" ? "Apply Preset to 3D Sky & Weather" : locale === "zh" ? "应用预设到 3D 天空与天气" : "プリセットを更新して3D空間へ即時適用"}
        </button>
      </div>
    `;

    const applyBtn = container.querySelector<HTMLButtonElement>("#asset-apply-weather-btn");
    applyBtn?.addEventListener("click", () => {
      const skyHex = (container.querySelector("#asset-weather-sky") as HTMLInputElement)?.value;
      const sunHex = (container.querySelector("#asset-weather-sun") as HTMLInputElement)?.value;
      const fogHex = (container.querySelector("#asset-weather-fog-color") as HTMLInputElement)
        ?.value;
      const fogDensity = Number.parseFloat(
        (container.querySelector("#asset-weather-fog-density") as HTMLInputElement)?.value ??
          String(preset.fogDensity),
      );
      const rainIntensity = Number.parseFloat(
        (container.querySelector("#asset-weather-rain-intensity") as HTMLInputElement)?.value ??
          String(preset.rain.intensity),
      );
      const flareIntensity = Number.parseFloat(
        (container.querySelector("#asset-weather-flare-intensity") as HTMLInputElement)?.value ??
          String(preset.lensflare.intensity),
      );

      try {
        const clampedRain = Math.max(
          0,
          Math.min(1, Number.isFinite(rainIntensity) ? rainIntensity : 0),
        );
        const updated = this.manager.updateWeatherPreset(preset.id, {
          skyColor: hexColorStringToNumber(skyHex, preset.skyColor),
          sunColor: hexColorStringToNumber(sunHex, preset.sunColor),
          fogColor: hexColorStringToNumber(fogHex, preset.fogColor),
          fogDensity:
            Number.isFinite(fogDensity) && fogDensity >= 0 ? fogDensity : preset.fogDensity,
          rain: {
            ...preset.rain,
            enabled: clampedRain > 0.01,
            intensity: clampedRain,
          },
          lensflare: {
            ...preset.lensflare,
            enabled: flareIntensity > 0.01,
            intensity: Number.isFinite(flareIntensity) && flareIntensity >= 0 ? flareIntensity : 0,
          },
        });
        this.bridge.onApplyWeatherPresetToScene?.(updated);
        this.setStatus(`Applied weather preset '${updated.id}' to 3D scene.`, "ok");
        this.renderItemList();
        this.renderPreviewCanvas();
      } catch (err) {
        this.setStatus(err instanceof Error ? err.message : String(err), "error");
      }
    });
  }

  private renderYamlEditor(container: HTMLElement): void {
    const yamlText = this.manager.toYamlString();
    const locale = i18n.getLocale();

    container.innerHTML = `
      <div class="asset-editor-header">
        <div>
          <span class="asset-editor-badge">DECLARATIVE YAML MANIFEST (ZOD VALIDATED)</span>
          <h3 class="asset-editor-title">config/assets.yml</h3>
        </div>
      </div>
      <div class="sign-field full-width">
        <textarea id="asset-yaml-full-textarea" class="sign-yaml-output asset-yaml-large" spellcheck="false"></textarea>
      </div>
      <div class="sign-action-row">
        <button type="button" class="hud-btn active" id="asset-validate-apply-yaml-btn">
          ${locale === "en" ? "Validate & Apply YAML" : locale === "zh" ? "验证并应用 YAML" : "Zod検証してマニフェストへ反映"}
        </button>
        <button type="button" class="hud-btn" id="asset-copy-yaml-btn">
          ${locale === "en" ? "Copy YAML" : locale === "zh" ? "复制 YAML" : "YAMLをコピー"}
        </button>
        <button type="button" class="hud-btn" id="asset-download-yaml-btn">
          ${locale === "en" ? "Download assets.yml" : locale === "zh" ? "下载 assets.yml" : "assets.yml を保存"}
        </button>
      </div>
    `;

    const textarea = container.querySelector<HTMLTextAreaElement>("#asset-yaml-full-textarea");
    if (textarea) {
      textarea.value = yamlText;
    }

    const applyBtn = container.querySelector<HTMLButtonElement>("#asset-validate-apply-yaml-btn");
    applyBtn?.addEventListener("click", () => {
      const content = textarea?.value ?? "";
      const validation = this.manager.validateYamlString(content);
      const isInvalid = !validation.valid;
      if (isInvalid) {
        this.setStatus(`Zod Validation Failed: ${validation.errors.join(" | ")}`, "error");
        return;
      }
      this.manager.loadFromYamlString(content);
      this.bridge.onManifestReloaded?.();
      this.setStatus("YAML manifest validated with Zod and applied to runtime.", "ok");
      this.renderAll();
    });

    const copyBtn = container.querySelector<HTMLButtonElement>("#asset-copy-yaml-btn");
    copyBtn?.addEventListener("click", () => {
      const content = textarea?.value ?? this.manager.toYamlString();
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(content);
      }
      this.setStatus("Copied YAML manifest to clipboard.", "ok");
    });

    const downloadBtn = container.querySelector<HTMLButtonElement>("#asset-download-yaml-btn");
    downloadBtn?.addEventListener("click", () => {
      const content = textarea?.value ?? this.manager.toYamlString();
      const isBrowser = typeof Blob !== "undefined" && typeof URL.createObjectURL === "function";
      if (isBrowser) {
        const blob = new Blob([content], { type: "text/yaml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "assets.yml";
        a.click();
        URL.revokeObjectURL(url);
        this.setStatus("Downloaded assets.yml.", "ok");
      }
    });
  }

  public renderPreviewCanvas(): void {
    const isMissingCanvas = !this.previewCanvas;
    if (isMissingCanvas) {
      return;
    }
    const ctx = this.previewCanvas.getContext("2d");
    const isMissingCtx = !ctx;
    if (isMissingCtx) {
      return;
    }

    const w = this.previewCanvas.width;
    const h = this.previewCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // 共通ダークグリッド背景
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0b1528");
    grad.addColorStop(1, "#0f172a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(56, 189, 248, 0.12)";
    ctx.lineWidth = 1;
    for (let x = 20; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 20; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (this.activeTab === "signs") {
      const sign = this.manager.getSign(this.selectedAssetId);
      if (sign && this.previewCanvas) {
        const signSystem = new RoadSignSystem();
        signSystem.renderSignPreviewToCanvas(sign, this.previewCanvas);
      }
      return;
    }

    if (this.activeTab === "models") {
      const model = this.manager.getModelConfig(this.selectedAssetId);
      if (model) {
        this.drawModelWireframePreview(ctx, w, h, model);
      }
      return;
    }

    if (this.activeTab === "textures3d") {
      const tex = this.manager.getTexture3DConfig(this.selectedAssetId);
      if (tex) {
        this.drawTexture3DVoxelPreview(ctx, w, h, tex);
      }
      return;
    }

    if (this.activeTab === "roads") {
      const road = this.manager.getRoad(this.selectedAssetId);
      if (road) {
        this.drawRoadCrossSectionPreview(ctx, w, h, road);
      }
      return;
    }

    if (this.activeTab === "weatherPresets") {
      const preset = this.manager.getWeatherPreset(this.selectedAssetId);
      if (preset) {
        this.drawWeatherPresetPreview(ctx, w, h, preset);
      }
      return;
    }

    // YAML タブ時: アセット構成サマリーチャートを描画
    this.drawManifestDistributionPreview(ctx, w, h);
  }

  private ensureModelGltfLoaded(model: ModelAsset): THREE.Group | null {
    const cached = this.gltfCache.get(model.id);
    if (cached) {
      return cached;
    }
    const isBrowserEnv =
      typeof window !== "undefined" &&
      typeof document !== "undefined" &&
      typeof fetch === "function";
    if (!isBrowserEnv || this.gltfLoading.has(model.id)) {
      return null;
    }
    this.gltfLoading.add(model.id);
    const loader = new GLTFLoader();
    const assetUrl = this.manager.resolveAssetUrl(model.path);
    loader.load(
      assetUrl,
      (gltf) => {
        this.gltfLoading.delete(model.id);
        gltf.scene.updateMatrixWorld(true);
        this.gltfCache.set(model.id, gltf.scene);
        this.renderPreviewCanvas();
      },
      undefined,
      () => {
        this.gltfLoading.delete(model.id);
      },
    );
    return null;
  }

  private drawModelWireframePreview(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    model: ModelAsset,
  ): void {
    const loadedScene = this.ensureModelGltfLoaded(model);
    if (loadedScene) {
      this.drawRealGltf360Preview(ctx, w, h, model, loadedScene);
      return;
    }

    const cx = w * 0.5;
    const cy = h * 0.54;
    const rad = (this.previewYawDeg * Math.PI) / 180;
    const cosY = Math.cos(rad);
    const sinY = Math.sin(rad);

    // モデル種別に応じた実寸比率ボックス（GLBロード完了までのフォールバック表示）
    const baseDims: [number, number, number] =
      model.id === "car"
        ? [1.84, 1.43, 4.72]
        : model.id === "tokyo_station"
          ? [5.2, 2.2, 1.8]
          : model.id === "shibuya_stream"
            ? [2.2, 5.0, 2.2]
            : model.id === "street_tree"
              ? [2.4, 4.4, 2.4]
              : [3.2, 1.2, 0.6];

    const hx = baseDims[0] * model.scale[0] * 14 * this.previewZoom;
    const hy = baseDims[1] * model.scale[1] * 14 * this.previewZoom;
    const hz = baseDims[2] * model.scale[2] * 14 * this.previewZoom;

    const project = (x: number, y: number, z: number): [number, number] => {
      const rx = x * cosY - z * sinY;
      const rz = x * sinY + z * cosY;
      const px = cx + rx;
      const py = cy - y + rz * 0.35;
      return [px, py];
    };

    const corners: Array<[number, number, number]> = [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [hx, hy, hz],
      [-hx, hy, hz],
    ];
    const pts = corners.map(([x, y, z]) => project(x, y, z));
    const edges: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];

    ctx.strokeStyle = numberToHexColorString(model.fallbackColor);
    ctx.lineWidth = 2;
    for (const [a, b] of edges) {
      const pa = pts[a]!;
      const pb = pts[b]!;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 12px monospace";
    ctx.fillText(
      `${model.id} [360° Inspector: Yaw ${Math.round(this.previewYawDeg)}° / Pitch ${Math.round(this.previewPitchDeg)}°]`,
      12,
      22,
    );
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(
      `Scale: [${model.scale.join(", ")}] | Preset: ${this.previewViewPreset}`,
      12,
      h - 12,
    );
  }

  /**
   * 実 GLB メッシュを読み込んで 360度自由回転・車内コックピット視点・運転席足元視点・車内断面カットを描画する 3D インスペクタ
   */
  private drawRealGltf360Preview(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    model: ModelAsset,
    sceneRoot: THREE.Group,
  ): void {
    sceneRoot.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(sceneRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    const yawRad = (this.previewYawDeg * Math.PI) / 180;
    const pitchRad = (this.previewPitchDeg * Math.PI) / 180;

    const camPos = new THREE.Vector3();
    const camTarget = new THREE.Vector3();
    const isCar = model.id === "car";

    if (isCar && (this.previewViewPreset === "cockpit" || this.previewViewPreset === "footwell")) {
      // 右ハンドル運転席ドライバー視点 (x = -0.38m) から 360度車内を見回すモード
      camPos.set(
        -0.38,
        this.previewViewPreset === "footwell" ? 1.06 : 1.13,
        this.previewViewPreset === "footwell" ? -0.02 : 0.06,
      );
      const lookDist = 1.2;
      const forwardX = -Math.sin(yawRad) * Math.cos(pitchRad);
      const forwardY = -Math.sin(pitchRad);
      const forwardZ = Math.cos(yawRad) * Math.cos(pitchRad);
      camTarget.set(
        camPos.x + forwardX * lookDist,
        camPos.y + forwardY * lookDist,
        camPos.z + forwardZ * lookDist,
      );
    } else if (isCar && this.previewViewPreset === "cutaway") {
      // 車内断面カット確認モード（運転席・ステアリング・センターコンソール・シート座面・足元ペダルが埋まっていないか横/斜めから確認）
      const radius = 2.55 / Math.max(0.4, this.previewZoom);
      camTarget.set(-0.12, 0.72, 0.18);
      camPos.set(
        camTarget.x + Math.sin(yawRad) * Math.cos(pitchRad) * radius,
        camTarget.y + Math.sin(pitchRad) * radius,
        camTarget.z + Math.cos(yawRad) * Math.cos(pitchRad) * radius,
      );
    } else {
      const maxDim = Math.max(1.5, size.length() * 0.62);
      const radius = maxDim / Math.max(0.4, this.previewZoom);
      camTarget.copy(center);
      camPos.set(
        center.x + Math.sin(yawRad) * Math.cos(pitchRad) * radius,
        center.y + Math.sin(pitchRad) * radius,
        center.z + Math.cos(yawRad) * Math.cos(pitchRad) * radius,
      );
    }

    const forward = camTarget.clone().sub(camPos).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
    if (right.lengthSq() < 1e-4) {
      right.set(1, 0, 0);
    }
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();

    const fovScale =
      this.previewViewPreset === "cockpit" || this.previewViewPreset === "footwell"
        ? Math.min(w, h) * 0.92 * this.previewZoom
        : Math.min(w, h) * 1.18;
    const nearClip =
      this.previewViewPreset === "cockpit" || this.previewViewPreset === "footwell" ? 0.08 : 0.25;

    interface ProjectedTri {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      depth: number;
      fillStyle: string;
      strokeStyle: string;
    }

    const tris: ProjectedTri[] = [];
    const lightDir = new THREE.Vector3(-0.42, 0.82, 0.38).normalize();
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();
    const relA = new THREE.Vector3();
    const relB = new THREE.Vector3();
    const relC = new THREE.Vector3();

    sceneRoot.traverse((obj) => {
      const isMesh = (obj as THREE.Mesh).isMesh;
      if (!isMesh) {
        return;
      }
      const mesh = obj as THREE.Mesh;
      const geo = mesh.geometry;
      const posAttr = geo?.getAttribute("position");
      if (!posAttr) {
        return;
      }

      // 断面カット / 車内視点では外装ガラスを半透明またはスキップして車内構造を鮮明に可視化
      const meshName = mesh.name || obj.parent?.name || "";
      const isGlassMesh =
        meshName.includes("Windshield") ||
        meshName.includes("Window") ||
        meshName.includes("Glass");
      if (isGlassMesh && this.previewViewPreset !== "exterior") {
        return;
      }

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups =
        geo.groups.length > 0
          ? geo.groups
          : [
              {
                start: 0,
                count: geo.index ? geo.index.count : posAttr.count,
                materialIndex: 0,
              },
            ];

      const idxAttr = geo.index;
      // 1フレームで高速描画できるよう総三角形数が多い場合は間引きステップを自動調整
      const totalTriCount = Math.floor((idxAttr ? idxAttr.count : posAttr.count) / 3);
      const stepTri = totalTriCount > 3200 ? 2 : 1;

      for (const grp of groups) {
        const mat = (mats[grp.materialIndex ?? 0] ?? mats[0]) as
          | THREE.MeshStandardMaterial
          | undefined;
        const baseColor = mat?.color ? mat.color : new THREE.Color(model.fallbackColor);
        const matName = mat?.name ?? "";
        const isInteriorHighlight =
          meshName === "SteeringWheel" ||
          meshName === "Interior" ||
          matName.includes("Wood") ||
          matName.includes("Saddle") ||
          matName.includes("Silver") ||
          matName.includes("Chrome");

        const endIdx = grp.start + grp.count;
        for (let i = grp.start; i + 2 < endIdx; i += 3 * stepTri) {
          const ia = idxAttr ? idxAttr.getX(i) : i;
          const ib = idxAttr ? idxAttr.getX(i + 1) : i + 1;
          const ic = idxAttr ? idxAttr.getX(i + 2) : i + 2;

          vA.fromBufferAttribute(posAttr, ia)
            .applyMatrix4(mesh.matrixWorld)
            .multiply(new THREE.Vector3(model.scale[0], model.scale[1], model.scale[2]));
          vB.fromBufferAttribute(posAttr, ib)
            .applyMatrix4(mesh.matrixWorld)
            .multiply(new THREE.Vector3(model.scale[0], model.scale[1], model.scale[2]));
          vC.fromBufferAttribute(posAttr, ic)
            .applyMatrix4(mesh.matrixWorld)
            .multiply(new THREE.Vector3(model.scale[0], model.scale[1], model.scale[2]));

          // 車内断面カット (`cutaway`) 時は、運転席側外装ドア・ルーフ (x < -0.73 または y > 1.32) の Chassis メッシュを切り欠いて車内下半分を露出させる
          if (isCar && this.previewViewPreset === "cutaway" && meshName === "Chassis") {
            const avgZ = (vA.z + vB.z + vC.z) / 3;
            const avgY = (vA.y + vB.y + vC.y) / 3;
            const avgX = (vA.x + vB.x + vC.x) / 3;
            const isCutawaySideOrRoof =
              avgZ > -1.32 && avgZ < 0.92 && (avgY > 1.25 || avgX < -0.68 || avgX > 0.68);
            if (isCutawaySideOrRoof) {
              continue;
            }
          }

          relA.subVectors(vA, camPos);
          relB.subVectors(vB, camPos);
          relC.subVectors(vC, camPos);

          const zA = relA.dot(forward);
          const zB = relB.dot(forward);
          const zC = relC.dot(forward);
          if (zA < nearClip || zB < nearClip || zC < nearClip) {
            continue;
          }

          const x0 = w * 0.5 + (relA.dot(right) / zA) * fovScale;
          const y0 = h * 0.52 - (relA.dot(up) / zA) * fovScale;
          const x1 = w * 0.5 + (relB.dot(right) / zB) * fovScale;
          const y1 = h * 0.52 - (relB.dot(up) / zB) * fovScale;
          const x2 = w * 0.5 + (relC.dot(right) / zC) * fovScale;
          const y2 = h * 0.52 - (relC.dot(up) / zC) * fovScale;

          edge1.subVectors(vB, vA);
          edge2.subVectors(vC, vA);
          faceNormal.crossVectors(edge1, edge2).normalize();
          const ndotl = Math.abs(faceNormal.dot(lightDir));
          const shade = 0.42 + ndotl * 0.68 + (isInteriorHighlight ? 0.14 : 0);

          const r = Math.min(
            255,
            Math.floor(baseColor.r * 255 * shade + (isInteriorHighlight ? 18 : 0)),
          );
          const g = Math.min(
            255,
            Math.floor(baseColor.g * 255 * shade + (isInteriorHighlight ? 22 : 0)),
          );
          const b = Math.min(
            255,
            Math.floor(baseColor.b * 255 * shade + (isInteriorHighlight ? 28 : 0)),
          );

          tris.push({
            x0,
            y0,
            x1,
            y1,
            x2,
            y2,
            depth: (zA + zB + zC) / 3,
            fillStyle: `rgb(${r}, ${g}, ${b})`,
            strokeStyle:
              meshName === "SteeringWheel"
                ? "rgba(56, 189, 248, 0.55)"
                : meshName === "Interior"
                  ? "rgba(251, 191, 36, 0.28)"
                  : "rgba(148, 163, 184, 0.18)",
          });
        }
      }
    });

    tris.sort((a, b) => b.depth - a.depth);

    ctx.lineWidth = 0.65;
    for (const tri of tris) {
      ctx.beginPath();
      ctx.moveTo(tri.x0, tri.y0);
      ctx.lineTo(tri.x1, tri.y1);
      ctx.lineTo(tri.x2, tri.y2);
      ctx.closePath();
      ctx.fillStyle = tri.fillStyle;
      ctx.fill();
      if (this.previewWireframeOverlay) {
        ctx.strokeStyle = tri.strokeStyle;
        ctx.stroke();
      }
    }

    // オーバーレイ HUD 情報
    ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
    ctx.fillRect(8, 6, w - 16, 22);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 11px monospace";
    ctx.fillText(
      `360° GLB Inspector: ${model.id} [${this.previewViewPreset.toUpperCase()}] Yaw:${Math.round(this.previewYawDeg)}° Pitch:${Math.round(this.previewPitchDeg)}°`,
      14,
      21,
    );

    ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
    ctx.fillRect(8, h - 24, w - 16, 18);
    ctx.fillStyle = "#34d399";
    ctx.font = "bold 10px monospace";
    ctx.fillText(
      `Meshes Rendered: ${tris.length} tris | Cabin Floor Z=0.36m (Chassis Tub Z=0.33m - Unburied OK)`,
      14,
      h - 11,
    );
  }

  private drawTexture3DVoxelPreview(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    tex: Texture3DAsset,
  ): void {
    const grid = Math.min(16, tex.resolution);
    const cellSize = Math.floor(Math.min(w - 40, h - 60) / grid);
    const startX = Math.floor((w - cellSize * grid) * 0.5);
    const startY = 34;
    const zSlice = Math.floor(this.previewSliceZ * (tex.resolution - 1));

    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const seed =
          Math.sin(x * 12.9898 + y * 78.233 + zSlice * 37.719) * 43758.5453 * tex.roughnessScale;
        const frac = seed - Math.floor(seed);
        const shade = Math.floor(45 + frac * 195);
        ctx.fillStyle =
          tex.type === "foliage_bark"
            ? `rgb(${Math.floor(shade * 0.5)}, ${shade}, ${Math.floor(shade * 0.4)})`
            : tex.type === "water_caustics"
              ? `rgb(${Math.floor(shade * 0.3)}, ${Math.floor(shade * 0.8)}, ${shade})`
              : `rgb(${shade}, ${shade}, ${Math.min(255, Math.floor(shade * 1.1))})`;
        ctx.fillRect(startX + x * cellSize, startY + y * cellSize, cellSize - 1, cellSize - 1);
      }
    }

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 12px monospace";
    ctx.fillText(`${tex.id} (${tex.resolution}³) Z-Slice: ${zSlice}`, 12, 22);
  }

  private drawRoadCrossSectionPreview(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    road: RoadDefinition,
  ): void {
    const midY = h * 0.56;
    const totalW = road.width + (road.hasSidewalk ? road.sidewalkWidth * 2 : 0);
    const scale = Math.min(8.5, (w - 36) / Math.max(10, totalW));
    const roadPx = road.width * scale;
    const swPx = road.hasSidewalk ? road.sidewalkWidth * scale : 0;
    const startX = (w - (roadPx + swPx * 2)) * 0.5;
    const roadLeft = startX + swPx;
    const roadRight = roadLeft + roadPx;
    const roadTop = midY - 40;
    const roadBottom = midY + 34;
    const roadH = roadBottom - roadTop;

    // 歩道
    if (road.hasSidewalk && swPx > 0) {
      ctx.fillStyle = "#475569";
      ctx.fillRect(startX, roadTop - 2, swPx, roadH + 4);
      ctx.fillRect(roadRight, roadTop - 2, swPx, roadH + 4);
    }

    // 車道アスファルト
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(roadLeft, roadTop, roadPx, roadH);

    // 上部の横断歩道エリア（縦断ラインが横断歩道・停止線と重ならないよう下端を明確に分離）
    const hasCrosswalk = road.markings.hasCrosswalks;
    const crosswalkTop = roadTop + 4;
    const crosswalkH = 12;
    const stopLineY = crosswalkTop + crosswalkH + 5;
    const laneLineStartY = hasCrosswalk ? stopLineY + 4 : roadTop + 3;
    const laneLineEndY = roadBottom - 3;

    const centerX = roadLeft + roadPx * 0.5;
    const lanesPerDir = Math.max(1, Math.floor(road.lanes * 0.5));
    const halfRoadPx = roadPx * 0.5;
    const laneWidthPx = halfRoadPx / lanesPerDir;

    // 路肩実線（横断歩道・停止線区間は除外して描画）
    const shoulderInsetPx = Math.max(2, scale * 0.65);
    ctx.strokeStyle = "rgba(248, 250, 252, 0.88)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    for (const edgeX of [roadLeft + shoulderInsetPx, roadRight - shoulderInsetPx]) {
      ctx.beginPath();
      ctx.moveTo(edgeX, laneLineStartY);
      ctx.lineTo(edgeX, laneLineEndY);
      ctx.stroke();
    }

    // 車線境界白破線（複数車線の場合：各車線を分割して描画し、横断歩道区間は除外）
    if (lanesPerDir > 1) {
      ctx.strokeStyle = "rgba(248, 250, 252, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 5]);
      for (let i = 1; i < lanesPerDir; i++) {
        const offsetPx = i * laneWidthPx;
        for (const sign of [-1, 1]) {
          const divX = centerX + sign * offsetPx;
          ctx.beginPath();
          ctx.moveTo(divX, laneLineStartY);
          ctx.lineTo(divX, laneLineEndY);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    // センターライン（横断歩道・停止線区間は除外）
    if (road.markings.centerLineType !== "none") {
      ctx.strokeStyle = road.markings.centerLineType === "solid_yellow" ? "#f59e0b" : "#f8fafc";
      ctx.lineWidth = 2;
      ctx.setLineDash(road.markings.centerLineType === "dashed_white" ? [6, 6] : []);
      ctx.beginPath();
      ctx.moveTo(centerX, laneLineStartY);
      ctx.lineTo(centerX, laneLineEndY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 横断歩道ゼブラ & 停止線（車線ラインと一切重ならない位置に配置）
    if (hasCrosswalk) {
      ctx.fillStyle = "rgba(248, 250, 252, 0.92)";
      const usableW = Math.max(8, roadPx - shoulderInsetPx * 2.6);
      const stripeStep = Math.max(5, Math.min(9, usableW / Math.max(4, road.lanes * 2.2)));
      const stripeW = stripeStep * 0.52;
      for (
        let sx = roadLeft + shoulderInsetPx * 1.3;
        sx + stripeW <= roadRight - shoulderInsetPx * 1.3;
        sx += stripeStep
      ) {
        ctx.fillRect(sx, crosswalkTop, stripeW, crosswalkH);
      }

      // 進行車線（左側通行 = 左半分）の停止線（センターライン・路肩線と重ならないマージン付き）
      const stopLeft = roadLeft + shoulderInsetPx + 1.5;
      const stopRight = centerX - 2.0;
      if (stopRight > stopLeft + 2) {
        ctx.fillRect(stopLeft, stopLineY - 1.5, stopRight - stopLeft, 2.5);
      }
    }

    // 各車線の進行方向矢印（左側：上向き ↑、右側：下向き ↓）
    if (laneWidthPx >= 9) {
      ctx.fillStyle = "rgba(226, 232, 240, 0.78)";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      const arrowY = laneLineStartY + (laneLineEndY - laneLineStartY) * 0.58;
      for (let i = 0; i < lanesPerDir; i++) {
        const inboundX = centerX - (i + 0.5) * laneWidthPx;
        const oncomingX = centerX + (i + 0.5) * laneWidthPx;
        ctx.fillText("↑", inboundX, arrowY);
        ctx.fillText("↓", oncomingX, arrowY);
      }
      ctx.textAlign = "start";
    }

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 12px monospace";
    ctx.fillText(
      `${road.name} (${road.lanes} Lanes [${lanesPerDir}+${lanesPerDir}] / ${road.speedLimit} km/h)`,
      12,
      20,
    );
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`Road: ${road.width}m | Sidewalk: ${road.sidewalkWidth}m`, 12, h - 10);
  }

  private drawWeatherPresetPreview(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    preset: WeatherPreset,
  ): void {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.72);
    skyGrad.addColorStop(0, numberToHexColorString(preset.skyColor));
    skyGrad.addColorStop(1, numberToHexColorString(preset.fogColor));
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h * 0.72);

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, h * 0.72, w, h * 0.28);

    // 太陽 / 月
    ctx.fillStyle = numberToHexColorString(preset.sunColor);
    ctx.beginPath();
    ctx.arc(w * 0.72, h * 0.32, 18, 0, Math.PI * 2);
    ctx.fill();

    // 雨ストリーク
    if (preset.rain.enabled && preset.rain.intensity > 0) {
      ctx.strokeStyle = "rgba(186, 230, 253, 0.65)";
      ctx.lineWidth = 1.2;
      const count = Math.floor(preset.rain.intensity * 45);
      for (let i = 0; i < count; i++) {
        const rx = ((i * 53) % (w - 20)) + 10;
        const ry = ((i * 29) % (h - 40)) + 15;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 4, ry + 14);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 12px monospace";
    ctx.fillText(`${preset.name} (fog: ${preset.fogDensity})`, 12, 22);
  }

  private drawManifestDistributionPreview(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    const s = this.manager.getManifestSummary();
    const bars = [
      { label: "Models", count: s.modelsCount, color: "#38bdf8" },
      { label: "3D Tex", count: s.textures3dCount, color: "#818cf8" },
      { label: "Roads", count: s.roadsCount, color: "#34d399" },
      { label: "Signs", count: s.signsCount, color: "#f59e0b" },
      { label: "Weather", count: s.weatherPresetsCount, color: "#f472b6" },
    ];
    const maxCount = Math.max(1, ...bars.map((b) => b.count));

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 12px monospace";
    ctx.fillText(`Manifest Overview (${s.totalAssetsCount} Total Assets)`, 12, 22);

    bars.forEach((bar, i) => {
      const y = 44 + i * 32;
      const barW = Math.max(12, ((w - 110) * bar.count) / maxCount);
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(`${bar.label}`, 12, y + 14);
      ctx.fillStyle = bar.color;
      ctx.fillRect(78, y, barW, 18);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(String(bar.count), 84 + barW, y + 14);
    });

    ctx.fillStyle = "#94a3b8";
    ctx.fillText(
      `VRAM: ${(s.estimated3DTextureVramBytes / (1024 * 1024)).toFixed(2)} MB`,
      12,
      h - 10,
    );
  }
}

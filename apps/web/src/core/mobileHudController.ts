import type { CameraMode, GazePreset, GraphicsQuality } from "../types";
import {
  LOCALE_DISPLAY_LABELS,
  i18n,
  localizeGraphicsQualityTexts,
  type SupportedLocale,
} from "./i18n";
import type { InputManager } from "./inputManager";
import { logger } from "./logger";

export type TouchUiVisibilityMode = "auto" | "on" | "off";

/**
 * URL クエリ文字列 (`?hud=0|off|false` または `?ui=0|off|false`) から初期 HUD 表示状態を解決する。
 * 既定では `true`（UI 表示）を返す。
 */
export function parseHudVisibilityQuery(search: string): boolean {
  const isEmptySearch = typeof search !== "string" || search.trim().length === 0;
  if (isEmptySearch) {
    return true;
  }
  const params = new URLSearchParams(search);
  const rawHud = (params.get("hud") ?? params.get("ui") ?? "").trim().toLowerCase();
  const isForcedOff = rawHud === "0" || rawHud === "off" || rawHud === "false" || rawHud === "hide";
  if (isForcedOff) {
    return false;
  }
  return true;
}

export interface MobileHudQuickBarState {
  cameraMode: CameraMode;
  gazePreset: GazePreset;
  area: "tokyo" | "shibuya";
  graphicsQuality?: GraphicsQuality;
  locale?: SupportedLocale;
}

export interface MobileHudControllerOptions {
  inputManager: InputManager;
  onToggleCamera?: () => void;
  onSelectGazePreset?: (preset: GazePreset) => void;
  onToggleArea?: () => void;
  onToggleGraphicsQuality?: () => void;
  onToggleSound?: () => void;
  onToggleLocale?: () => void;
  onResetVehicle?: () => void;
}

/**
 * スマートフォン（Chrome for Android / iOS）およびタブレット・PCレスポンシブ HUD・仮想タッチコントローラー管理
 * - Why not PC用の全設定パネル（9グループ）とGISテレメトリをスマホ画面で常時展開したままにしないか:
 *   スマートフォン（縦持ち 390×844 / 横持ち 844×390 等）では、設定パネル群とテレメトリ枠を常時表示すると
 *   フロントガラスの視界と仮想ペダル領域の大半が覆い隠され、運転操作と視認性が著しく損なわれるため。
 * - How:
 *   1. 画面上部に1タップで操作できる「クイック操作バー（視点・正面・左右/ルームミラー・計器ナビ・エリア・リセット・言語・設定開閉）」を配置する。
 *   2. 詳細環境設定（言語・時間帯・天候・路面・ワイパー・ブラー・標識作成）は折りたたみドロワー（`#hud-controls-drawer`）に格納し、開閉状態と `aria-expanded` を同期する。
 *   3. 画面下部には左手親指用の操舵クラスター（アナログスライドパッド＋左右ボタン）と右手親指用のペダルクラスター（アクセル・ブレーキ/後退・サイドブレーキ）をセーフエリア対応で配置する。
 */
export class MobileHudController {
  private readonly options: MobileHudControllerOptions;
  private isDrawerOpen = false;
  private isGisExpandedOnMobile = false;
  private isHudVisible = true;
  private hasDetectedTouch = false;
  private touchUiMode: TouchUiVisibilityMode = "auto";
  private lastQuickBarState: MobileHudQuickBarState | null = null;

  private readonly menuToggleBtn: HTMLButtonElement | null;
  private readonly controlsDrawer: HTMLElement | null;
  private readonly drawerBackdrop: HTMLElement | null;
  private readonly gisBox: HTMLElement | null;
  private readonly gisToggleBtn: HTMLButtonElement | null;
  private readonly hudUiToggleBtn: HTMLButtonElement | null;
  private readonly quickUiOffBtn: HTMLButtonElement | null;
  private readonly uiRestoreFab: HTMLButtonElement | null;
  private readonly uiVisibilityBtns: NodeListOf<HTMLButtonElement> | null;
  private readonly virtualTouchContainer: HTMLElement | null;
  private readonly steerReadoutEl: HTMLElement | null;
  private readonly touchUiModeBtns: NodeListOf<HTMLButtonElement> | null;

  constructor(options: MobileHudControllerOptions) {
    this.options = options;
    const hasDoc = typeof document !== "undefined";

    this.menuToggleBtn = hasDoc
      ? (document.getElementById("hud-menu-toggle-btn") as HTMLButtonElement | null)
      : null;
    this.controlsDrawer = hasDoc ? document.getElementById("hud-controls-drawer") : null;
    this.drawerBackdrop = hasDoc ? document.getElementById("hud-drawer-backdrop") : null;
    this.gisBox = hasDoc ? document.getElementById("gis-telemetry-box") : null;
    this.gisToggleBtn = hasDoc
      ? (document.getElementById("gis-toggle-btn") as HTMLButtonElement | null)
      : null;
    this.hudUiToggleBtn = hasDoc
      ? (document.getElementById("hud-ui-toggle-btn") as HTMLButtonElement | null)
      : null;
    this.quickUiOffBtn = hasDoc
      ? (document.getElementById("quick-ui-off-btn") as HTMLButtonElement | null)
      : null;
    this.uiRestoreFab = hasDoc
      ? (document.getElementById("ui-restore-fab") as HTMLButtonElement | null)
      : null;
    this.uiVisibilityBtns = hasDoc
      ? document.querySelectorAll<HTMLButtonElement>("#ui-visibility-buttons button")
      : null;
    this.virtualTouchContainer = hasDoc ? document.getElementById("virtual-touch-controls") : null;
    this.steerReadoutEl = hasDoc ? document.getElementById("touch-steer-readout") : null;
    this.touchUiModeBtns = hasDoc
      ? document.querySelectorAll<HTMLButtonElement>("#touch-ui-mode-buttons button")
      : null;

    this.initialize();
  }

  /**
   * 現在の環境がスマートフォン・タブレット等のタッチ主体またはコンパクト画面かどうかを判定する
   */
  public isCompactOrTouchViewport(): boolean {
    const isTouchDetected = this.hasDetectedTouch;
    if (isTouchDetected) {
      return true;
    }
    const isMissingWindow = typeof window === "undefined";
    if (isMissingWindow) {
      return false;
    }
    const isNarrowViewport = window.innerWidth <= 1024 || window.innerHeight <= 540;
    if (isNarrowViewport) {
      return true;
    }
    const hasMatchMedia = typeof window.matchMedia === "function";
    if (hasMatchMedia) {
      const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
      if (isCoarsePointer) {
        return true;
      }
    }
    return false;
  }

  private initialize(): void {
    const { inputManager } = this.options;
    const isMissingDoc = typeof document === "undefined";
    if (isMissingDoc) {
      return;
    }

    // URLクエリ `?touch=1` または `?touch=on` 指定時は初期からタッチUIを強制表示、
    // `?hud=0` / `?ui=off` 指定時は初期から UI OFF（没入モード）で起動する
    const hasWindow = typeof window !== "undefined";
    if (hasWindow) {
      const params = new URLSearchParams(window.location.search);
      const touchParam = params.get("touch");
      const isForcedTouchOn = touchParam === "1" || touchParam === "on" || touchParam === "true";
      const isForcedTouchOff = touchParam === "0" || touchParam === "off" || touchParam === "false";
      if (isForcedTouchOn) {
        this.touchUiMode = "on";
      } else if (isForcedTouchOff) {
        this.touchUiMode = "off";
      }
      this.isHudVisible = parseHudVisibilityQuery(window.location.search);
    }

    // 1. 仮想タッチコントローラー要素を InputManager に接続
    inputManager.onTouchDetected = () => {
      const isFirstTouch = !this.hasDetectedTouch;
      this.hasDetectedTouch = true;
      if (isFirstTouch) {
        this.syncTouchUiVisibility();
      }
    };

    inputManager.attachVirtualControls({
      throttleBtn: document.getElementById("touch-throttle-btn"),
      brakeBtn: document.getElementById("touch-brake-btn"),
      handbrakeBtn: document.getElementById("touch-handbrake-btn"),
      steerLeftBtn: document.getElementById("touch-steer-left"),
      steerRightBtn: document.getElementById("touch-steer-right"),
      steerPad: document.getElementById("touch-steer-pad"),
      steerThumb: document.getElementById("touch-steer-thumb"),
      onSteerVisualChange: (steer) => {
        this.updateSteerReadout(steer);
      },
    });

    // 2. 設定ドロワー開閉ボタンとバックドロップ
    this.menuToggleBtn?.addEventListener("click", () => {
      this.setDrawerOpen(!this.isDrawerOpen);
    });
    this.drawerBackdrop?.addEventListener("click", () => {
      this.setDrawerOpen(false);
    });

    const closeDrawerBtn = document.getElementById("hud-drawer-close-btn");
    closeDrawerBtn?.addEventListener("click", () => {
      this.setDrawerOpen(false);
    });

    // 標識作成モーダルを開く際はドロワーを自動的に閉じる
    const openSignBtn = document.getElementById("open-sign-creator-btn");
    openSignBtn?.addEventListener("click", () => {
      this.setDrawerOpen(false);
    });

    // 3. モバイル用 GIS テレメトリ折りたたみボタン
    this.gisToggleBtn?.addEventListener("click", () => {
      this.setGisExpandedOnMobile(!this.isGisExpandedOnMobile);
    });

    // 4. タッチUI表示モード切替ボタン（AUTO / ON / OFF）
    this.touchUiModeBtns?.forEach((btn) => {
      btn.addEventListener("click", () => {
        const rawMode = btn.dataset.touchUiMode ?? btn.dataset.touchUi;
        const mode: TouchUiVisibilityMode =
          rawMode === "on" || rawMode === "off" ? rawMode : "auto";
        this.setTouchUiMode(mode);
      });
    });

    // 4.5. HUD UI 表示モード（UI ON / UI OFF 没入モード）切替ボタンとキーボードショートカット [Tab]
    this.hudUiToggleBtn?.addEventListener("click", () => {
      this.toggleHudVisibility("header_button");
    });
    this.quickUiOffBtn?.addEventListener("click", () => {
      this.setHudVisible(false, "quick_bar");
    });
    this.uiRestoreFab?.addEventListener("click", () => {
      this.setHudVisible(true, "restore_fab");
    });
    this.uiVisibilityBtns?.forEach((btn) => {
      btn.addEventListener("click", () => {
        const isVisibleTarget = btn.dataset.uiVisibility !== "off";
        this.setHudVisible(isVisibleTarget, "control_panel");
      });
    });
    inputManager.onHudVisibilityToggle = () => {
      this.toggleHudVisibility("keyboard_tab");
    };

    // 5. クイックアクションバーのボタン接続
    this.bindQuickActionButtons();

    // 6. 初期状態の反映・言語変更追従・リサイズ追従
    this.syncDrawerState();
    this.syncGisState();
    this.syncTouchUiVisibility();
    this.syncHudVisibilityState();

    i18n.onChange(() => {
      this.syncDrawerState();
      if (this.lastQuickBarState) {
        this.syncQuickBarState(this.lastQuickBarState);
      }
    });

    if (hasWindow) {
      window.addEventListener("resize", () => {
        inputManager.invalidateSteerPadRectCache();
        this.syncTouchUiVisibility();
      });
      window.visualViewport?.addEventListener("resize", () => {
        inputManager.invalidateSteerPadRectCache();
        this.syncTouchUiVisibility();
      });
      window.addEventListener("keydown", (e: KeyboardEvent) => {
        const isEscape = e.key === "Escape" && this.isDrawerOpen;
        if (isEscape) {
          this.setDrawerOpen(false);
        }
      });
    }
  }

  private bindQuickActionButtons(): void {
    const quickCameraBtn = document.getElementById("quick-camera-btn");
    quickCameraBtn?.addEventListener("click", () => {
      this.options.onToggleCamera?.();
    });

    const quickGazeForwardBtn = document.getElementById("quick-gaze-forward-btn");
    quickGazeForwardBtn?.addEventListener("click", () => {
      this.options.onSelectGazePreset?.("forward");
    });

    const quickMirrorLeftBtn = document.getElementById("quick-mirror-left-btn");
    quickMirrorLeftBtn?.addEventListener("click", () => {
      this.options.onSelectGazePreset?.("left_mirror");
    });

    const quickMirrorRearBtn = document.getElementById("quick-mirror-rear-btn");
    quickMirrorRearBtn?.addEventListener("click", () => {
      this.options.onSelectGazePreset?.("rearview_mirror");
    });

    const quickMirrorRightBtn = document.getElementById("quick-mirror-right-btn");
    quickMirrorRightBtn?.addEventListener("click", () => {
      this.options.onSelectGazePreset?.("right_mirror");
    });

    const quickNavGazeBtn = document.getElementById("quick-nav-gaze-btn");
    quickNavGazeBtn?.addEventListener("click", () => {
      this.options.onSelectGazePreset?.("dashboard");
    });

    const quickAreaBtn = document.getElementById("quick-area-btn");
    quickAreaBtn?.addEventListener("click", () => {
      this.options.onToggleArea?.();
    });

    const quickGraphicsBtn = document.getElementById("quick-graphics-btn");
    quickGraphicsBtn?.addEventListener("click", () => {
      this.options.onToggleGraphicsQuality?.();
    });

    const quickSoundBtn = document.getElementById("quick-sound-btn");
    quickSoundBtn?.addEventListener("click", () => {
      this.options.onToggleSound?.();
    });

    const quickResetBtn = document.getElementById("quick-reset-btn");
    quickResetBtn?.addEventListener("click", () => {
      this.options.onResetVehicle?.();
    });

    const quickLangBtn = document.getElementById("quick-lang-btn");
    quickLangBtn?.addEventListener("click", () => {
      this.options.onToggleLocale?.();
    });
  }

  public setDrawerOpen(open: boolean): void {
    this.isDrawerOpen = open;
    this.syncDrawerState();
    logger.info("ui", "hud.drawer.toggle", "HUD settings drawer toggled", { open });
  }

  public getDrawerOpen(): boolean {
    return this.isDrawerOpen;
  }

  private syncDrawerState(): void {
    this.controlsDrawer?.classList.toggle("is-open", this.isDrawerOpen);
    this.drawerBackdrop?.classList.toggle("is-open", this.isDrawerOpen);
    const menuBtn = this.menuToggleBtn;
    const hasMenuBtn = menuBtn !== null;
    if (hasMenuBtn) {
      const dict = i18n.t();
      menuBtn.setAttribute("aria-expanded", this.isDrawerOpen ? "true" : "false");
      menuBtn.classList.toggle("active", this.isDrawerOpen);
      menuBtn.textContent = this.isDrawerOpen ? dict.menuCloseBtn : dict.menuOpenBtn;
    }
  }

  public setGisExpandedOnMobile(expanded: boolean): void {
    this.isGisExpandedOnMobile = expanded;
    this.syncGisState();
    logger.info("ui", "hud.gis.toggle", "Mobile GIS telemetry visibility toggled", { expanded });
  }

  public getGisExpandedOnMobile(): boolean {
    return this.isGisExpandedOnMobile;
  }

  private syncGisState(): void {
    this.gisBox?.classList.toggle("is-collapsed-mobile", !this.isGisExpandedOnMobile);
    this.gisBox?.classList.toggle("is-mobile-expanded", this.isGisExpandedOnMobile);
    const gisBtn = this.gisToggleBtn;
    const hasGisBtn = gisBtn !== null;
    if (hasGisBtn) {
      gisBtn.setAttribute("aria-expanded", this.isGisExpandedOnMobile ? "true" : "false");
      gisBtn.classList.toggle("active", this.isGisExpandedOnMobile);
    }
  }

  public setTouchUiMode(mode: TouchUiVisibilityMode): void {
    this.touchUiMode = mode;
    this.syncTouchUiVisibility();
    logger.info("ui", "hud.touchMode.change", "Virtual touch controller visibility mode updated", {
      mode,
    });
  }

  public getTouchUiMode(): TouchUiVisibilityMode {
    return this.touchUiMode;
  }

  /**
   * HUD 全パネル（ヘッダー・テレメトリ・右設定パネル群・フッター操作ガイド・速度計）の表示 / 非表示（UI OFF モード）を切り替える
   */
  public setHudVisible(visible: boolean, source = "api"): void {
    const isUnchanged = this.isHudVisible === visible;
    this.isHudVisible = visible;
    const isHidingWithOpenDrawer = !visible && this.isDrawerOpen;
    if (isHidingWithOpenDrawer) {
      this.setDrawerOpen(false);
    }
    this.syncHudVisibilityState();
    this.syncTouchUiVisibility();
    if (!isUnchanged) {
      logger.withTrace(
        "ui",
        "hud.visibility.change",
        () => {
          // 構造化ログとして traceId 付きで記録
        },
        {
          hudVisible: visible,
          uiOffMode: !visible,
          source,
        },
      );
    }
  }

  public toggleHudVisibility(source = "toggle"): boolean {
    const nextVisible = !this.isHudVisible;
    this.setHudVisible(nextVisible, source);
    return nextVisible;
  }

  public getHudVisible(): boolean {
    return this.isHudVisible;
  }

  private syncHudVisibilityState(): void {
    const isUiOff = !this.isHudVisible;
    const hasDocBody = typeof document !== "undefined" && Boolean(document.body);
    if (hasDocBody) {
      document.body.classList.toggle("ui-off-mode", isUiOff);
      document.body.dataset.hudVisibility = this.isHudVisible ? "visible" : "hidden";
    }

    this.hudUiToggleBtn?.setAttribute("aria-pressed", isUiOff ? "true" : "false");
    this.hudUiToggleBtn?.classList.toggle("active", isUiOff);
    this.quickUiOffBtn?.setAttribute("aria-pressed", isUiOff ? "true" : "false");
    this.quickUiOffBtn?.classList.toggle("active", isUiOff);
    this.uiRestoreFab?.setAttribute("aria-hidden", isUiOff ? "false" : "true");

    this.uiVisibilityBtns?.forEach((btn) => {
      const targetVisible = btn.dataset.uiVisibility !== "off";
      btn.classList.toggle("active", targetVisible === this.isHudVisible);
    });
  }

  public isVirtualTouchVisible(): boolean {
    const isForcedOff = this.touchUiMode === "off";
    if (isForcedOff) {
      return false;
    }
    const isForcedOn = this.touchUiMode === "on";
    if (isForcedOn) {
      return true;
    }
    const isHiddenByUiOff = !this.isHudVisible;
    if (isHiddenByUiOff) {
      return false;
    }
    return this.isCompactOrTouchViewport();
  }

  public syncTouchUiVisibility(): void {
    const isVisible = this.isVirtualTouchVisible();
    this.virtualTouchContainer?.classList.toggle("is-visible", isVisible);
    this.virtualTouchContainer?.setAttribute("aria-hidden", isVisible ? "false" : "true");

    const hasDocBody = typeof document !== "undefined" && Boolean(document.body);
    if (hasDocBody) {
      document.body.dataset.touchUi = isVisible ? "visible" : "hidden";
      document.body.dataset.touchUiMode = this.touchUiMode;
      document.body.classList.toggle("touch-ui-active", isVisible);
    }

    this.touchUiModeBtns?.forEach((btn) => {
      const btnMode = btn.dataset.touchUiMode ?? btn.dataset.touchUi;
      btn.classList.toggle("active", btnMode === this.touchUiMode);
    });
  }

  private updateSteerReadout(steer: number): void {
    const hasDoc = typeof document !== "undefined";
    if (hasDoc) {
      const steerPad = document.getElementById("touch-steer-pad");
      steerPad?.setAttribute("aria-valuenow", String(Math.round(steer * 100)));
    }
    const readoutEl = this.steerReadoutEl;
    const isMissingReadoutEl = readoutEl === null;
    if (isMissingReadoutEl) {
      return;
    }
    const pct = Math.round(steer * 100);
    const isStraight = Math.abs(pct) <= 2;
    if (isStraight) {
      readoutEl.textContent = "0%";
      return;
    }
    const dirLabel = pct < 0 ? "L" : "R";
    readoutEl.textContent = `${dirLabel} ${Math.abs(pct)}%`;
  }

  /**
   * クイックバー上のカメラ・視線・エリア・画質・言語表示バッジを現在の状態に同期する
   */
  public syncQuickBarState(state: MobileHudQuickBarState): void {
    this.lastQuickBarState = { ...state };
    const isMissingDoc = typeof document === "undefined";
    if (isMissingDoc) {
      return;
    }

    const locale = state.locale ?? i18n.getLocale();
    const dict = i18n.t();

    const quickCameraBtn = document.getElementById("quick-camera-btn");
    const hasQuickCameraBtn = quickCameraBtn !== null;
    if (hasQuickCameraBtn) {
      const isCockpit = state.cameraMode === "cockpit";
      quickCameraBtn.textContent = isCockpit ? dict.quickCameraCockpit : dict.quickCameraChase;
      quickCameraBtn.classList.toggle("active", !isCockpit);
    }

    const quickAreaBtn = document.getElementById("quick-area-btn");
    const hasQuickAreaBtn = quickAreaBtn !== null;
    if (hasQuickAreaBtn) {
      const isShibuya = state.area === "shibuya";
      quickAreaBtn.textContent = isShibuya ? dict.quickAreaShibuya : dict.quickAreaTokyo;
      quickAreaBtn.classList.toggle("active", isShibuya);
    }

    const quickGraphicsBtn = document.getElementById("quick-graphics-btn");
    const hasQuickGraphicsBtn = quickGraphicsBtn !== null && state.graphicsQuality !== undefined;
    if (hasQuickGraphicsBtn) {
      const localizedGfx = localizeGraphicsQualityTexts(state.graphicsQuality!, locale);
      quickGraphicsBtn.textContent = localizedGfx.quickChipText;
      quickGraphicsBtn.classList.toggle("active", state.graphicsQuality !== "high");
    }

    const quickLangBtn = document.getElementById("quick-lang-btn");
    const hasQuickLangBtn = quickLangBtn !== null;
    if (hasQuickLangBtn) {
      quickLangBtn.textContent = `🌐 ${LOCALE_DISPLAY_LABELS[locale]}`;
    }

    const gazeQuickMap: Array<{ id: string; preset: GazePreset }> = [
      { id: "quick-gaze-forward-btn", preset: "forward" },
      { id: "quick-mirror-left-btn", preset: "left_mirror" },
      { id: "quick-mirror-rear-btn", preset: "rearview_mirror" },
      { id: "quick-mirror-right-btn", preset: "right_mirror" },
      { id: "quick-nav-gaze-btn", preset: "dashboard" },
    ];
    for (const item of gazeQuickMap) {
      const btn = document.getElementById(item.id);
      btn?.classList.toggle("active", state.gazePreset === item.preset);
    }
  }
}

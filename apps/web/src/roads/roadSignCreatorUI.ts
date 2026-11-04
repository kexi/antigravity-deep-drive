import type { RoadSignPlacement, RoadSignType } from "../assets/schema";
import {
  formatSignValidationStatus,
  i18n,
  localizeRoadSignCategory,
  localizeRoadSignTitle,
} from "../core/i18n";
import { logger } from "../core/logger";
import {
  ROAD_SIGN_CATALOG,
  resolveLeftSidewalkPlacement,
  type CreatedRoadSignInstance,
  type RoadSignSystem,
} from "./roadSignSystem";

export interface RoadSignCreatorUIDependencies {
  signSystem: RoadSignSystem;
  getVehiclePose: () => { x: number; z: number; headingRad: number };
  onPlaceSign: (spec: RoadSignPlacement) => CreatedRoadSignInstance;
  onRemoveSign: (id: string) => boolean;
  getPlacedCustomSigns: () => CreatedRoadSignInstance[];
}

/**
 * ゲーム内「道路標識作成・配置システム」モーダル UI コントローラー
 * ネイティブ <dialog closedby="any"> を使用し、2D リアルタイムプレビュー・構造検証・左歩道自動配置・YAML 出力を提供する。
 */
export class RoadSignCreatorUI {
  private readonly deps: RoadSignCreatorUIDependencies;
  private readonly dialog: HTMLDialogElement | null;
  private readonly typeSelect: HTMLSelectElement | null;
  private readonly labelInput: HTMLInputElement | null;
  private readonly subLabelInput: HTMLInputElement | null;
  private readonly auxInput: HTMLInputElement | null;
  private readonly speedInput: HTMLInputElement | null;
  private readonly distanceInput: HTMLInputElement | null;
  private readonly offsetInput: HTMLInputElement | null;
  private readonly previewCanvas: HTMLCanvasElement | null;
  private readonly validationBox: HTMLElement | null;
  private readonly yamlTextarea: HTMLTextAreaElement | null;
  private readonly customListContainer: HTMLElement | null;
  private counter = 1;

  constructor(deps: RoadSignCreatorUIDependencies) {
    this.deps = deps;
    const hasDoc = typeof document !== "undefined";
    this.dialog = hasDoc
      ? (document.getElementById("sign-creator-dialog") as HTMLDialogElement | null)
      : null;
    this.typeSelect = hasDoc
      ? (document.getElementById("sign-type-select") as HTMLSelectElement | null)
      : null;
    this.labelInput = hasDoc
      ? (document.getElementById("sign-label-input") as HTMLInputElement | null)
      : null;
    this.subLabelInput = hasDoc
      ? (document.getElementById("sign-sublabel-input") as HTMLInputElement | null)
      : null;
    this.auxInput = hasDoc
      ? (document.getElementById("sign-aux-input") as HTMLInputElement | null)
      : null;
    this.speedInput = hasDoc
      ? (document.getElementById("sign-speed-input") as HTMLInputElement | null)
      : null;
    this.distanceInput = hasDoc
      ? (document.getElementById("sign-distance-input") as HTMLInputElement | null)
      : null;
    this.offsetInput = hasDoc
      ? (document.getElementById("sign-offset-input") as HTMLInputElement | null)
      : null;
    this.previewCanvas = hasDoc
      ? (document.getElementById("sign-preview-canvas") as HTMLCanvasElement | null)
      : null;
    this.validationBox = hasDoc ? document.getElementById("sign-validation-status") : null;
    this.yamlTextarea = hasDoc
      ? (document.getElementById("sign-yaml-textarea") as HTMLTextAreaElement | null)
      : null;
    this.customListContainer = hasDoc ? document.getElementById("sign-custom-list") : null;

    this.initializeUI();
  }

  private populateCatalogSelect(): void {
    const hasTypeSelect = Boolean(this.typeSelect);
    if (!hasTypeSelect || !this.typeSelect) {
      return;
    }
    const previousValue = (this.typeSelect.value as RoadSignType) || "street_name";
    const locale = i18n.getLocale();
    const catalog = this.deps.signSystem.getCatalog();
    this.typeSelect.innerHTML = "";
    for (const item of catalog) {
      const opt = document.createElement("option");
      opt.value = item.type;
      const localizedTitle = localizeRoadSignTitle(item.type, item.titleJa, locale);
      const localizedCategory = localizeRoadSignCategory(item.category, locale);
      opt.textContent = `${localizedTitle} [${localizedCategory}]`;
      this.typeSelect.appendChild(opt);
    }
    this.typeSelect.value = previousValue in ROAD_SIGN_CATALOG ? previousValue : "street_name";
  }

  private initializeUI(): void {
    const isMissingDialogOrSelect = !this.dialog || !this.typeSelect;
    if (isMissingDialogOrSelect || !this.dialog || !this.typeSelect) {
      return;
    }

    // 1. カタログから全15種の標識種別セレクトボックスを構築
    this.populateCatalogSelect();
    this.typeSelect.value = "street_name";

    // 2. ネイティブ <dialog> の close イベントで returnValue をリセットし、未対応ブラウザ向け closedby="any" フォールバックを設定
    const dialogEl = this.dialog;
    dialogEl.addEventListener("close", () => {
      dialogEl.returnValue = "";
    });

    const supportsClosedBy =
      typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;
    if (!supportsClosedBy) {
      this.attachLightDismissFallback(dialogEl);
    }

    // 3. 開閉ボタン・フォーム変更イベントのバインド
    const openBtn = document.getElementById("open-sign-creator-btn");
    openBtn?.addEventListener("click", () => this.open());

    const closeBtn = document.getElementById("close-sign-creator-btn");
    closeBtn?.addEventListener("click", () => this.close());

    this.typeSelect.addEventListener("change", () => {
      this.applyCatalogDefaultsForSelectedType();
      this.refreshPreviewAndDraft();
    });

    const inputs = [
      this.labelInput,
      this.subLabelInput,
      this.auxInput,
      this.speedInput,
      this.distanceInput,
      this.offsetInput,
    ];
    for (const input of inputs) {
      input?.addEventListener("input", () => this.refreshPreviewAndDraft());
    }

    const placeBtn = document.getElementById("place-sign-ahead-btn");
    placeBtn?.addEventListener("click", () => this.placeCurrentSignAhead());

    const copyBtn = document.getElementById("copy-sign-yaml-btn");
    copyBtn?.addEventListener("click", () => this.copyYamlToClipboard());

    i18n.onChange(() => {
      this.populateCatalogSelect();
      this.refreshPreviewAndDraft();
      this.renderCustomSignList();
    });

    this.applyCatalogDefaultsForSelectedType();
    this.refreshPreviewAndDraft();
    this.renderCustomSignList();
  }

  /**
   * closedby="any" 未実装ブラウザ向けに、バックドロップ上での pointerdown + pointerup 両成立時のみ close() する。
   * テキスト選択ドラッグがダイアログ外で終わった場合の誤クローズを防ぐ。
   */
  private attachLightDismissFallback(dialog: HTMLDialogElement): void {
    let downOutside = false;
    const isOutside = (e: PointerEvent): boolean => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    dialog.addEventListener("pointerdown", (e: PointerEvent) => {
      downOutside = isOutside(e);
    });
    dialog.addEventListener("pointerup", (e: PointerEvent) => {
      const shouldDismiss = downOutside && isOutside(e);
      if (shouldDismiss) {
        dialog.close();
      }
      downOutside = false;
    });
  }

  public toggle(): void {
    if (!this.dialog) return;
    if (this.dialog.open) {
      this.close();
      return;
    }
    this.open();
  }

  public open(): void {
    if (!this.dialog || this.dialog.open) return;
    this.refreshPreviewAndDraft();
    this.renderCustomSignList();
    this.dialog.showModal();
  }

  public close(): void {
    if (!this.dialog || !this.dialog.open) return;
    this.dialog.close();
  }

  private applyCatalogDefaultsForSelectedType(): void {
    if (!this.typeSelect) return;
    const selectedType = this.typeSelect.value as RoadSignType;
    const entry = ROAD_SIGN_CATALOG[selectedType];
    if (!entry) return;

    if (this.labelInput && entry.defaultLabel !== undefined) {
      this.labelInput.value = entry.defaultLabel;
    }
    if (this.subLabelInput && entry.defaultSubLabel !== undefined) {
      this.subLabelInput.value = entry.defaultSubLabel;
    }
    if (this.auxInput) {
      this.auxInput.value = entry.defaultAuxiliaryText ?? "";
    }
    if (this.speedInput && entry.defaultSpeedLimit !== undefined) {
      this.speedInput.value = String(entry.defaultSpeedLimit);
    }
    if (this.offsetInput) {
      this.offsetInput.value = selectedType === "overhead_guide" ? "0" : "4.2";
    }
  }

  public buildDraftSpec(customId?: string): RoadSignPlacement {
    const selectedType = (this.typeSelect?.value as RoadSignType) ?? "street_name";
    const pose = this.deps.getVehiclePose();
    const forwardDistance = Number(this.distanceInput?.value ?? 18) || 18;
    const leftLateralOffset =
      this.offsetInput?.value !== undefined && this.offsetInput.value !== ""
        ? Number(this.offsetInput.value)
        : selectedType === "overhead_guide"
          ? 0
          : 4.2;

    const placement = resolveLeftSidewalkPlacement({
      originX: pose.x,
      originZ: pose.z,
      travelHeadingRad: pose.headingRad,
      forwardDistance,
      leftLateralOffset,
    });

    const id = customId ?? `custom_${selectedType}_${this.counter}`;
    const label = this.labelInput?.value.trim() || undefined;
    const subLabel = this.subLabelInput?.value.trim() || undefined;
    const auxiliaryText = this.auxInput?.value.trim() || undefined;
    const speedLimit = Number(this.speedInput?.value ?? 50) || 50;

    return {
      id,
      type: selectedType,
      position: placement.position,
      rotationY: placement.rotationY,
      label,
      subLabel,
      auxiliaryText,
      speedLimit: selectedType === "speed_limit" ? speedLimit : undefined,
      supportType: selectedType === "overhead_guide" ? "cantilever" : undefined,
      spanWidth: selectedType === "overhead_guide" ? 12.0 : undefined,
    };
  }

  public refreshPreviewAndDraft(): void {
    const draft = this.buildDraftSpec();
    if (this.previewCanvas) {
      this.deps.signSystem.renderSignPreviewToCanvas(draft, this.previewCanvas);
    }
    if (this.yamlTextarea) {
      this.yamlTextarea.value = this.deps.signSystem.toYamlSnippet(draft);
    }
    if (this.validationBox) {
      const entry = ROAD_SIGN_CATALOG[draft.type];
      const boardTopY = Number((entry.boardCenterY + entry.boardTopExtent).toFixed(2));
      const poleClearanceFromTop = Number((boardTopY - entry.poleHeight).toFixed(3));
      const locale = i18n.getLocale();
      const baseValidationText = formatSignValidationStatus(
        {
          valid: poleClearanceFromTop >= 0.02,
          boardTopY,
          poleTopY: entry.poleHeight,
          poleClearanceFromTop,
          issues: [],
        },
        locale,
      );
      const posSuffix =
        locale === "en"
          ? ` | Pos: (${draft.position[0]}m, ${draft.position[2]}m) Yaw: ${draft.rotationY}rad`
          : locale === "zh"
            ? ` | 坐标: (${draft.position[0]}m, ${draft.position[2]}m) 朝向: ${draft.rotationY}rad`
            : ` | 配置座標: (${draft.position[0]}m, ${draft.position[2]}m) 向き: ${draft.rotationY}rad`;
      this.validationBox.textContent = `${baseValidationText}${posSuffix}`;
    }
  }

  private placeCurrentSignAhead(): void {
    logger.withTrace("RoadSignCreatorUI", "place_custom_sign", (ctx) => {
      const id = `custom_${this.typeSelect?.value ?? "sign"}_${this.counter++}`;
      const spec = this.buildDraftSpec(id);
      const created = this.deps.onPlaceSign(spec);
      logger.info("RoadSignCreatorUI", "custom_sign_placed", "カスタム道路標識を前方左歩道に配置", {
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        data: {
          id: created.id,
          type: created.spec.type,
          position: created.spec.position,
          rotationY: created.spec.rotationY,
          valid: created.validation.valid,
        },
      });
      this.refreshPreviewAndDraft();
      this.renderCustomSignList();
    });
  }

  private renderCustomSignList(): void {
    const hasContainer = Boolean(this.customListContainer);
    if (!hasContainer || !this.customListContainer) {
      return;
    }
    this.customListContainer.innerHTML = "";
    const placed = this.deps.getPlacedCustomSigns();
    const dict = i18n.t();
    const isEmpty = placed.length === 0;
    if (isEmpty) {
      const emptySpan = document.createElement("span");
      emptySpan.style.fontSize = "0.72rem";
      emptySpan.style.color = "#64748b";
      emptySpan.textContent = dict.signEmptyListMessage;
      this.customListContainer.appendChild(emptySpan);
      return;
    }

    for (const item of placed) {
      const chip = document.createElement("div");
      chip.className = "sign-chip";
      const text = document.createElement("span");
      text.textContent = `${item.id} (${item.spec.position[0]}m, ${item.spec.position[2]}m)`;
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "×";
      delBtn.title = dict.signDeleteBtnTitle;
      delBtn.addEventListener("click", () => {
        this.deps.onRemoveSign(item.id);
        this.renderCustomSignList();
      });
      chip.appendChild(text);
      chip.appendChild(delBtn);
      this.customListContainer.appendChild(chip);
    }
  }

  private copyYamlToClipboard(): void {
    if (!this.yamlTextarea) return;
    const text = this.yamlTextarea.value;
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
  }
}

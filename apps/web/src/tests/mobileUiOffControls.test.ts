import { describe, it, expect, vi, afterEach } from "vitest";
import { MobileHudController } from "../core/mobileHudController";
import { InputManager } from "../core/inputManager";

describe("Mobile Touch Controls in UI OFF Mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("スマートフォン・コンパクト画面では UI OFF 没入モード時であっても仮想ステアリング・ペダルが表示維持されることを保証する", () => {
    const inputManager = new InputManager();
    const hud = new MobileHudController({ inputManager });

    // スマホ画面をシミュレート
    vi.spyOn(hud, "isCompactOrTouchViewport").mockReturnValue(true);

    // 通常の UI ON モード
    hud.setHudVisible(true);
    expect(hud.isVirtualTouchVisible()).toBe(true);

    // ユーザーが UI OFF (没入モード) に切り替えた場合
    hud.setHudVisible(false);
    // キーボードがないため、ハンドルとペダルは表示維持される
    expect(hud.isVirtualTouchVisible()).toBe(true);
  });

  it("タッチUI表示モードが明示的に off の場合は UI OFF・ON に関わらず非表示になることを保証する", () => {
    const inputManager = new InputManager();
    const hud = new MobileHudController({ inputManager });

    vi.spyOn(hud, "isCompactOrTouchViewport").mockReturnValue(true);

    hud.setTouchUiMode("off");
    hud.setHudVisible(true);
    expect(hud.isVirtualTouchVisible()).toBe(false);

    hud.setHudVisible(false);
    expect(hud.isVirtualTouchVisible()).toBe(false);
  });

  it("デスクトップ環境（非タッチ・大画面）では UI OFF 時に仮想コントローラーが非表示になることを保証する", () => {
    const inputManager = new InputManager();
    const hud = new MobileHudController({ inputManager });

    // デスクトップ環境をシミュレート
    vi.spyOn(hud, "isCompactOrTouchViewport").mockReturnValue(false);

    hud.setHudVisible(true);
    expect(hud.isVirtualTouchVisible()).toBe(false);

    hud.setHudVisible(false);
    expect(hud.isVirtualTouchVisible()).toBe(false);
  });
});

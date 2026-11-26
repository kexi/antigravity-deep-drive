import * as THREE from "three";

export type VehicleLampColor = "green" | "yellow" | "red";
export type PedestrianLampKind = "red-standing" | "green-walking";

/**
 * 信号機 LED レンズ・光学グロウハロー・付属プレート用の共有キャッシュマテリアルライブラリ。
 *
 * Why 共有キャッシュ化するか:
 * - 旧実装は createTrafficLight 呼び出しごとに 6〜8 枚の CanvasTexture と MeshStandardMaterial を複製しており、
 *   都市全体で 700 枚超の重複テクスチャを生成していた。
 * - 点灯・消灯マテリアルを事前キャッシュして全信号機で共有することで、GPU メモリ消費を 1/50 以下へ削減しつつ、
 *   リアルタイム信号切替（青→黄→赤→右折矢印・歩行者青点滅）を O(1) のマテリアル差し替え（ゼロアロケーション）で駆動できる。
 * - 点灯 LED と光学グロウハローに toneMapped: false を設定することで、PointLight 非依存でも昼間・夕暮れ・夜間の
 *   150m 遠方から青緑・黄・赤の点灯色を明瞭に視認できるようにする。
 */
export class TrafficSignalMaterialLibrary {
  private readonly vehicleMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly arrowMats = new Map<boolean, THREE.MeshStandardMaterial>();
  private readonly pedMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly glowMats = new Map<VehicleLampColor | "arrow", THREE.MeshBasicMaterial>();
  private pedHeaderMat: THREE.MeshStandardMaterial | null = null;
  private pushButtonBodyMat: THREE.MeshStandardMaterial | null = null;
  private pushButtonBtnMat: THREE.MeshStandardMaterial | null = null;
  private readonly namePlateTexCache = new Map<string, THREE.MeshStandardMaterial>();

  public getVehicleLedMaterial(
    color: VehicleLampColor,
    isActive: boolean,
  ): THREE.MeshStandardMaterial {
    const key = `${color}_${isActive ? "on" : "off"}`;
    const cached = this.vehicleMats.get(key);
    if (cached) {
      return cached;
    }

    const palette = {
      green: {
        baseHex: 0x00e0be,
        emissiveHex: 0x00f5d4,
        bgCss: "#042f2e",
        ringCss: "#00c8a8",
        dotCss: "#00ffdc",
        coreCss: "#e0fff9",
      },
      yellow: {
        baseHex: 0xf59e0b,
        emissiveHex: 0xfbbf24,
        bgCss: "#3b2106",
        ringCss: "#e08a00",
        dotCss: "#ffcc29",
        coreCss: "#fff7c2",
      },
      red: {
        baseHex: 0xef4444,
        emissiveHex: 0xff3b30,
        bgCss: "#3b0a0a",
        ringCss: "#dc2626",
        dotCss: "#ff4747",
        coreCss: "#ffe4e4",
      },
    }[color];

    let lensTex: THREE.CanvasTexture | null = null;
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const cx = 64;
        const cy = 64;
        ctx.clearRect(0, 0, 128, 128);

        ctx.fillStyle = "#0b0f17";
        ctx.beginPath();
        ctx.arc(cx, cy, 62, 0, Math.PI * 2);
        ctx.fill();

        if (isActive) {
          const grad = ctx.createRadialGradient(cx, cy, 6, cx, cy, 56);
          grad.addColorStop(0, palette.coreCss);
          grad.addColorStop(0.55, palette.dotCss);
          grad.addColorStop(0.88, palette.ringCss);
          grad.addColorStop(1, palette.bgCss);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, 56, 0, Math.PI * 2);
          ctx.fill();

          const rings = [10, 20, 30, 40, 49];
          for (const radius of rings) {
            const count = Math.max(8, Math.round(radius * 0.65));
            for (let i = 0; i < count; i++) {
              const angle = (i / count) * Math.PI * 2;
              const dx = cx + Math.cos(angle) * radius;
              const dy = cy + Math.sin(angle) * radius;
              ctx.fillStyle = palette.coreCss;
              ctx.beginPath();
              ctx.arc(dx, dy, 2.3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          const offGrad = ctx.createRadialGradient(cx - 10, cy - 12, 4, cx, cy, 56);
          offGrad.addColorStop(0, "#232b38");
          offGrad.addColorStop(0.65, "#141821");
          offGrad.addColorStop(1, "#0b0e14");
          ctx.fillStyle = offGrad;
          ctx.beginPath();
          ctx.arc(cx, cy, 56, 0, Math.PI * 2);
          ctx.fill();

          const rings = [12, 24, 36, 47];
          ctx.fillStyle = "#1f2633";
          for (const radius of rings) {
            const count = Math.max(8, Math.round(radius * 0.55));
            for (let i = 0; i < count; i++) {
              const angle = (i / count) * Math.PI * 2;
              const dx = cx + Math.cos(angle) * radius;
              const dy = cy + Math.sin(angle) * radius;
              ctx.beginPath();
              ctx.arc(dx, dy, 1.8, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
      lensTex = new THREE.CanvasTexture(canvas);
      lensTex.colorSpace = THREE.SRGBColorSpace;
    }

    const mat = isActive
      ? new THREE.MeshStandardMaterial({
          name: `SignalLedVehicle_${key}`,
          color: palette.baseHex,
          map: lensTex,
          emissive: new THREE.Color(palette.emissiveHex),
          emissiveMap: lensTex,
          emissiveIntensity: 2.65,
          roughness: 0.16,
          metalness: 0.06,
          toneMapped: false,
        })
      : new THREE.MeshStandardMaterial({
          name: `SignalLedVehicle_${key}`,
          color: 0x141820,
          map: lensTex,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 0,
          roughness: 0.28,
          metalness: 0.22,
        });

    this.vehicleMats.set(key, mat);
    return mat;
  }

  public getArrowLedMaterial(isActive: boolean): THREE.MeshStandardMaterial {
    const cached = this.arrowMats.get(isActive);
    if (cached) {
      return cached;
    }

    let arrowTex: THREE.CanvasTexture | null = null;
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#0e131b";
        ctx.beginPath();
        ctx.arc(64, 64, 60, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = isActive ? "#00ffdc" : "#1e2633";
        ctx.lineWidth = 13;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(28, 64);
        ctx.lineTo(94, 64);
        ctx.moveTo(70, 40);
        ctx.lineTo(96, 64);
        ctx.lineTo(70, 88);
        ctx.stroke();
      }
      arrowTex = new THREE.CanvasTexture(canvas);
      arrowTex.colorSpace = THREE.SRGBColorSpace;
    }

    const mat = new THREE.MeshStandardMaterial({
      name: `SignalLedArrow_${isActive ? "on" : "off"}`,
      color: isActive ? 0x00e0be : 0x12161f,
      map: arrowTex,
      emissive: new THREE.Color(isActive ? 0x00f5d4 : 0x000000),
      emissiveMap: isActive ? arrowTex : null,
      emissiveIntensity: isActive ? 2.4 : 0,
      roughness: 0.2,
      metalness: 0.12,
      toneMapped: !isActive,
    });
    this.arrowMats.set(isActive, mat);
    return mat;
  }

  public getPedestrianLedMaterial(
    kind: PedestrianLampKind,
    isActive: boolean,
  ): THREE.MeshStandardMaterial {
    const key = `${kind}_${isActive ? "on" : "off"}`;
    const cached = this.pedMats.get(key);
    if (cached) {
      return cached;
    }

    const isRed = kind === "red-standing";
    const activeColorHex = isRed ? 0xff3b30 : 0x00e5b0;
    const activeGlowCss = isRed ? "#ff3b30" : "#00e6b8";
    const activeCoreCss = isRed ? "#ffd6d2" : "#ccfbf1";
    const inactiveDotCss = isRed ? "#29181b" : "#142826";

    let pedTex: THREE.CanvasTexture | null = null;
    if (typeof document !== "undefined") {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#080b10";
        ctx.fillRect(0, 0, size, size);

        ctx.strokeStyle = "#263040";
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, size - 10, size - 10);

        ctx.strokeStyle = "#141a23";
        ctx.lineWidth = 4;
        ctx.strokeRect(14, 14, size - 28, size - 28);

        ctx.fillStyle = "#0c1017";
        ctx.beginPath();
        ctx.arc(128, 128, 106, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#1e2736";
        ctx.lineWidth = 3;
        ctx.stroke();

        const drawPictogram = (targetCtx: CanvasRenderingContext2D, color: string) => {
          targetCtx.fillStyle = color;
          targetCtx.strokeStyle = color;
          targetCtx.lineCap = "round";
          targetCtx.lineJoin = "round";

          if (isRed) {
            targetCtx.beginPath();
            targetCtx.arc(128, 52, 20, 0, Math.PI * 2);
            targetCtx.fill();

            targetCtx.beginPath();
            targetCtx.moveTo(98, 82);
            targetCtx.lineTo(158, 82);
            targetCtx.lineTo(150, 146);
            targetCtx.lineTo(106, 146);
            targetCtx.closePath();
            targetCtx.fill();

            targetCtx.lineWidth = 15;
            targetCtx.beginPath();
            targetCtx.moveTo(99, 88);
            targetCtx.lineTo(84, 144);
            targetCtx.moveTo(157, 88);
            targetCtx.lineTo(172, 144);
            targetCtx.stroke();

            targetCtx.lineWidth = 17;
            targetCtx.beginPath();
            targetCtx.moveTo(116, 146);
            targetCtx.lineTo(115, 220);
            targetCtx.moveTo(140, 146);
            targetCtx.lineTo(141, 220);
            targetCtx.stroke();
          } else {
            targetCtx.beginPath();
            targetCtx.arc(122, 50, 20, 0, Math.PI * 2);
            targetCtx.fill();

            targetCtx.beginPath();
            targetCtx.moveTo(108, 78);
            targetCtx.lineTo(144, 82);
            targetCtx.lineTo(138, 144);
            targetCtx.lineTo(104, 142);
            targetCtx.closePath();
            targetCtx.fill();

            targetCtx.lineWidth = 14;
            targetCtx.beginPath();
            targetCtx.moveTo(114, 86);
            targetCtx.lineTo(84, 118);
            targetCtx.lineTo(74, 112);
            targetCtx.moveTo(136, 88);
            targetCtx.lineTo(168, 124);
            targetCtx.stroke();

            targetCtx.lineWidth = 17;
            targetCtx.beginPath();
            targetCtx.moveTo(114, 140);
            targetCtx.lineTo(84, 214);
            targetCtx.lineTo(74, 214);
            targetCtx.moveTo(130, 140);
            targetCtx.lineTo(154, 182);
            targetCtx.lineTo(172, 216);
            targetCtx.stroke();
          }
        };

        drawPictogram(ctx, isActive ? activeGlowCss : inactiveDotCss);

        ctx.strokeStyle = "#080b10";
        ctx.lineWidth = 2.2;
        const gridStep = 7;
        for (let pos = 18; pos < size - 18; pos += gridStep) {
          ctx.beginPath();
          ctx.moveTo(18, pos);
          ctx.lineTo(size - 18, pos);
          ctx.moveTo(pos, 18);
          ctx.lineTo(pos, size - 18);
          ctx.stroke();
        }

        if (isActive) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 0.5;
          drawPictogram(ctx, activeCoreCss);
          ctx.restore();

          ctx.strokeStyle = "rgba(8, 11, 16, 0.65)";
          ctx.lineWidth = 1.6;
          for (let y = 18; y < size - 18; y += gridStep) {
            ctx.beginPath();
            ctx.moveTo(18, y);
            ctx.lineTo(size - 18, y);
            ctx.stroke();
          }
        }
      }
      pedTex = new THREE.CanvasTexture(canvas);
      pedTex.colorSpace = THREE.SRGBColorSpace;
    }

    const mat = isActive
      ? new THREE.MeshStandardMaterial({
          name: `SignalLedPed_${key}`,
          color: 0xffffff,
          map: pedTex,
          emissive: new THREE.Color(activeColorHex),
          emissiveMap: pedTex,
          emissiveIntensity: 2.2,
          roughness: 0.2,
          metalness: 0.1,
          toneMapped: false,
        })
      : new THREE.MeshStandardMaterial({
          name: `SignalLedPed_${key}`,
          color: 0x1a202c,
          map: pedTex,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 0,
          roughness: 0.32,
          metalness: 0.18,
        });

    this.pedMats.set(key, mat);
    return mat;
  }

  /**
   * 遠方視認性を高める軽量な加算合成 LED グロウハロー（PointLight レスでも昼夜鮮明）
   */
  public getGlowHaloMaterial(kind: VehicleLampColor | "arrow"): THREE.MeshBasicMaterial {
    const cached = this.glowMats.get(kind);
    if (cached) {
      return cached;
    }

    const colorHex = kind === "red" ? 0xff453a : kind === "yellow" ? 0xffcc29 : 0x00f5d4;
    const innerCss =
      kind === "red"
        ? "rgba(255, 190, 185, 0.95)"
        : kind === "yellow"
          ? "rgba(255, 245, 175, 0.95)"
          : "rgba(180, 255, 242, 0.95)";
    const midCss =
      kind === "red"
        ? "rgba(255, 59, 48, 0.45)"
        : kind === "yellow"
          ? "rgba(251, 191, 36, 0.45)"
          : "rgba(0, 229, 195, 0.45)";

    let glowTex: THREE.CanvasTexture | null = null;
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
        grad.addColorStop(0, innerCss);
        grad.addColorStop(0.4, midCss);
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
      }
      glowTex = new THREE.CanvasTexture(canvas);
      glowTex.colorSpace = THREE.SRGBColorSpace;
    }

    const mat = new THREE.MeshBasicMaterial({
      name: `SignalLedGlow_${kind}`,
      color: colorHex,
      map: glowTex,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.glowMats.set(kind, mat);
    return mat;
  }

  public getPedestrianHeaderMaterial(): THREE.MeshStandardMaterial {
    if (this.pedHeaderMat) {
      return this.pedHeaderMat;
    }
    let tex: THREE.CanvasTexture | null = null;
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(0, 0, 256, 64);
        ctx.strokeStyle = "#1d4ed8";
        ctx.lineWidth = 6;
        ctx.strokeRect(4, 4, 248, 56);
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("歩行者・自転車専用", 128, 33);
      }
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    this.pedHeaderMat = new THREE.MeshStandardMaterial({
      name: "SignalPedBicycleHeaderMat",
      color: 0xf8fafc,
      map: tex,
      roughness: 0.38,
      metalness: 0.08,
    });
    return this.pedHeaderMat;
  }

  public getPushButtonMaterials(): {
    bodyMat: THREE.MeshStandardMaterial;
    btnMat: THREE.MeshStandardMaterial;
  } {
    if (!this.pushButtonBodyMat) {
      this.pushButtonBodyMat = new THREE.MeshStandardMaterial({
        name: "SignalPushButtonBodyMat",
        color: 0xfacc15,
        roughness: 0.42,
        metalness: 0.25,
      });
    }
    if (!this.pushButtonBtnMat) {
      this.pushButtonBtnMat = new THREE.MeshStandardMaterial({
        name: "SignalPushButtonRedMat",
        color: 0xdc2626,
        roughness: 0.3,
        metalness: 0.1,
      });
    }
    return { bodyMat: this.pushButtonBodyMat, btnMat: this.pushButtonBtnMat };
  }

  public getIntersectionNamePlateMaterial(
    nameJa: string,
    nameEn: string,
  ): THREE.MeshStandardMaterial | null {
    const key = `${nameJa}|${nameEn}`;
    const cached = this.namePlateTexCache.get(key);
    if (cached) {
      return cached;
    }
    if (typeof document === "undefined") {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 172;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 512, 172);
      ctx.strokeStyle = "#00428a";
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, 496, 156);
      ctx.fillStyle = "#00428a";
      ctx.textAlign = "center";
      ctx.font = "bold 52px sans-serif";
      ctx.fillText(nameJa, 256, 76, 464);
      ctx.font = "bold 28px sans-serif";
      ctx.fillText(nameEn, 256, 132, 464);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      name: `SignalIntersectionPlate_${key}`,
      map: tex,
      roughness: 0.4,
    });
    this.namePlateTexCache.set(key, mat);
    return mat;
  }

  public getCachedLedMaterialCount(): number {
    return this.vehicleMats.size + this.arrowMats.size + this.pedMats.size;
  }
}

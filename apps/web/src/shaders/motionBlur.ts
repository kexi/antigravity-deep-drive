import * as THREE from "three";

/**
 * 景色のモーションブラー用ポストプロセスシェーダー
 * - 車速に応じたラジアル＆進行方向ブラー
 * - 中心部（ドライバー視点前方）の視認性を保ちつつ、周辺のビルや景色が流れるリアルな速度感を表現
 * - 深度バッファ（tDepth）を用いた車内インテリア・自車マスクにより、カメラと同一慣性系で移動する
 *   コックピット内装（11インチカーナビ・12.3インチデジタルメーター・ステアリング・ピラー・ダッシュボード）には
 *   一切モーションブラーをかけず、フロントガラス・サイドガラス越しの車外風景のみをブラーさせる。
 * - Why not 画面全体の2D UV距離だけでブラーをかけないか:
 *   車内視点（cockpit）ではカーナビやメーター、ハンドルが画面下部〜周辺（UV中心から遠い位置）に配置されるため、
 *   深度マスクなしで2Dラジアルブラーを適用すると、ドライバーに対して相対速度ゼロであるはずのカーナビ画面や計器類が
 *   最も強くブレて視認性が損なわれるため。
 */

export type MotionBlurCameraMode = "cockpit" | "chase";

export interface MotionBlurUpdateOptions {
  cameraNear?: number;
  cameraFar?: number;
  cameraMode?: MotionBlurCameraMode;
  maskNearDistance?: number;
  maskFarDistance?: number;
}

export interface MotionBlurUniforms {
  [key: string]: THREE.IUniform;
  tDiffuse: { value: THREE.Texture | null };
  tDepth: { value: THREE.Texture | null };
  uVelocity: { value: THREE.Vector2 };
  uStrength: { value: number };
  uCenter: { value: THREE.Vector2 };
  uEnabled: { value: number };
  uHasDepth: { value: number };
  uCameraNear: { value: number };
  uCameraFar: { value: number };
  uMaskNearDistance: { value: number };
  uMaskFarDistance: { value: number };
}

export const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uVelocity: { value: new THREE.Vector2(0, 0) },
    uStrength: { value: 0.0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uEnabled: { value: 1.0 },
    uHasDepth: { value: 0.0 },
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 600.0 },
    uMaskNearDistance: { value: 2.2 },
    uMaskFarDistance: { value: 3.0 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uVelocity;
    uniform float uStrength;
    uniform vec2 uCenter;
    uniform float uEnabled;
    uniform float uHasDepth;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uMaskNearDistance;
    uniform float uMaskFarDistance;
    varying vec2 vUv;

    const int SAMPLES = 10;

    // 非線形デプスバッファ値 [0, 1] をカメラからの線形距離（メートル）へ変換
    float linearizeDepth(float depthSample) {
      float zNdc = depthSample * 2.0 - 1.0;
      float denom = uCameraFar + uCameraNear - zNdc * (uCameraFar - uCameraNear);
      return (2.0 * uCameraNear * uCameraFar) / max(denom, 0.00001);
    }

    // 車内インテリア（近距離）を 0.0、車外風景（遠距離）を 1.0 とするマスク係数を算出
    float computeExteriorMask(vec2 uv) {
      if (uHasDepth < 0.5) {
        return 1.0;
      }
      float rawDepth = texture2D(tDepth, uv).r;
      // 深度バッファ上限（空・遠景 = 1.0付近）は確実に車外として扱う
      if (rawDepth >= 0.9999) {
        return 1.0;
      }
      float linearDist = linearizeDepth(rawDepth);
      return smoothstep(uMaskNearDistance, uMaskFarDistance, linearDist);
    }

    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);

      if (uEnabled < 0.5 || uStrength < 0.001) {
        gl_FragColor = baseColor;
        return;
      }

      // 現在ピクセルが車内インテリア（カーナビ・メーター・ダッシュボード・ピラー等）であればブラーを除外
      float centerExteriorMask = computeExteriorMask(vUv);
      if (centerExteriorMask <= 0.001) {
        gl_FragColor = baseColor;
        return;
      }

      // 中心からの距離（画面周辺ほどブラーが強まる）
      vec2 dirToCenter = vUv - uCenter;
      float dist = length(dirToCenter);

      // 放射方向ベクトルと進行方向ベクトルのブレンド（境界付近はマスク係数で滑らかに減衰）
      float effectiveStrength = uStrength * centerExteriorMask;
      vec2 blurDir = normalize(dirToCenter + vec2(0.0001)) * dist * 0.7 + uVelocity * 0.3;
      vec2 stepVec = blurDir * effectiveStrength / float(SAMPLES);

      vec4 accumColor = baseColor;
      float totalWeight = 1.0;

      for (int i = 1; i < SAMPLES; i++) {
        float fi = float(i);
        vec2 sampleUv = vUv - stepVec * fi;

        // 画面外サンプリング防止
        sampleUv = clamp(sampleUv, 0.001, 0.999);

        // サンプリング先が車内インテリア（ナビ画面やピラー等）に入った場合は重みを 0 にして車外への色滲みを防止
        float sampleExteriorMask = computeExteriorMask(sampleUv);
        float weight = (1.0 - (fi / float(SAMPLES))) * sampleExteriorMask;
        vec4 sampleColor = clamp(texture2D(tDiffuse, sampleUv), vec4(0.0), vec4(4.0));
        accumColor += sampleColor * weight;
        totalWeight += weight;
      }

      gl_FragColor = clamp(accumColor / max(totalWeight, 0.0001), vec4(0.0), vec4(2.0));
    }
  `,
};

export class MotionBlurPass {
  public renderTarget: THREE.WebGLRenderTarget;
  public material: THREE.ShaderMaterial;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor(width: number, height: number) {
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(MotionBlurShader.uniforms),
      vertexShader: MotionBlurShader.vertexShader,
      fragmentShader: MotionBlurShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const quadMesh = new THREE.Mesh(quadGeo, this.material);
    this.quadScene.add(quadMesh);
  }

  public setSize(width: number, height: number): void {
    this.renderTarget.setSize(width, height);
  }

  public update(speedKmh: number, enabled: boolean, options?: MotionBlurUpdateOptions): void {
    const hasCameraNear =
      options?.cameraNear !== undefined &&
      Number.isFinite(options.cameraNear) &&
      options.cameraNear > 0;
    if (hasCameraNear) {
      this.material.uniforms.uCameraNear.value = options!.cameraNear!;
    }

    const hasCameraFar =
      options?.cameraFar !== undefined &&
      Number.isFinite(options.cameraFar) &&
      options.cameraFar > this.material.uniforms.uCameraNear.value;
    if (hasCameraFar) {
      this.material.uniforms.uCameraFar.value = options!.cameraFar!;
    }

    const hasCustomMaskDistances =
      options?.maskNearDistance !== undefined && options?.maskFarDistance !== undefined;
    if (hasCustomMaskDistances) {
      this.material.uniforms.uMaskNearDistance.value = options!.maskNearDistance!;
      this.material.uniforms.uMaskFarDistance.value = Math.max(
        options!.maskFarDistance!,
        options!.maskNearDistance! + 0.05,
      );
    } else if (options?.cameraMode === "chase") {
      // チェイス視点ではカメラから車体前端付近までの近傍を保護しつつ背景・路面を流す
      this.material.uniforms.uMaskNearDistance.value = 0.5;
      this.material.uniforms.uMaskFarDistance.value = 1.2;
    } else if (options?.cameraMode === "cockpit") {
      // コックピット視点ではドライバー視点 (z=0.06m) から車内内装（ナビ ~0.62m、メーター ~0.65m、ピラー ~0.75m）
      // およびボンネット先端 (~2.2m) までを完全に保護し、3.0m 以遠の車外風景のみにブラーを適用する
      this.material.uniforms.uMaskNearDistance.value = 2.2;
      this.material.uniforms.uMaskFarDistance.value = 3.0;
    }

    const isBlurDisabled = !enabled;
    if (isBlurDisabled) {
      this.material.uniforms.uEnabled.value = 0.0;
      this.material.uniforms.uStrength.value = 0.0;
      return;
    }

    this.material.uniforms.uEnabled.value = 1.0;
    // 時速20km/h以上でブラーが徐々に発現
    const minSpeed = 20.0;
    const isMovingFast = speedKmh > minSpeed;
    if (!isMovingFast) {
      this.material.uniforms.uStrength.value = 0.0;
      return;
    }

    const normalizedSpeed = Math.min((speedKmh - minSpeed) / 120.0, 1.0);
    // ブラー強度: 最大 0.04
    this.material.uniforms.uStrength.value = normalizedSpeed * 0.04;
  }

  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    depthTexture: THREE.Texture | null = null,
  ): void {
    // 1. メインシーンをレンダーターゲットへ描画
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(scene, camera);

    // 2. モーションブラーを適用して画面へ出力
    renderer.setRenderTarget(null);
    this.material.uniforms.tDiffuse.value = this.renderTarget.texture;
    this.material.uniforms.tDepth.value = depthTexture;
    this.material.uniforms.uHasDepth.value = depthTexture ? 1.0 : 0.0;
    renderer.render(this.quadScene, this.quadCamera);
  }

  public renderFromTexture(
    renderer: THREE.WebGLRenderer,
    inputTexture: THREE.Texture,
    target: THREE.WebGLRenderTarget | null = null,
    depthTexture: THREE.Texture | null = null,
  ): void {
    renderer.setRenderTarget(target);
    this.material.uniforms.tDiffuse.value = inputTexture;
    this.material.uniforms.tDepth.value = depthTexture;
    this.material.uniforms.uHasDepth.value = depthTexture ? 1.0 : 0.0;
    renderer.render(this.quadScene, this.quadCamera);
  }
}

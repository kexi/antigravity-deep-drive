import * as THREE from "three";

/**
 * 景色のモーションブラー用ポストプロセスシェーダー
 * - 車速に応じたラジアル＆進行方向ブラー
 * - 中心部（ドライバー視点前方）の視認性を保ちつつ、周辺のビルや景色が流れるリアルな速度感を表現
 */

export interface MotionBlurUniforms {
  [key: string]: THREE.IUniform;
  tDiffuse: { value: THREE.Texture | null };
  uVelocity: { value: THREE.Vector2 };
  uStrength: { value: number };
  uCenter: { value: THREE.Vector2 };
  uEnabled: { value: number };
}

export const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVelocity: { value: new THREE.Vector2(0, 0) },
    uStrength: { value: 0.0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uEnabled: { value: 1.0 },
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
    uniform vec2 uVelocity;
    uniform float uStrength;
    uniform vec2 uCenter;
    uniform float uEnabled;
    varying vec2 vUv;

    const int SAMPLES = 10;

    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);

      if (uEnabled < 0.5 || uStrength < 0.001) {
        gl_FragColor = baseColor;
        return;
      }

      // 中心からの距離（画面周辺ほどブラーが強まる）
      vec2 dirToCenter = vUv - uCenter;
      float dist = length(dirToCenter);
      
      // 放射方向ベクトルと進行方向ベクトルのブレンド
      vec2 blurDir = normalize(dirToCenter + vec2(0.0001)) * dist * 0.7 + uVelocity * 0.3;
      vec2 stepVec = blurDir * uStrength / float(SAMPLES);

      vec4 accumColor = baseColor;
      float totalWeight = 1.0;

      for (int i = 1; i < SAMPLES; i++) {
        float fi = float(i);
        vec2 sampleUv = vUv - stepVec * fi;
        
        // 画面外サンプリング防止
        sampleUv = clamp(sampleUv, 0.001, 0.999);
        
        float weight = 1.0 - (fi / float(SAMPLES));
        accumColor += texture2D(tDiffuse, sampleUv) * weight;
        totalWeight += weight;
      }

      gl_FragColor = accumColor / totalWeight;
    }
  `,
};

export class MotionBlurPass {
  public renderTarget: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
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

  public update(speedKmh: number, enabled: boolean): void {
    const isBlurDisabled = !enabled;
    if (isBlurDisabled) {
      this.material.uniforms.uEnabled.value = 0.0;
      this.material.uniforms.uStrength.value = 0.0;
      return;
    }

    this.material.uniforms.uEnabled.value = 1.0;
    // 時速30km/h以上でブラーが徐々に発現
    const minSpeed = 20.0;
    const isMovingFast = speedKmh > minSpeed;
    if (isMovingFast) {
      const normalizedSpeed = Math.min((speedKmh - minSpeed) / 120.0, 1.0);
      // ブラー強度: 最大 0.045
      this.material.uniforms.uStrength.value = normalizedSpeed * 0.04;
    } else {
      this.material.uniforms.uStrength.value = 0.0;
    }
  }

  public render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    // 1. メインシーンをレンダーターゲットへ描画
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(scene, camera);

    // 2. モーションブラーを適用して画面へ出力
    renderer.setRenderTarget(null);
    this.material.uniforms.tDiffuse.value = this.renderTarget.texture;
    renderer.render(this.quadScene, this.quadCamera);
  }

  public renderFromTexture(
    renderer: THREE.WebGLRenderer,
    inputTexture: THREE.Texture,
    target: THREE.WebGLRenderTarget | null = null
  ): void {
    renderer.setRenderTarget(target);
    this.material.uniforms.tDiffuse.value = inputTexture;
    renderer.render(this.quadScene, this.quadCamera);
  }
}

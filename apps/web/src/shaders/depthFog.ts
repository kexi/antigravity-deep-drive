import * as THREE from 'three';

export interface DepthFogOptions {
  fogColor?: number;
  sunColor?: number;
  density?: number;
  heightFalloff?: number;
  startDistance?: number;
}

/**
 * 物理ベース高度減衰・大気散乱 深度フォグパス (Atmospheric Height & Depth Fog Pass)
 *
 * 【特徴・技術仕様】
 * 1. 深度バッファからの線形深度復元 (Linear Depth Reconstruction):
 *    デプステクスチャの非線形Z値をカメラの Near/Far に基づき線形ワールド深度へ復元。
 * 2. 指数高度減衰 (Exponential Height Falloff):
 *    地上（道路・お堀）付近の低高度に霧・水蒸気が滞留し、高層ビル上層に向かって自然に希薄化。
 * 3. 太陽光ミー散乱 (Mie In-Scattering / Henyey-Greenstein Phase):
 *    視線が太陽の方向を向いた際、大気エアロゾルによる光の前方散乱でフォグが温かく輝く。
 * 4. 天候システム・YAMLプリセット連動:
 *    夕暮れの黄金色、雨天の湿潤蒸気、夜間の月光青灰色のフォグを動的切り替え。
 */
export class DepthFogPass {
  public material: THREE.ShaderMaterial;
  public renderTarget: THREE.WebGLRenderTarget;

  private sceneCamera: THREE.PerspectiveCamera;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private quadMesh: THREE.Mesh;

  constructor(width: number, height: number, camera: THREE.PerspectiveCamera, options: DepthFogOptions = {}) {
    this.sceneCamera = camera;

    // 深度テクスチャ付きレンダーターゲット
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType),
    });

    const uniforms = {
      tColor: { value: null as THREE.Texture | null },
      tDepth: { value: this.renderTarget.depthTexture },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      cameraPosition: { value: camera.position },
      cameraWorldMatrix: { value: camera.matrixWorld },
      cameraProjectionInverse: { value: camera.projectionMatrixInverse },
      uFogColor: { value: new THREE.Color(options.fogColor ?? 0xfdba74) },
      uSunColor: { value: new THREE.Color(options.sunColor ?? 0xff8844) },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.3, -0.8).normalize() },
      uDensity: { value: options.density ?? 0.006 },
      uHeightFalloff: { value: options.heightFalloff ?? 0.04 },
      uStartDistance: { value: options.startDistance ?? 10.0 },
      uInscatteringIntensity: { value: 1.2 },
    };

    const vertexShader = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `;

    const fragmentShader = /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform float cameraNear;
      uniform float cameraFar;
      uniform vec3 cameraPosition;
      uniform mat4 cameraWorldMatrix;
      uniform mat4 cameraProjectionInverse;

      uniform vec3 uFogColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDirection;
      uniform float uDensity;
      uniform float uHeightFalloff;
      uniform float uStartDistance;
      uniform float uInscatteringIntensity;

      varying vec2 vUv;

      // 深度値からビュー空間座標を再構築
      vec3 getViewPos(vec2 uv, float depth) {
        float z = depth * 2.0 - 1.0;
        vec4 clipPos = vec4(uv * 2.0 - 1.0, z, 1.0);
        vec4 viewPos = cameraProjectionInverse * clipPos;
        return viewPos.xyz / viewPos.w;
      }

      // Henyey-Greenstein ミー散乱位相関数
      float henyeyGreenstein(float cosTheta, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
      }

      void main() {
        vec4 sceneColor = texture2D(tColor, vUv);
        float depth = texture2D(tDepth, vUv).r;

        // 背景（空・無限遠）の場合はフォグ計算をスキップまたはソフトブレンド
        if (depth >= 0.9999) {
          gl_FragColor = sceneColor;
          return;
        }

        // ビュー空間座標およびワールド空間座標の復元
        vec3 viewPos = getViewPos(vUv, depth);
        vec4 worldPos4 = cameraWorldMatrix * vec4(viewPos, 1.0);
        vec3 worldPos = worldPos4.xyz;

        vec3 rayVec = worldPos - cameraPosition;
        float rayDist = length(rayVec);
        vec3 rayDir = normalize(rayVec);

        // フォグ開始距離のクリップ
        float effectiveDist = max(0.0, rayDist - uStartDistance);

        // 高度減衰フォグの視線積分 (Analytical Height Falloff Fog Integral)
        float camY = cameraPosition.y;
        float targetY = worldPos.y;
        float deltaY = targetY - camY;

        float opticalDepth = 0.0;
        if (abs(deltaY) > 0.001) {
          // 指数高度積分の解析解
          opticalDepth = (uDensity / uHeightFalloff) * exp(-uHeightFalloff * camY) * (1.0 - exp(-uHeightFalloff * deltaY)) / (deltaY / rayDist);
        } else {
          opticalDepth = uDensity * exp(-uHeightFalloff * camY) * rayDist;
        }

        // 透過率 (Beer's Law)
        float fogFactor = clamp(1.0 - exp(-max(0.0, opticalDepth)), 0.0, 1.0);

        // 太陽光前方ミー散乱 (Sun In-Scattering)
        float cosTheta = dot(rayDir, normalize(uSunDirection));
        float phase = henyeyGreenstein(cosTheta, 0.65) * 3.14159265;
        vec3 inscatterColor = mix(uFogColor, uSunColor, clamp(phase * uInscatteringIntensity, 0.0, 1.0));

        // 最終合成カラー
        vec3 finalColor = mix(sceneColor.rgb, inscatterColor, fogFactor);

        gl_FragColor = vec4(finalColor, sceneColor.a);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    // フルスクリーンクアッド
    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quadMesh);
  }

  public setSize(width: number, height: number): void {
    this.renderTarget.setSize(width, height);
  }

  public setFogParams(params: {
    fogColor?: number;
    sunColor?: number;
    sunDirection?: THREE.Vector3;
    density?: number;
    heightFalloff?: number;
  }): void {
    const hasFogColor = params.fogColor !== undefined;
    if (hasFogColor) {
      this.material.uniforms.uFogColor.value.setHex(params.fogColor!);
    }

    const hasSunColor = params.sunColor !== undefined;
    if (hasSunColor) {
      this.material.uniforms.uSunColor.value.setHex(params.sunColor!);
    }

    const hasSunDir = params.sunDirection !== undefined;
    if (hasSunDir) {
      this.material.uniforms.uSunDirection.value.copy(params.sunDirection!);
    }

    const hasDensity = params.density !== undefined;
    if (hasDensity) {
      this.material.uniforms.uDensity.value = params.density!;
    }

    const hasFalloff = params.heightFalloff !== undefined;
    if (hasFalloff) {
      this.material.uniforms.uHeightFalloff.value = params.heightFalloff!;
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    sceneColorTexture: THREE.Texture,
    target: THREE.WebGLRenderTarget | null = null
  ): void {
    this.material.uniforms.tColor.value = sceneColorTexture;
    this.material.uniforms.cameraNear.value = this.sceneCamera.near;
    this.material.uniforms.cameraFar.value = this.sceneCamera.far;
    this.material.uniforms.cameraPosition.value.copy(this.sceneCamera.position);
    this.material.uniforms.cameraWorldMatrix.value.copy(this.sceneCamera.matrixWorld);
    this.material.uniforms.cameraProjectionInverse.value.copy(this.sceneCamera.projectionMatrixInverse);

    renderer.setRenderTarget(target);
    renderer.render(this.quadScene, this.quadCamera);
  }
}

import * as THREE from "three";

export interface LensFlareOptions {
  enabled?: boolean;
  intensity?: number;
  flareColor?: number;
  sunColor?: number;
  streakIntensity?: number;
  ghostIntensity?: number;
  haloIntensity?: number;
}

/**
 * 物理オクルージョン連動 光学シネマティック・レンズフレアパス (Optical Cinematic Lens Flare Pass)
 *
 * 【特徴・技術仕様】
 * 1. 太陽の3D空間射影 (Screen Projection & Viewport Clipping):
 *    太陽（指向性光源）のワールド座標をカメラ視点に基づきスクリーンUV座標 (0.0〜1.0) へ射影。
 *    カメラの背面にある場合は完全に減衰し、画面外近傍ではエッジグレアとして自然に漏れ込む。
 * 2. 深度バッファによるGPUリアルタイム・ソフトオクルージョン (Depth-Based Soft Occlusion):
 *    太陽のスクリーンUV周辺をグリッド状にサンプリングし、ビル群や建造物による遮蔽度合いを
 *    GPU上でリアルタイム算出。CPUリードバックの遅延なく、ビル影に入ると滑らかにフェードアウト。
 * 3. アナモルフィック・ストリーク (Anamorphic Streak):
 *    映画用シネマレンズ特有の、横方向に広がる青〜シアンの美しい色収差光条を再現。
 * 4. スターバースト光芒 (Diffraction Starburst Spikes):
 *    カメラ絞り羽根・レンズ表面の回折による6本の鋭い光芒と太陽中心の強烈なグレアコア。
 * 5. 光学軸マルチエレメント・ゴースト (Multi-Element Lens Ghosts):
 *    太陽位置と画面中心を結ぶ光学軸上に、異なるサイズ・色収差（赤・緑・紫）を持つ複数のボケ円とリングを展開。
 * 6. 大口径ハロー (Lens Halo):
 *    レンズ筒内での内面反射によるリング状ハローを生成。
 */
export class LensFlarePass {
  public material: THREE.ShaderMaterial;
  public renderTarget: THREE.WebGLRenderTarget;

  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private quadMesh: THREE.Mesh;

  private sunScreenPos = new THREE.Vector3();
  private sunWorldPos = new THREE.Vector3(120, 35, -80);

  constructor(width: number, height: number, options: LensFlareOptions = {}) {
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });

    const uniforms = {
      tColor: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      uSunScreenPos: { value: new THREE.Vector3(0.5, 0.5, 1.0) },
      uSunColor: { value: new THREE.Color(options.sunColor ?? 0xffeedd) },
      uFlareColor: { value: new THREE.Color(options.flareColor ?? 0xffbb66) },
      uIntensity: { value: options.intensity ?? 1.0 },
      uStreakIntensity: { value: options.streakIntensity ?? 1.2 },
      uGhostIntensity: { value: options.ghostIntensity ?? 0.8 },
      uHaloIntensity: { value: options.haloIntensity ?? 0.5 },
      uAspectRatio: { value: width / height },
      uEnabled: { value: (options.enabled ?? true) ? 1.0 : 0.0 },
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
      uniform vec3 uSunScreenPos; // xy: スクリーンUV (0~1), z: 視野前方フラグ (>0: 前方)
      uniform vec3 uSunColor;
      uniform vec3 uFlareColor;
      uniform float uIntensity;
      uniform float uStreakIntensity;
      uniform float uGhostIntensity;
      uniform float uHaloIntensity;
      uniform float uAspectRatio;
      uniform float uEnabled;

      varying vec2 vUv;

      // 太陽周辺の深度サンプリングによる遮蔽度判定 (Soft Occlusion)
      float calculateOcclusion(vec2 sunUv) {
        // 画面外またはカメラ背後の場合は完全に遮蔽
        if (sunUv.x < -0.2 || sunUv.x > 1.2 || sunUv.y < -0.2 || sunUv.y > 1.2 || uSunScreenPos.z <= 0.0) {
          return 0.0;
        }

        // 3x3 深度サンプリング
        float visibleSamples = 0.0;
        float totalSamples = 9.0;
        vec2 offsetStep = vec2(0.003, 0.003 * uAspectRatio);

        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 sampleUv = clamp(sunUv + vec2(float(x), float(y)) * offsetStep, 0.001, 0.999);
            float d = texture2D(tDepth, sampleUv).r;
            // 深度値が 0.999 以上（空・無限遠背景）であれば遮蔽物なし
            if (d >= 0.999) {
              visibleSamples += 1.0;
            }
          }
        }
        return visibleSamples / totalSamples;
      }

      // 画面中心軸上のゴースト生成
      vec3 renderGhost(vec2 uv, vec2 ghostPos, float radius, vec3 color, float isRing) {
        vec2 delta = uv - ghostPos;
        delta.x *= uAspectRatio;
        float dist = length(delta);

        if (isRing > 0.5) {
          // リング形状ゴースト
          float ringThickness = 0.015;
          float ring = exp(-pow((dist - radius) / ringThickness, 2.0));
          return color * ring;
        } else {
          // ソフト円形ゴースト
          float circle = smoothstep(radius, radius * 0.4, dist);
          return color * circle;
        }
      }

      void main() {
        vec4 sceneColor = texture2D(tColor, vUv);

        if (uEnabled < 0.5 || uIntensity <= 0.001) {
          gl_FragColor = sceneColor;
          return;
        }

        vec2 sunUv = uSunScreenPos.xy;
        float occlusion = calculateOcclusion(sunUv);

        if (occlusion <= 0.001) {
          gl_FragColor = sceneColor;
          return;
        }

        // アスペクト補正ベクトル
        vec2 toSun = vUv - sunUv;
        toSun.x *= uAspectRatio;
        float distToSun = length(toSun);

        // 1. 太陽コア & 放射スターバースト (Diffraction Spikes)
        float core = 0.02 / (distToSun + 0.015);
        float angle = atan(toSun.y, toSun.x);
        float spikes = sin(angle * 6.0) * sin(angle * 12.0) * 0.5 + 0.5;
        spikes = pow(spikes, 8.0) * (0.02 / (distToSun + 0.02));
        vec3 sunBurst = (uSunColor * core + uFlareColor * spikes * 1.5);

        // 2. アナモルフィック・シネマティックストリーク (Anamorphic Streak)
        float dy = abs(vUv.y - sunUv.y);
        float dx = abs(vUv.x - sunUv.x) * 0.25;
        float streakBase = exp(-dy * 160.0) * exp(-dx * 2.5);
        // 色収差（青〜シアンの外側へのシフト）
        vec3 streakColor = vec3(
          streakBase * 0.7,
          streakBase * 0.9,
          exp(-dy * 130.0) * exp(-dx * 2.2) * 1.2
        ) * uStreakIntensity;

        // 3. 光学軸マルチエレメント・ゴースト (Lens Ghosts)
        vec2 opticalAxis = vec2(0.5) - sunUv;
        vec3 ghosts = vec3(0.0);

        // ゴースト1: 中型グリーンサークル
        ghosts += renderGhost(vUv, sunUv + opticalAxis * 0.4, 0.09, vec3(0.2, 0.8, 0.4), 0.0) * 0.6;
        // ゴースト2: シャープなバイオレットリング
        ghosts += renderGhost(vUv, sunUv + opticalAxis * 0.7, 0.05, vec3(0.8, 0.3, 0.9), 1.0) * 0.8;
        // ゴースト3: 大型薄型アンバーサークル
        ghosts += renderGhost(vUv, sunUv + opticalAxis * 1.2, 0.16, vec3(0.9, 0.6, 0.2), 0.0) * 0.35;
        // ゴースト4: 小型シアンリング
        ghosts += renderGhost(vUv, sunUv + opticalAxis * 1.5, 0.03, vec3(0.2, 0.9, 0.9), 1.0) * 0.9;
        // ゴースト5: 画面中心付近の微小スター
        ghosts += renderGhost(vUv, sunUv + opticalAxis * 0.9, 0.02, vec3(1.0, 0.9, 0.6), 0.0) * 1.1;

        ghosts *= uGhostIntensity;

        // 4. レンズハローリング (Halo Ring)
        float haloRadius = 0.42;
        float haloThickness = 0.03;
        float haloDist = abs(distToSun - haloRadius);
        float halo = exp(-pow(haloDist / haloThickness, 2.0)) * uHaloIntensity;
        vec3 haloColor = vec3(halo * 0.8, halo * 0.6, halo * 1.0) * uFlareColor;

        // 全フレアエレメントの合成
        vec3 totalFlare = (sunBurst + streakColor + ghosts + haloColor) * occlusion * uIntensity;

        // 加算合成（シーン色 + フレア）
        gl_FragColor = vec4(sceneColor.rgb + totalFlare, sceneColor.a);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quadMesh);
  }

  public setSize(width: number, height: number): void {
    this.renderTarget.setSize(width, height);
    this.material.uniforms.uAspectRatio.value = width / height;
  }

  public setSunWorldPosition(pos: THREE.Vector3): void {
    this.sunWorldPos.copy(pos);
  }

  /**
   * カメラに基づいて太陽のスクリーン座標を更新する。
   * How: ワールド座標からカメラのクリップ空間へ射影し、正規化デバイス座標 (NDC) を UV 空間 (0~1) に変換する。
   */
  public updateSunPosition(camera: THREE.PerspectiveCamera): void {
    // 太陽の方向ベクトルから遠方の擬似ワールド座標を算出
    const tempPos = this.sunWorldPos.clone();

    // カメラのクリップ空間へ射影
    tempPos.project(camera);

    // NDC (-1~1) から スクリーンUV (0~1) へ変換
    const screenX = (tempPos.x + 1.0) * 0.5;
    const screenY = (tempPos.y + 1.0) * 0.5;

    // カメラ前方判定 (NDC z < 1.0 かつカメラの前方)
    const isForward = tempPos.z < 1.0;
    this.sunScreenPos.set(screenX, screenY, isForward ? 1.0 : -1.0);

    this.material.uniforms.uSunScreenPos.value.copy(this.sunScreenPos);
  }

  public setParams(params: LensFlareOptions): void {
    const hasEnabled = params.enabled !== undefined;
    if (hasEnabled) {
      this.material.uniforms.uEnabled.value = params.enabled ? 1.0 : 0.0;
    }

    const hasIntensity = params.intensity !== undefined;
    if (hasIntensity) {
      this.material.uniforms.uIntensity.value = params.intensity!;
    }

    const hasFlareColor = params.flareColor !== undefined;
    if (hasFlareColor) {
      this.material.uniforms.uFlareColor.value.setHex(params.flareColor!);
    }

    const hasSunColor = params.sunColor !== undefined;
    if (hasSunColor) {
      this.material.uniforms.uSunColor.value.setHex(params.sunColor!);
    }

    const hasStreak = params.streakIntensity !== undefined;
    if (hasStreak) {
      this.material.uniforms.uStreakIntensity.value = params.streakIntensity!;
    }

    const hasGhost = params.ghostIntensity !== undefined;
    if (hasGhost) {
      this.material.uniforms.uGhostIntensity.value = params.ghostIntensity!;
    }

    const hasHalo = params.haloIntensity !== undefined;
    if (hasHalo) {
      this.material.uniforms.uHaloIntensity.value = params.haloIntensity!;
    }
  }

  /**
   * レンズフレアパスの描画
   * @param renderer WebGLRenderer
   * @param sceneColorTexture 入力カラーテクスチャ（深度フォグ通過後）
   * @param depthTexture シーン深度テクスチャ
   * @param target 出力レンダーターゲット（nullなら画面）
   */
  public render(
    renderer: THREE.WebGLRenderer,
    sceneColorTexture: THREE.Texture,
    depthTexture: THREE.Texture | null,
    target: THREE.WebGLRenderTarget | null = null,
  ): void {
    this.material.uniforms.tColor.value = sceneColorTexture;
    this.material.uniforms.tDepth.value = depthTexture;

    renderer.setRenderTarget(target);
    renderer.render(this.quadScene, this.quadCamera);
  }
}

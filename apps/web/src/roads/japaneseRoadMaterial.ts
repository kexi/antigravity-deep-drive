import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import type { PuddleEnvironmentSyncParams } from "../shaders/puddleShader";

/**
 * 日本の道路用カスタムPBRマテリアル
 * 【設計方針】
 * - 視覚的には「リアルな凸凹＋轍（わだち）水たまり鏡面反射」：
 *   - 3Dプロシージャルテクスチャ（Data3DTexture / sampler3D）による完全シームレスな立体サンプリング
 *   - R: アスファルト骨材のざらつき法線バンプ
 *   - G: 経年劣化のひび割れ（クラック）
 *   - B: 補修跡（パッチワーク舗装：四角いつぎはぎ）
 *   - A: 雨天・雨上がり時に凹部や車線の轍（Wheel Ruts）に水が溜まる水たまり深度（Puddle Depth）
 *   - 水たまり内部では大気空・太陽スペキュラ・丸の内ビル群シルエット＆窓明かり・街灯ネオンを解析的に平面鏡面反射
 * - 物理的には「完全に平ら」：
 *   - ジオメトリ表面を物理コライダーで平滑に保ち、タイヤの引っかかり・不要な跳ねを根絶
 */

export interface JapaneseRoadMaterialOptions {
  baseRoughness?: number;
  baseMetalness?: number;
  noise3DTexture?: THREE.Data3DTexture;
}

export class JapaneseRoadMaterial extends THREE.MeshStandardMaterial {
  private static shared3DTexture: THREE.Data3DTexture | null = null;

  public uRainWetness: { value: number };
  public uTime: { value: number };
  public uRippleIntensity: { value: number };
  public uRoadNoise3D: { value: THREE.Data3DTexture };
  public uSunDirection: { value: THREE.Vector3 };
  public uSunColor: { value: THREE.Color };
  public uSkyHorizonColor: { value: THREE.Color };
  public uSkyZenithColor: { value: THREE.Color };
  public uNightFactor: { value: number };

  constructor(options: JapaneseRoadMaterialOptions = {}) {
    super({
      color: 0x27292d,
      roughness: options.baseRoughness ?? 0.85,
      metalness: options.baseMetalness ?? 0.12,
    });

    const hasSharedTex = Boolean(JapaneseRoadMaterial.shared3DTexture);
    if (!hasSharedTex) {
      JapaneseRoadMaterial.shared3DTexture =
        Procedural3DTextureGenerator.generateAsphalt3DTexture(64);
    }

    const tex3D = options.noise3DTexture ?? JapaneseRoadMaterial.shared3DTexture!;

    this.uRainWetness = { value: 0.0 };
    this.uTime = { value: 0.0 };
    this.uRippleIntensity = { value: 1.0 };
    this.uRoadNoise3D = { value: tex3D };
    this.uSunDirection = { value: new THREE.Vector3(0.68, 0.25, 0.68).normalize() };
    this.uSunColor = { value: new THREE.Color(0xfb923c) };
    this.uSkyHorizonColor = { value: new THREE.Color(0xfdba74) };
    this.uSkyZenithColor = { value: new THREE.Color(0x4c1d95) };
    this.uNightFactor = { value: 0.0 };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uRippleIntensity = this.uRippleIntensity;
      shader.uniforms.uRoadNoise3D = this.uRoadNoise3D;
      shader.uniforms.uSunDirection = this.uSunDirection;
      shader.uniforms.uSunColor = this.uSunColor;
      shader.uniforms.uSkyHorizonColor = this.uSkyHorizonColor;
      shader.uniforms.uSkyZenithColor = this.uSkyZenithColor;
      shader.uniforms.uNightFactor = this.uNightFactor;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vWorldPos;
        varying vec2 vRoadUv;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRoadUv = uv;
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        precision highp sampler3D;
        uniform float uRainWetness;
        uniform float uTime;
        uniform float uRippleIntensity;
        uniform sampler3D uRoadNoise3D;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uSkyHorizonColor;
        uniform vec3 uSkyZenithColor;
        uniform float uNightFactor;
        varying vec3 vWorldPos;
        varying vec2 vRoadUv;

        // 水たまり用雨滴着水リップル計算・低周波盆地FBM
        vec2 roadHash2D(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        float roadPerlin2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float n00 = dot(roadHash2D(i + vec2(0.0, 0.0)) - 0.5, f - vec2(0.0, 0.0));
          float n10 = dot(roadHash2D(i + vec2(1.0, 0.0)) - 0.5, f - vec2(1.0, 0.0));
          float n01 = dot(roadHash2D(i + vec2(0.0, 1.0)) - 0.5, f - vec2(0.0, 1.0));
          float n11 = dot(roadHash2D(i + vec2(1.0, 1.0)) - 0.5, f - vec2(1.0, 1.0));
          return 0.5 + 0.5 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
        }

        float roadPuddleFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * roadPerlin2D(p);
            p = rot * p * 2.03 + vec2(3.1, 7.4);
            a *= 0.5;
          }
          return v;
        }

        // 車道水たまりの盆地深度（低周波FBM + 車線の轍 Wheel Ruts + 路肩側溝 + 3D微細凹部）
        // Why not: 3Dテクスチャ(vWorldPos * 0.18)単体では5.5m周期の細かい斑点になるため、
        // 道路構造令に基づく横断勾配（中央が高く車線轍・路肩に水が溜まる）と大域FBMを組み合わせる
        float sampleRoadPuddleBasin(vec3 worldPos, float voxelAlpha, float crackVal) {
          float macroBasin = roadPuddleFbm(vec2(worldPos.x * 0.14 + 2.3, worldPos.z * 0.055));
          float subBasin = roadPuddleFbm(vec2(worldPos.x * 0.32 - 5.1, worldPos.z * 0.12 + 1.7));
          // 車線の轍（わだち: x = ±2.1m, ±5.4m 付近のタイヤ通過ライン）と路肩側溝の窪み
          // Why not: 縦断方向に一様な轍バイアスを加算すると直線的なストライプ模様になるため、
          // 大域FBMの凹部（macroBasin）と掛け合わせて轍沿いに自然な間隔で点在させる
          float absX = abs(worldPos.x);
          float innerRut = exp(-pow((absX - 2.1) * 0.72, 2.0));
          float outerRut = exp(-pow((absX - 5.4) * 0.65, 2.0));
          float gutterPool = smoothstep(6.0, 8.0, absX) * 0.75;
          float rutProfile = max(max(innerRut, outerRut), gutterPool);
          float rutPocket = rutProfile * smoothstep(0.32, 0.74, macroBasin);
          // 道路中央（センターライン付近 x ≈ 0）は水はけを良くして標示を見やすく保つ
          float crownDrain = smoothstep(0.0, 1.2, absX);
          float combinedBasin = macroBasin * 0.60 + subBasin * 0.16 + rutPocket * 0.28 + voxelAlpha * 0.06 + crackVal * 0.06;
          return combinedBasin * (0.58 + 0.42 * crownDrain);
        }

        vec3 calculatePuddleRipples(vec2 uv, float time, float intensity) {
          vec2 p = uv * 2.6;
          vec3 rippleN = vec3(0.0, 0.0, 1.0);
          // 雨上がりでも水面が微風で揺らぐさざ波（Capillary waves）
          rippleN.x += sin(uv.x * 3.5 + uv.y * 2.6 + time * 1.8) * 0.015;
          rippleN.y += cos(uv.x * 2.8 - uv.y * 4.0 - time * 1.4) * 0.015;

          if (intensity <= 0.01) {
            return normalize(rippleN);
          }

          for (int i = 0; i < 3; i++) {
            float scale = 1.0 + float(i) * 0.32;
            float t = time * 1.35 + float(i) * 1.57;
            vec2 gridPos = p * scale + float(i) * vec2(17.1, 31.4);
            vec2 cellId = floor(gridPos);
            vec2 cellFrac = fract(gridPos);

            vec2 dropCenter = 0.22 + 0.56 * roadHash2D(cellId);
            vec2 diff = cellFrac - dropCenter;
            float dist = length(diff);

            float dropAge = fract(t * 1.15 + dot(cellId, vec2(0.4, 0.6)));
            float waveRadius = dropAge * 0.75;
            float waveDist = dist - waveRadius;

            float wave = sin(waveDist * 46.0) * exp(-abs(waveDist) * 16.0) * exp(-dist * 3.5) * (1.0 - dropAge);
            vec2 grad = normalize(diff + 0.0001) * wave * 0.36;
            rippleN.xy += grad * intensity;
          }
          return normalize(rippleN);
        }

        // 車道水たまりの解析的平面鏡面反射（空・太陽・丸の内ビル群シルエット＆窓明かり・街灯ネオン）
        vec3 calculateRoadPuddleReflection(vec3 worldPos, vec3 worldNormal, float puddleStrength) {
          vec3 V = normalize(cameraPosition - worldPos);
          vec3 N = normalize(worldNormal);
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.02);

          // 水のフレネル反射率 (IOR = 1.333, F0 = 0.02)
          float NoV = max(dot(N, V), 0.0);
          float fresnel = 0.04 + 0.96 * pow(1.0 - NoV, 4.0);

          // 1. 大気空グラデーションと太陽方位グロー
          float skyElev = pow(clamp(R.y, 0.0, 1.0), 0.55);
          vec3 skyGrad = mix(uSkyHorizonColor, uSkyZenithColor, skyElev);
          vec3 sunDir = normalize(uSunDirection);
          float sunHorizonGlow = pow(max(dot(normalize(vec3(R.x, R.y * 0.35, R.z)), normalize(vec3(sunDir.x, sunDir.y * 0.35, sunDir.z))), 0.0), 3.5);
          skyGrad += uSunColor * sunHorizonGlow * (0.42 * (1.0 - uNightFactor * 0.6));

          // 2. 丸の内ビル群のシルエット＆滑らかなカーテンウォール環境光反射
          // Why not: worldPos.z や worldPos.x の周期サイン波（sin(worldPos.z * 0.32) 等）を使うと
          // 道路の水たまり全面に規則的な横縞・ストライプ模様が焼き付くため、視線反射ベクトル R の方向のみで評価する
          float lateralAngle = abs(R.x) / (abs(R.z) + 0.42);
          float buildingMask = smoothstep(0.38, 0.12, R.y) * smoothstep(0.24, 0.62, lateralAngle);
          vec3 buildingBase = mix(vec3(0.07, 0.11, 0.18), vec3(0.02, 0.04, 0.08), uNightFactor);

          float floorBands = smoothstep(0.35, 0.78, sin(R.y * 28.0) * 0.5 + 0.5);
          float bayPillars = smoothstep(0.30, 0.75, sin(atan(R.x, R.z) * 18.0) * 0.5 + 0.5);
          float winMask = floorBands * bayPillars * smoothstep(0.02, 0.28, R.y);
          vec3 winGlow = mix(vec3(1.0, 0.78, 0.45), vec3(0.42, 0.80, 1.0), clamp(R.z * 0.5 + 0.5, 0.0, 1.0));
          float winIntensity = mix(0.18, 0.65, max(uNightFactor, uRainWetness * 0.55));
          vec3 buildingRefl = buildingBase + winGlow * winMask * winIntensity;

          vec3 envColor = mix(skyGrad, buildingRefl, buildingMask * 0.68);

          // 3. 街灯（アンバー）の路面水たまり反射グロー（路肩側の視線浅角で自然に広がる反射）
          float lampLateral = exp(-abs(abs(worldPos.x) - 6.5) * 0.18);
          float lampReflectDir = smoothstep(0.15, 0.75, abs(R.x));
          float rippleShift = (N.x + N.z) * 3.5;
          float lampStreak = lampLateral * lampReflectDir * clamp(1.0 + rippleShift, 0.5, 1.6);
          vec3 streetLightRefl = vec3(1.0, 0.70, 0.30) * lampStreak * mix(0.22, 0.85, max(uNightFactor, uRainWetness * 0.60));

          // 4. 太陽スペキュラハイライト
          float sunSpecTight = pow(max(dot(R, sunDir), 0.0), 80.0);
          float sunSpecWide = pow(max(dot(R, sunDir), 0.0), 16.0);
          vec3 sunSpecular = uSunColor * (sunSpecTight * 1.9 + sunSpecWide * 0.42) * (1.0 - uNightFactor * 0.5);

          // 5. 波紋リングの煌めき（雨量に比例）
          float rippleSlope = length(N.xz);
          vec3 rippleSparkle = mix(uSkyHorizonColor, vec3(0.9, 0.96, 1.0), 0.55) * smoothstep(0.04, 0.22, rippleSlope) * (0.38 * clamp(uRippleIntensity, 0.0, 1.0));

          vec3 baseWater = vec3(0.025, 0.05, 0.08);
          vec3 totalRefl = (envColor + streetLightRefl + sunSpecular + rippleSparkle) * mix(0.48, 0.98, fresnel);
          return mix(baseWater, totalRefl, clamp(fresnel + 0.34, 0.0, 1.0)) * (0.72 + 0.28 * puddleStrength);
        }
        `,
      );

      // 3Dボリュームテクスチャからの直接法線バンプサンプリング
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>

        // マルチスケール＆非共役回転による3Dテクスチャサンプリング（5.55m周期の規則的タイリング模様を完全に解消）
        vec3 coordFine = vWorldPos * 0.42;
        vec3 coordMacro = vec3(
          vWorldPos.x * 0.073 - vWorldPos.z * 0.048,
          vWorldPos.y * 0.085 + 0.37,
          vWorldPos.x * 0.048 + vWorldPos.z * 0.073
        );
        vec4 noiseVoxelFine = texture(uRoadNoise3D, coordFine);
        vec4 noiseVoxelMacro = texture(uRoadNoise3D, coordMacro);

        // Rチャンネル: アスファルト砕石骨材のマイクロバンプ
        // Why not: 水平路面（ワールド法線 +Y = (0, 1, 0)）に対して vec3(dX, dZ, 1.0) を作ると
        // ワールド +Z 向き（地面と平行）の誤った法線になり陰影が破綻するため、
        // 正しくワールド +Y を主軸とする vec3(dX, 1.0, dZ) で構成し、Z方向微分は stepOffset.yyx で取得する
        vec3 stepOffset = vec3(0.035, 0.0, 0.0);
        float hCenter = noiseVoxelFine.r * 0.7 + noiseVoxelMacro.r * 0.3;
        float hRight   = texture(uRoadNoise3D, coordFine + stepOffset.xyy).r * 0.7 + noiseVoxelMacro.r * 0.3;
        float hForward = texture(uRoadNoise3D, coordFine + stepOffset.yyx).r * 0.7 + noiseVoxelMacro.r * 0.3;

        float dX = (hCenter - hRight) * 0.24;
        float dZ = (hCenter - hForward) * 0.24;

        // Gチャンネル: 微細クラックによる控えめな法線変調
        float crackVal = noiseVoxelFine.g * noiseVoxelMacro.a;
        vec3 worldBumpNormal = normalize(vec3(dX + crackVal * 0.06, 1.0, dZ + crackVal * 0.06));
        vec3 calcNormal = normalize(mat3(viewMatrix) * worldBumpNormal);

        // 雨天・雨上がり時: 水たまり部分にアスファルト凹凸の平滑化＋雨滴リップル波紋法線を適用
        if (uRainWetness > 0.01) {
          float basinDepth = sampleRoadPuddleBasin(vWorldPos, noiseVoxelMacro.a, crackVal);
          float threshold = 0.56 - uRainWetness * 0.10;
          float puddleMask = smoothstep(threshold, threshold + 0.09, basinDepth) * smoothstep(0.0, 0.35, uRainWetness);
          if (puddleMask > 0.02) {
            vec3 rip = calculatePuddleRipples(vWorldPos.xz, uTime, uRainWetness * uRippleIntensity);
            vec3 perturbedN = normalize(vec3(rip.x, rip.z, rip.y));
            calcNormal = normalize(mix(calcNormal, normalize(mat3(viewMatrix) * perturbedN), puddleMask * 0.92));
          }
        }

        normal = calcNormal;
        `,
      );

      // カラー・ラフネス・メタルネス・水たまり鏡面反射の3Dテクスチャ変調
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        /* glsl */ `
        #include <metalnessmap_fragment>

        // マルチスケールサンプリングで規則的なリピート模様を防止し、日本の密粒度アスファルトの自然な骨材粒子感を再現
        vec3 sampleFine = vWorldPos * 0.42;
        vec3 sampleMacro = vec3(
          vWorldPos.x * 0.073 - vWorldPos.z * 0.048,
          vWorldPos.y * 0.085 + 0.37,
          vWorldPos.x * 0.048 + vWorldPos.z * 0.073
        );
        vec4 voxelFine = texture(uRoadNoise3D, sampleFine);
        vec4 voxelMacro = texture(uRoadNoise3D, sampleMacro);

        // R & Bチャンネル: 砕石骨材の微粒子スペックルと広域アスファルトバインダーの緩やかな濃淡
        float aggregateGrain = mix(voxelFine.r, voxelMacro.r, 0.35);
        float binderTone = voxelMacro.b;
        diffuseColor.rgb *= mix(0.92, 1.08, aggregateGrain);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.15, 0.18), binderTone * 0.18);

        // Gチャンネル: 微細クラック（目立ちすぎない自然な経年変化に抑える）
        float crackDarkness = voxelFine.g * smoothstep(0.35, 0.75, voxelMacro.a);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.11, 0.13), crackDarkness * 0.22);
        roughnessFactor = clamp(roughnessFactor + (0.5 - aggregateGrain) * 0.08, 0.1, 0.96);

        // Aチャンネル + 轍（Wheel Ruts）: 3D水たまり深度（凹部に水が溜まり、周囲に濡れ縁、内部は鏡面反射に変化）
        if (uRainWetness > 0.01) {
          float basinDepth = sampleRoadPuddleBasin(vWorldPos, voxelMacro.a, crackDarkness);
          float threshold = 0.56 - uRainWetness * 0.10;

          // 水たまり外周の浸透湿潤帯（濡れ縁 Wet Meniscus Rim）
          float wetRim = smoothstep(threshold - 0.14, threshold, basinDepth);
          // 水たまりコア領域
          float puddle = smoothstep(threshold, threshold + 0.08, basinDepth) * smoothstep(0.0, 0.35, uRainWetness);

          // 濡れたアスファルトの黒ずみ変調
          diffuseColor.rgb *= mix(1.0, 0.42, wetRim * clamp(uRainWetness * 1.15, 0.0, 1.0));
          diffuseColor.rgb *= mix(1.0, 0.25, puddle);

          roughnessFactor = mix(roughnessFactor, 0.02, puddle); // 水たまり鏡面化
          roughnessFactor = mix(roughnessFactor, 0.26, uRainWetness * (1.0 - puddle));
          metalnessFactor = mix(metalnessFactor, 0.75, puddle * 0.9);

          // 水たまり表面の解析的平面鏡面反射を加算
          if (puddle > 0.01) {
            vec3 ripLocal = calculatePuddleRipples(vWorldPos.xz, uTime, uRainWetness * uRippleIntensity);
            vec3 puddleWorldN = normalize(vec3(ripLocal.x * 0.65, ripLocal.z, ripLocal.y * 0.65));
            vec3 roadPuddleRefl = calculateRoadPuddleReflection(vWorldPos, puddleWorldN, puddle);
            totalEmissiveRadiance += roadPuddleRefl * puddle;
          }
        }
        `,
      );
    };
  }

  /**
   * 天候・太陽・空色・波紋強度を車道マテリアルへ一括同期する。
   * How: WeatherSystem から取得した環境光をユニフォームへ反映し、車道水たまりの鏡面反射色を更新する。
   */
  public syncEnvironment(params: PuddleEnvironmentSyncParams): void {
    this.uRainWetness.value = params.wetness;
    this.uTime.value = params.time;

    const hasRippleIntensity = params.rippleIntensity !== undefined;
    if (hasRippleIntensity) {
      this.uRippleIntensity.value = params.rippleIntensity!;
    }

    const hasSunDirection = params.sunDirection !== undefined;
    if (hasSunDirection) {
      this.uSunDirection.value.copy(params.sunDirection!).normalize();
    }

    const hasSunColor = params.sunColor !== undefined;
    if (hasSunColor) {
      const isColorObj = params.sunColor instanceof THREE.Color;
      if (isColorObj) {
        this.uSunColor.value.copy(params.sunColor as THREE.Color);
      } else {
        this.uSunColor.value.setHex(params.sunColor as number);
      }
    }

    const hasHorizon = params.skyHorizonColor !== undefined;
    if (hasHorizon) {
      const isColorObj = params.skyHorizonColor instanceof THREE.Color;
      if (isColorObj) {
        this.uSkyHorizonColor.value.copy(params.skyHorizonColor as THREE.Color);
      } else {
        this.uSkyHorizonColor.value.setHex(params.skyHorizonColor as number);
      }
    }

    const hasZenith = params.skyZenithColor !== undefined;
    if (hasZenith) {
      const isColorObj = params.skyZenithColor instanceof THREE.Color;
      if (isColorObj) {
        this.uSkyZenithColor.value.copy(params.skyZenithColor as THREE.Color);
      } else {
        this.uSkyZenithColor.value.setHex(params.skyZenithColor as number);
      }
    }

    const hasNightFactor = params.nightFactor !== undefined;
    if (hasNightFactor) {
      this.uNightFactor.value = params.nightFactor!;
    }
  }
}

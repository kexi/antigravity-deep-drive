import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

export interface PuddleShaderOptions {
  baseColor?: number;
  baseRoughness?: number;
  baseMetalness?: number;
  puddleThreshold?: number;
  rippleSpeed?: number;
  rippleFrequency?: number;
  sunDirection?: THREE.Vector3;
  sunColor?: number;
  skyHorizonColor?: number;
  skyZenithColor?: number;
  nightFactor?: number;
}

export interface PuddleEnvironmentSyncParams {
  wetness: number;
  time: number;
  rippleIntensity?: number;
  sunDirection?: THREE.Vector3;
  sunColor?: THREE.Color | number;
  skyHorizonColor?: THREE.Color | number;
  skyZenithColor?: THREE.Color | number;
  nightFactor?: number;
}

/**
 * 物理ベース雨天水たまりシェーダー (Physically Based Puddle & Planar Reflection Shader)
 *
 * 【特徴・視覚表現】
 * 1. 動的雨滴リップル法線 + 微風さざ波 (Multi-Layer Raindrop Ripples & Capillary Wind Waves):
 *    着水した雨滴が広がる3層同心円分散波紋と、雨上がりでも水面を揺らす微風さざ波をGLSL内で合成。
 * 2. 濡れ縁・浸透湿潤帯 (Porous Wet Meniscus Rim):
 *    水たまりの外縁部にアスファルト・石畳へ水が染み込んだ濃い湿潤帯（濡れ縁）と表面張力メニスカスを表現。
 * 3. 解析的平面鏡面反射・フレネル (Analytical Planar Mirror & Schlick Fresnel IOR 1.333):
 *    Why not: scene.environment (HDRI キューブマップ) に依存すると未設定時に水たまりが黒い斑点になるため、
 *    大気空グラデーション・太陽スペキュラ・丸の内ビル群シルエット＆窓明かり・街灯ネオンをシェーダー内で解析的にレイキャスト反射。
 * 4. ワールド座標系シームレス水たまり盆地分布:
 *    マルチオクターブ Perlin FBM と轍（わだち）・石畳凹部マスクにより境界のない自然な水たまり形状を生成。
 */
export class PuddleMaterial extends THREE.MeshStandardMaterial {
  public uRainWetness: { value: number };
  public uTime: { value: number };
  public uPuddleThreshold: { value: number };
  public uRippleIntensity: { value: number };
  public uRippleSpeed: { value: number };
  public uSunDirection: { value: THREE.Vector3 };
  public uSunColor: { value: THREE.Color };
  public uSkyHorizonColor: { value: THREE.Color };
  public uSkyZenithColor: { value: THREE.Color };
  public uNightFactor: { value: number };
  public uRoadVolumeTex: { value: THREE.Data3DTexture };

  constructor(options: PuddleShaderOptions = {}) {
    super({
      color: options.baseColor ?? 0x24272c,
      roughness: options.baseRoughness ?? 0.88,
      metalness: options.baseMetalness ?? 0.1,
    });

    this.uRainWetness = { value: 0.0 };
    this.uTime = { value: 0.0 };
    this.uPuddleThreshold = { value: options.puddleThreshold ?? 0.44 };
    this.uRippleIntensity = { value: 1.0 };
    this.uRippleSpeed = { value: options.rippleSpeed ?? 1.25 };
    this.uSunDirection = {
      value: options.sunDirection
        ? options.sunDirection.clone().normalize()
        : new THREE.Vector3(0.68, 0.25, 0.68).normalize(),
    };
    this.uSunColor = { value: new THREE.Color(options.sunColor ?? 0xfb923c) };
    this.uSkyHorizonColor = { value: new THREE.Color(options.skyHorizonColor ?? 0xfdba74) };
    this.uSkyZenithColor = { value: new THREE.Color(options.skyZenithColor ?? 0x4c1d95) };
    this.uNightFactor = { value: options.nightFactor ?? 0.0 };
    this.uRoadVolumeTex = {
      value: Procedural3DTextureGenerator.getSharedAsphalt3DTexture(),
    };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uPuddleThreshold = this.uPuddleThreshold;
      shader.uniforms.uRippleIntensity = this.uRippleIntensity;
      shader.uniforms.uRippleSpeed = this.uRippleSpeed;
      shader.uniforms.uSunDirection = this.uSunDirection;
      shader.uniforms.uSunColor = this.uSunColor;
      shader.uniforms.uSkyHorizonColor = this.uSkyHorizonColor;
      shader.uniforms.uSkyZenithColor = this.uSkyZenithColor;
      shader.uniforms.uNightFactor = this.uNightFactor;
      shader.uniforms.uRoadVolumeTex = this.uRoadVolumeTex;

      // 頂点シェーダー: ワールド座標の伝達
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vWorldPosition;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

      // フラグメントシェーダー: リップル関数・水たまりノイズ・解析的環境鏡面反射関数の定義
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uRainWetness;
        uniform float uTime;
        uniform float uPuddleThreshold;
        uniform float uRippleIntensity;
        uniform float uRippleSpeed;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uSkyHorizonColor;
        uniform vec3 uSkyZenithColor;
        uniform float uNightFactor;
        uniform sampler3D uRoadVolumeTex;
        varying vec3 vWorldPosition;

        // 擬似乱数ハッシュ
        vec2 puddleHash2D(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        // 水たまり分布用2D低周波Perlinノイズ
        float puddlePerlinNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);

          float n00 = dot(puddleHash2D(i + vec2(0.0, 0.0)) - 0.5, f - vec2(0.0, 0.0));
          float n10 = dot(puddleHash2D(i + vec2(1.0, 0.0)) - 0.5, f - vec2(1.0, 0.0));
          float n01 = dot(puddleHash2D(i + vec2(0.0, 1.0)) - 0.5, f - vec2(0.0, 1.0));
          float n11 = dot(puddleHash2D(i + vec2(1.0, 1.0)) - 0.5, f - vec2(1.0, 1.0));

          return 0.5 + 0.5 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
        }

        // マルチオクターブ FBM ノイズ（水たまりの有機的な輪郭生成）
        float puddleFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * puddlePerlinNoise(p);
            p = rot * p * 2.07 + vec2(1.7, 9.2);
            a *= 0.5;
          }
          return v;
        }

        // 道路・広場の水たまり盆地ハイトフィールド（低周波FBM + 3D ボリュームテクスチャ盆地マスク）
        // Why not: sin(worldXZ.x) * cos(worldXZ.y) のような周期三角関数を混ぜると、歩道や広場に規則的な水玉格子模様が並ぶため、
        // 非共役回転をかけた2層のマルchioクターブFBMと3Dボリュームノイズだけで有機的な水たまり輪郭を作る
        float samplePuddleBasin(vec2 worldXZ) {
          float macroFbm = puddleFbm(worldXZ * 0.045);
          float mesoFbm = puddlePerlinNoise(worldXZ * 0.12 + vec2(4.7, -3.1)) * 0.18;
          vec2 rotatedXZ = vec2(worldXZ.x * 0.028 - worldXZ.y * 0.019, worldXZ.x * 0.019 + worldXZ.y * 0.028);
          float secondaryBasin = puddleFbm(rotatedXZ + vec2(11.3, 5.9));
          vec4 volSample = texture(uRoadVolumeTex, vec3(worldXZ.x * 0.035, 0.25, worldXZ.y * 0.035));
          return macroFbm * 0.58 + mesoFbm + secondaryBasin * 0.16 + volSample.a * 0.14;
        }

        // 微風による水面さざ波法線（雨が止んだ後の残水でも水面を微細に揺らす）
        vec2 calculateCapillaryWaves(vec2 uv, float time) {
          float w1 = sin(uv.x * 3.6 + uv.y * 2.8 + time * 1.8);
          float w2 = cos(uv.x * 2.9 - uv.y * 4.1 - time * 1.4);
          return vec2(w1, w2) * 0.015;
        }

        // 雨滴リップル法線生成 (3層の時間オフセット同心円波紋 + 分散リング干渉)
        vec3 calculateRainRipples(vec2 uv, float time, float intensity) {
          vec2 p = uv * 2.6;
          vec3 rippleNormal = vec3(0.0, 0.0, 1.0);

          // 微風によるさざ波は常にわずかに付与
          rippleNormal.xy += calculateCapillaryWaves(uv, time);

          if (intensity <= 0.01) {
            return normalize(rippleNormal);
          }

          // 3層の時間オフセットグリッドによる着水波紋
          for (int layer = 0; layer < 3; layer++) {
            float layerScale = 1.0 + float(layer) * 0.32;
            float layerTime = time * uRippleSpeed + float(layer) * 1.47;
            vec2 gridPos = p * layerScale + float(layer) * vec2(13.4, 27.1);
            vec2 cellId = floor(gridPos);
            vec2 cellFrac = fract(gridPos);

            // 各セルの着水中心点
            vec2 dropCenter = 0.22 + 0.56 * puddleHash2D(cellId);
            vec2 diff = cellFrac - dropCenter;
            float dist = length(diff);

            // 時間周期で広がる同心円波紋リング（外周減衰 + 滑らかな正弦波）
            float dropAge = fract(layerTime * 1.15 + dot(cellId, vec2(0.37, 0.73)));
            float waveRadius = dropAge * 0.75;
            float waveDist = dist - waveRadius;

            float ringEnvelope = exp(-abs(waveDist) * 16.0) * exp(-dist * 3.5) * (1.0 - dropAge);
            float wave = sin(waveDist * 46.0) * ringEnvelope;
            vec2 grad = normalize(diff + 0.0001) * wave * 0.36;

            rippleNormal.xy += grad * intensity;
          }

          return normalize(rippleNormal);
        }

        // 水たまり表面の解析的平面鏡面反射（空・太陽・丸の内高層ビル群・街灯ネオン）
        vec3 calculatePuddleEnvReflection(vec3 worldPos, vec3 worldNormal, float puddleDepth) {
          vec3 V = normalize(cameraPosition - worldPos);
          vec3 N = normalize(worldNormal);
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.02);

          // 1. 水のフレネル反射率 (Schlick近似: 水の屈折率 IOR = 1.333 -> F0 = 0.02)
          float NoV = max(dot(N, V), 0.0);
          float fresnel = 0.04 + 0.96 * pow(1.0 - NoV, 4.0);

          // 2. 大気スカイドーム反射（地平線〜天頂のグラデーション + 太陽方向の夕焼け/青空グロー）
          float skyElev = pow(clamp(R.y, 0.0, 1.0), 0.55);
          vec3 skyGrad = mix(uSkyHorizonColor, uSkyZenithColor, skyElev);
          vec3 sunDir = normalize(uSunDirection);
          float sunAzimuthGlow = pow(max(dot(normalize(vec3(R.x, R.y * 0.4, R.z)), normalize(vec3(sunDir.x, sunDir.y * 0.4, sunDir.z))), 0.0), 3.5);
          skyGrad += uSunColor * sunAzimuthGlow * (0.42 * (1.0 - uNightFactor * 0.6));

          // 3. 丸の内高層ビル群＆東京駅赤レンガ駅舎のシルエット＆アンチエイリアス窓明かり反射
          // Why not: worldPos.z の周期サイン波で窓柱を作ると路面上に等間隔の横縞模様が現れるため、
          // 視線反射ベクトル R の方位角と仰角のみに基づく環境反射として評価する
          float lateralAngle = abs(R.x) / (abs(R.z) + 0.45);
          float buildingHeightMask = smoothstep(0.36, 0.10, R.y) * smoothstep(0.25, 0.65, lateralAngle);
          vec3 buildingFacadeColor = mix(vec3(0.08, 0.11, 0.18), vec3(0.02, 0.04, 0.08), uNightFactor);

          float floorBands = smoothstep(0.35, 0.78, sin(R.y * 28.0) * 0.5 + 0.5);
          float bayPillars = smoothstep(0.30, 0.75, sin(atan(R.x, R.z) * 18.0) * 0.5 + 0.5);
          float windowGlowMask = floorBands * bayPillars * smoothstep(0.02, 0.26, R.y);
          float windowLightStrength = mix(0.18, 0.65, max(uNightFactor, uRainWetness * 0.55));
          vec3 windowColor = mix(vec3(1.0, 0.78, 0.45), vec3(0.45, 0.80, 1.0), clamp(R.z * 0.5 + 0.5, 0.0, 1.0));
          vec3 cityReflection = buildingFacadeColor + windowColor * windowGlowMask * windowLightStrength;

          vec3 envColor = mix(skyGrad, cityReflection, buildingHeightMask * 0.68);

          // 4. 街灯（アンバー）＆都市ネオンの滑らかな水面反射グロー
          float lampLateral = exp(-abs(abs(worldPos.x) - 13.5) * 0.12);
          float lampDirGlow = smoothstep(0.15, 0.75, abs(R.x));
          float rippleDistort = (N.x + N.z) * 3.5;
          float streetLampStreak = lampLateral * lampDirGlow * clamp(1.0 + rippleDistort, 0.5, 1.6);
          vec3 lampGlowColor = vec3(1.0, 0.72, 0.32) * streetLampStreak * mix(0.22, 0.85, max(uNightFactor, uRainWetness * 0.60));

          envColor += lampGlowColor;

          // 5. 太陽・月光のデュアルローブ水面スペキュラ
          float sunSpecCore = pow(max(dot(R, sunDir), 0.0), 80.0);
          float sunSpecGlitter = pow(max(dot(R, sunDir), 0.0), 16.0);
          vec3 sunSpecular = uSunColor * (sunSpecCore * 1.8 + sunSpecGlitter * 0.42) * (1.0 - uNightFactor * 0.5);

          // 6. 波紋リングの繊細なハイライト（雨天時のみ波紋エッジが輝く）
          float rippleTilt = length(N.xz);
          vec3 rippleEdgeSparkle = mix(uSkyHorizonColor, vec3(0.88, 0.95, 1.0), 0.5) * smoothstep(0.05, 0.24, rippleTilt) * (0.35 * clamp(uRippleIntensity, 0.0, 1.0));

          // 水深に応じた水色吸収とフレネル合成
          vec3 waterTint = vec3(0.03, 0.05, 0.08);
          vec3 reflectedRadiance = (envColor + sunSpecular + rippleEdgeSparkle) * mix(0.45, 0.95, fresnel);
          return mix(waterTint, reflectedRadiance, clamp(fresnel + 0.32, 0.0, 1.0)) * (0.7 + 0.3 * puddleDepth);
        }
        `,
      );

      // 3D ボリュームテクスチャによる石畳・アスファルト微細粒子変調（マルチスケール・非共役回転でリピート模様を防止）
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        vec3 stoneCoordFine = vWorldPosition * 0.36;
        vec3 stoneCoordMacro = vec3(
          vWorldPosition.x * 0.068 - vWorldPosition.z * 0.043,
          vWorldPosition.y * 0.08 + 0.29,
          vWorldPosition.x * 0.043 + vWorldPosition.z * 0.068
        );
        vec4 stoneVolFine = texture(uRoadVolumeTex, stoneCoordFine);
        vec4 stoneVolMacro = texture(uRoadVolumeTex, stoneCoordMacro);
        float stoneGrain = mix(stoneVolFine.r, stoneVolMacro.r, 0.4);
        diffuseColor.rgb *= mix(0.93, 1.07, stoneGrain);
        `,
      );

      // 法線マップ適用部: リップルによる水面法線の変調
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>

        if (uRainWetness > 0.01) {
          float pMap = samplePuddleBasin(vWorldPosition.xz);
          float effectiveThreshold = uPuddleThreshold - uRainWetness * 0.08;
          float isPuddleArea = smoothstep(effectiveThreshold, effectiveThreshold + 0.10, pMap) * smoothstep(0.0, 0.35, uRainWetness);

          if (isPuddleArea > 0.02) {
            // 水たまり内での雨滴リップル＋微風さざ波法線を適用
            vec3 rippleN = calculateRainRipples(vWorldPosition.xz, uTime, uRainWetness * uRippleIntensity);

            // 法線マトリックス変換してサーフェス法線とブレンド（水面は平坦化してリップルのみを強調）
            vec3 perturbedN = vec3(rippleN.x, rippleN.z, rippleN.y);
            normal = normalize(mix(normal, normalize(mat3(viewMatrix) * perturbedN), isPuddleArea * 0.92));
          }
        }
        `,
      );

      // カラー・粗さ・メタルネス・解析的鏡面反射変調部: 水深・濡れ縁・鏡面化
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        /* glsl */ `
        #include <metalnessmap_fragment>

        if (uRainWetness > 0.01) {
          float pNoise = samplePuddleBasin(vWorldPosition.xz);
          float effectiveThreshold = uPuddleThreshold - uRainWetness * 0.08;

          // 濡れ縁（水たまり周囲のアスファルト・石畳浸透湿潤帯）
          float wetEdge = smoothstep(effectiveThreshold - 0.16, effectiveThreshold, pNoise);
          // 水たまり本体（浅瀬〜深部）
          float puddleCore = smoothstep(effectiveThreshold, effectiveThreshold + 0.07, pNoise) * smoothstep(0.0, 0.35, uRainWetness);
          // 水際メニスカスリング（表面張力による境界の濃い縁取り）
          float meniscusRing = wetEdge * (1.0 - puddleCore);

          // 1. カラー変調: 濡れ縁で石材・アスファルトが濃く暗くなり、水たまり内部は下地を減衰させて鏡面反射を主役にする
          float darkeningFactor = mix(1.0, 0.38, wetEdge * clamp(uRainWetness * 1.2, 0.0, 1.0));
          diffuseColor.rgb *= darkeningFactor;
          diffuseColor.rgb *= mix(1.0, 0.22, puddleCore);
          diffuseColor.rgb *= (1.0 - meniscusRing * 0.25);

          // 2. 粗さ (Roughness): 水たまり内部はほぼ完全な鏡面 (0.02)
          float dryRoughness = roughnessFactor;
          float wetAsphaltRoughness = mix(dryRoughness, 0.24, uRainWetness);
          roughnessFactor = mix(wetAsphaltRoughness, 0.02, puddleCore);

          // 3. メタルネス (Metalness / Reflectivity): フレネル鏡面反射を強化
          metalnessFactor = mix(metalnessFactor, 0.78, puddleCore * 0.9);

          // 4. 解析的平面鏡面反射: 空・太陽・都市ビル群・街灯ネオンの映り込みを加算
          if (puddleCore > 0.01) {
            vec3 rippleLocalN = calculateRainRipples(vWorldPosition.xz, uTime, uRainWetness * uRippleIntensity);
            vec3 puddleWorldN = normalize(vec3(rippleLocalN.x * 0.65, rippleLocalN.z, rippleLocalN.y * 0.65));
            vec3 puddleEnvReflection = calculatePuddleEnvReflection(vWorldPosition, puddleWorldN, puddleCore);
            totalEmissiveRadiance += puddleEnvReflection * puddleCore;
          }
        }
        `,
      );
    };
  }

  /**
   * 天候・太陽・空色・波紋強度を水たまりマテリアルへ一括同期する。
   * How: WeatherSystem から取得した環境光をユニフォームへ反映し、水たまりの鏡面反射色をリアルタイム更新する。
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

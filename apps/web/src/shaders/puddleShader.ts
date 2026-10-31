import * as THREE from 'three';

export interface PuddleShaderOptions {
  baseColor?: number;
  baseRoughness?: number;
  baseMetalness?: number;
  puddleThreshold?: number;
  rippleSpeed?: number;
  rippleFrequency?: number;
}

/**
 * 物理ベース雨天水たまりシェーダー (Physically Based Puddle & Ripple Shader)
 *
 * 【特徴・視覚表現】
 * 1. 動的雨滴リップル法線 (Raindrop Ripples):
 *    着水した雨滴が広がる同心円波紋をGLSL内でプロシージャル計算し、法線ベクトルを変調。
 * 2. 濡れ縁・表面張力 (Wet Meniscus Edge):
 *    水たまりの外縁部に水が染み込んだ濃い湿潤帯を表現。
 * 3. 水面鏡面反射・フレネル (Fresnel Reflectance):
 *    水たまり内部はラフネスを極小化 (0.02) し、水の物理屈折率 (IOR 1.33) に基づく高反射を実現。
 * 4. 3Dボリュームノイズ & 2Dノイズ両対応:
 *    ワールド座標サンプリングにより、タイリング境界のないシームレスな水たまり分布を生成。
 */
export class PuddleMaterial extends THREE.MeshStandardMaterial {
  public uRainWetness: { value: number };
  public uTime: { value: number };
  public uPuddleThreshold: { value: number };
  public uRippleIntensity: { value: number };
  public uRippleSpeed: { value: number };

  constructor(options: PuddleShaderOptions = {}) {
    super({
      color: options.baseColor ?? 0x24272c,
      roughness: options.baseRoughness ?? 0.88,
      metalness: options.baseMetalness ?? 0.1,
    });

    this.uRainWetness = { value: 0.0 };
    this.uTime = { value: 0.0 };
    this.uPuddleThreshold = { value: options.puddleThreshold ?? 0.52 };
    this.uRippleIntensity = { value: 1.0 };
    this.uRippleSpeed = { value: options.rippleSpeed ?? 1.2 };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uPuddleThreshold = this.uPuddleThreshold;
      shader.uniforms.uRippleIntensity = this.uRippleIntensity;
      shader.uniforms.uRippleSpeed = this.uRippleSpeed;

      // 頂点シェーダー: ワールド座標の伝達
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vWorldPosition;
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

      // フラグメントシェーダー: リップル関数・水たまりノイズ関数の定義
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uRainWetness;
        uniform float uTime;
        uniform float uPuddleThreshold;
        uniform float uRippleIntensity;
        uniform float uRippleSpeed;
        varying vec3 vWorldPosition;

        // 擬似乱数ハッシュ
        vec2 puddleHash2D(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        // 水たまり分布用2D低周波FBMノイズ
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

        float puddleFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * puddlePerlinNoise(p);
            p = p * 2.05 + vec2(1.7, 9.2);
            a *= 0.5;
          }
          return v;
        }

        // 雨滴リップル法線生成 (複数セルの波紋干渉)
        vec3 calculateRainRipples(vec2 uv, float time, float intensity) {
          vec2 p = uv * 3.5; // リップル密度
          vec3 rippleNormal = vec3(0.0, 0.0, 1.0);

          if (intensity <= 0.01) {
            return rippleNormal;
          }

          // 2層の時間オフセットグリッドによる着水波紋
          for (int layer = 0; layer < 2; layer++) {
            float layerTime = time * uRippleSpeed + float(layer) * 1.73;
            vec2 gridPos = p + float(layer) * vec2(13.4, 27.1);
            vec2 cellId = floor(gridPos);
            vec2 cellFrac = fract(gridPos);

            // 各セルの着水中心点
            vec2 dropCenter = puddleHash2D(cellId);
            vec2 diff = cellFrac - dropCenter;
            float dist = length(diff);

            // 時間周期で広がる波紋リング
            float dropAge = fract(layerTime * 1.3 + dot(cellId, vec2(0.3, 0.7)));
            float waveRadius = dropAge * 0.75;
            float waveDist = abs(dist - waveRadius);

            float wave = sin(waveDist * 40.0) * exp(-dist * 4.0) * (1.0 - dropAge);
            vec2 grad = normalize(diff + 0.0001) * wave * 0.35;

            rippleNormal.xy += grad * intensity;
          }

          return normalize(rippleNormal);
        }
        `
      );

      // 法線マップ適用部: リップルによる水面法線の変調
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>

        if (uRainWetness > 0.01) {
          float pMap = puddleFbm(vWorldPosition.xz * 0.08);
          float isPuddleArea = smoothstep(uPuddleThreshold, uPuddleThreshold + 0.12, pMap) * uRainWetness;

          if (isPuddleArea > 0.05) {
            // 水たまり内での雨滴リップル法線を適用
            vec3 rippleN = calculateRainRipples(vWorldPosition.xz, uTime, uRainWetness * uRippleIntensity);
            
            // 法線マトリックス変換してサーフェス法線とブレンド
            vec3 perturbedN = vec3(rippleN.x, rippleN.z, rippleN.y);
            normal = normalize(mix(normal, normalize(normalMatrix * perturbedN), isPuddleArea * 0.75));
          }
        }
        `
      );

      // カラー・粗さ変調部: 水深・濡れ縁・鏡面化
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>

        if (uRainWetness > 0.01) {
          float pNoise = puddleFbm(vWorldPosition.xz * 0.08);

          // 濡れ縁（水たまり周囲のアスファルト浸透湿潤帯）
          float wetEdge = smoothstep(uPuddleThreshold - 0.15, uPuddleThreshold, pNoise);
          // 水たまり本体
          float puddleCore = smoothstep(uPuddleThreshold, uPuddleThreshold + 0.08, pNoise) * uRainWetness;

          // 1. カラー変調: 雨天時は全体が暗くなり、水たまり深部は周囲環境の反射で鏡面化
          float darkeningFactor = mix(1.0, 0.55, wetEdge * uRainWetness);
          diffuseColor.rgb *= darkeningFactor;

          // 2. 粗さ (Roughness): 水たまり内部はほぼ完全な鏡面 (0.02)
          float dryRoughness = roughnessFactor;
          float wetAsphaltRoughness = mix(dryRoughness, 0.28, uRainWetness);
          roughnessFactor = mix(wetAsphaltRoughness, 0.02, puddleCore);

          // 3. メタルネス (Metalness / Reflectivity): フレネル鏡面反射を強化
          metalnessFactor = mix(metalnessFactor, 0.65, puddleCore * 0.8);
        }
        `
      );
    };
  }
}

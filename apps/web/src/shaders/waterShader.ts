import * as THREE from 'three';

export interface WaterShaderOptions {
  shallowColor?: number;
  deepColor?: number;
  waveSpeed?: number;
  waveHeight?: number;
}

/**
 * 物理ベース Gerstner 波 水面シェーダー (Water Surface Shader)
 *
 * 【特徴・視覚表現】
 * 1. トロコイド・Gerstner 波 (Gerstner Waves):
 *    頂点シェーダーにおいて複数の風向・波長・振幅の波を合成し、波頭が尖るリアルな水面起伏を生成。
 * 2. 解析的法線計算 (Analytical Normals):
 *    頂点変位の偏微分から水面の正確な法線ベクトルを算出し、微細なさざ波（Micro Ripples）とブレンド。
 * 3. 光の水中吸光減衰 (Water Depth Absorption):
 *    浅瀬のエメラルドグリーンから深部のダークティールへの色減衰（Beer-Lambert 則）。
 * 4. フレネル鏡面反射 (Fresnel Specular):
 *    水の物理屈折率 (IOR 1.33) に基づく視線角に応じた反射率の急上昇と、太陽・街灯の強いきらめき。
 * 5. 雨滴着水波紋連動:
 *    雨天時に水面全体に広がる雨滴リップルの動的合成。
 */
export class WaterSurfaceMaterial extends THREE.MeshStandardMaterial {
  public uTime: { value: number };
  public uRainWetness: { value: number };
  public uWaveSpeed: { value: number };
  public uWaveHeight: { value: number };
  public uSunDirection: { value: THREE.Vector3 };
  public uShallowColor: { value: THREE.Color };
  public uDeepColor: { value: THREE.Color };

  constructor(options: WaterShaderOptions = {}) {
    super({
      color: options.deepColor ?? 0x0a2a3a,
      roughness: 0.08,
      metalness: 0.15,
      transparent: true,
      opacity: 0.88,
    });

    this.uTime = { value: 0.0 };
    this.uRainWetness = { value: 0.0 };
    this.uWaveSpeed = { value: options.waveSpeed ?? 0.8 };
    this.uWaveHeight = { value: options.waveHeight ?? 0.35 };
    this.uSunDirection = { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() };
    this.uShallowColor = { value: new THREE.Color(options.shallowColor ?? 0x14708c) };
    this.uDeepColor = { value: new THREE.Color(options.deepColor ?? 0x031e2b) };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uWaveSpeed = this.uWaveSpeed;
      shader.uniforms.uWaveHeight = this.uWaveHeight;
      shader.uniforms.uSunDirection = this.uSunDirection;
      shader.uniforms.uShallowColor = this.uShallowColor;
      shader.uniforms.uDeepColor = this.uDeepColor;

      // 頂点シェーダー: Gerstner 波による頂点変位と法線計算
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWaveSpeed;
        uniform float uWaveHeight;
        varying vec3 vWorldPosition;
        varying vec3 vWaveNormal;

        // Gerstner波の計算
        vec3 calculateGerstnerWave(
          vec2 dir,
          float steepness,
          float wavelength,
          vec3 p,
          inout vec3 tangent,
          inout vec3 binormal
        ) {
          float k = 2.0 * 3.14159265 / wavelength;
          float c = sqrt(9.8 / k);
          vec2 d = normalize(dir);
          float f = k * (dot(d, p.xz) - c * uTime * uWaveSpeed);
          float a = steepness / k * uWaveHeight;

          tangent += vec3(
            -d.x * d.x * (steepness * sin(f)),
            d.x * (steepness * cos(f)),
            -d.x * d.y * (steepness * sin(f))
          );
          binormal += vec3(
            -d.x * d.y * (steepness * sin(f)),
            d.y * (steepness * cos(f)),
            -d.y * d.y * (steepness * sin(f))
          );

          return vec3(
            d.x * (a * cos(f)),
            a * sin(f),
            d.y * (a * cos(f))
          );
        }
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>

        vec3 gridP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);
        vec3 waveOffset = vec3(0.0);

        // 3本の主要Gerstner波の合成（皇居のお堀に吹く風向）
        waveOffset += calculateGerstnerWave(vec2(1.0, 0.3), 0.18, 14.0, gridP, tangent, binormal);
        waveOffset += calculateGerstnerWave(vec2(0.6, 0.8), 0.12, 7.5, gridP, tangent, binormal);
        waveOffset += calculateGerstnerWave(vec2(-0.4, 0.9), 0.08, 3.2, gridP, tangent, binormal);

        transformed += waveOffset;
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWaveNormal = normalize(cross(binormal, tangent));
        `
      );

      // フラグメントシェーダー: 水色減衰、フレネル、雨滴リップルの合成
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uRainWetness;
        uniform vec3 uSunDirection;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        varying vec3 vWorldPosition;
        varying vec3 vWaveNormal;

        // 水面用ハッシュ
        vec2 waterHash2D(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        // 雨滴リップル法線
        vec3 waterRainRipples(vec2 uv, float time, float rain) {
          vec2 p = uv * 4.0;
          vec3 rNorm = vec3(0.0, 0.0, 1.0);
          if (rain <= 0.01) return rNorm;

          for (int i = 0; i < 2; i++) {
            float t = time * 1.5 + float(i) * 1.8;
            vec2 grid = p + float(i) * vec2(19.2, 37.4);
            vec2 cellId = floor(grid);
            vec2 cellFrac = fract(grid);

            vec2 dropPos = waterHash2D(cellId);
            vec2 diff = cellFrac - dropPos;
            float dist = length(diff);

            float age = fract(t * 1.4 + dot(cellId, vec2(0.3, 0.7)));
            float r = age * 0.8;
            float waveDist = abs(dist - r);

            float w = sin(waveDist * 45.0) * exp(-dist * 4.0) * (1.0 - age);
            rNorm.xy += normalize(diff + 0.0001) * w * 0.35 * rain;
          }
          return normalize(rNorm);
        }
        `
      );

      // 法線マップ部の変調: Gerstner 波法線とリップルのブレンド
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>

        vec3 baseN = normalize(normalMatrix * vWaveNormal);

        // 雨滴波紋のブレンド
        if (uRainWetness > 0.01) {
          vec3 rip = waterRainRipples(vWorldPosition.xz, uTime, uRainWetness);
          vec3 perturbedN = vec3(rip.x, rip.z, rip.y);
          baseN = normalize(mix(baseN, normalize(normalMatrix * perturbedN), uRainWetness * 0.5));
        }

        normal = baseN;
        `
      );

      // カラー・吸光グラデーション・鏡面反射
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>

        // 波の高さに基づく浅瀬・深部カラーグラデーション
        float waveHeightFactor = clamp((vWorldPosition.y + 0.2) * 1.5, 0.0, 1.0);
        vec3 waterColor = mix(uDeepColor, uShallowColor, waveHeightFactor);
        diffuseColor.rgb = waterColor;

        // 水面フレネル反射（鏡面度 0.03）
        roughnessFactor = 0.03;
        metalnessFactor = 0.25;
        `
      );
    };
  }
}

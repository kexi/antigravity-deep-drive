import * as THREE from "three";

/**
 * 雨天濡れ路面・水たまりシェーダー
 * - 雨量に応じてアスファルトのRoughness（粗さ）が低下
 * - アスファルトの微細凹凸に水たまり（Puddle）が発生し鏡面反射
 */

export interface WetRoadMaterialOptions {
  color?: number;
  roughness?: number;
  metalness?: number;
}

export class WetRoadMaterial extends THREE.MeshStandardMaterial {
  public uRainWetness: { value: number };
  public uTime: { value: number };

  constructor(options: WetRoadMaterialOptions = {}) {
    super({
      color: options.color ?? 0x222428,
      roughness: options.roughness ?? 0.85,
      metalness: options.metalness ?? 0.1,
      roughnessMap: null,
    });

    this.uRainWetness = { value: 0.0 };
    this.uTime = { value: 0.0 };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uTime = this.uTime;

      // 頂点シェーダーでワールド座標をフラグメントへ渡す
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vWorldPos;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

      // フラグメントシェーダーで水たまりと粗さを変調
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uRainWetness;
        uniform float uTime;
        varying vec3 vWorldPos;

        // ノイズ関数による水たまりパターン
        float puddleNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453;
          float b = sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453;
          float c = sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453;
          float d = sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453;
          return mix(mix(fract(a), fract(b), f.x), mix(fract(c), fract(d), f.x), f.y);
        }
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
        #include <roughnessmap_fragment>
        
        if (uRainWetness > 0.01) {
          // 水たまりマスク
          float noise = puddleNoise(vWorldPos.xz * 0.15);
          float isPuddle = smoothstep(0.4, 0.6, noise) * uRainWetness;

          // 雨が降るとアスファルト全体が濃く濡れ、水たまり部分は鏡面化
          diffuseColor.rgb *= mix(1.0, 0.65, uRainWetness * 0.8);
          roughnessFactor = mix(roughnessFactor, 0.08, isPuddle);
          roughnessFactor = mix(roughnessFactor, 0.35, uRainWetness * (1.0 - isPuddle));
          metalnessFactor = mix(metalnessFactor, 0.4, isPuddle * 0.7);
        }
        `,
      );
    };
  }
}

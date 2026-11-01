import * as THREE from "three";

export interface SkyOptions {
  zenithColor?: number;
  horizonColor?: number;
  sunColor?: number;
  cloudColor?: number;
  sunPosition?: THREE.Vector3;
  cloudDensity?: number;
  cloudSpeed?: number;
  starsIntensity?: number;
}

/**
 * 物理ベース大気散乱・プロシージャル雲・星空 空シェーダー (Atmospheric Dynamic Sky Shader)
 *
 * 【特徴・技術仕様】
 * 1. レイリー散乱・地平線大気減衰 (Rayleigh Scattering & Horizon Extinction):
 *    天頂（ディープブルー）から地平線（温かなヘイズ）への滑らかなグラデーション。
 * 2. ミー散乱太陽ディスク & コロナ光冠 (Mie Scattering Sun Disk & Aureole):
 *    太陽方向への強烈な前方散乱と、リアルなサイズを持つ太陽ディスク。
 * 3. プロシージャル動的雲 (Procedural Volumetric FBM Clouds):
 *    高度1000mの仮想雲層における3オクターブフラクタルノイズによる動的雲流。
 *    太陽光透過（シルバーライニング）と夕焼け時の茜色染まりを再現。
 * 4. 夜間恒星瞬き (Procedural Night Stars & Twinkling):
 *    夜間モード時にプロシージャルに配置される微細な恒星群と瞬き表現。
 * 5. 天候システム・YAMLプリセット連動:
 *    晴天・夕暮れ・雨天・夜間のパラメータ動的補間。
 */
export class AtmosphericSky {
  public mesh: THREE.Mesh;
  public material: THREE.ShaderMaterial;

  constructor(options: SkyOptions = {}) {
    const uniforms = {
      uZenithColor: { value: new THREE.Color(options.zenithColor ?? 0x0284c7) },
      uHorizonColor: { value: new THREE.Color(options.horizonColor ?? 0xbae6fd) },
      uSunColor: { value: new THREE.Color(options.sunColor ?? 0xfffaed) },
      uCloudColor: { value: new THREE.Color(options.cloudColor ?? 0xffffff) },
      uSunPosition: {
        value: options.sunPosition
          ? options.sunPosition.clone().normalize()
          : new THREE.Vector3(0.5, 0.6, -0.6).normalize(),
      },
      uCloudDensity: { value: options.cloudDensity ?? 0.35 },
      uCloudSpeed: { value: options.cloudSpeed ?? 0.02 },
      uStarsIntensity: { value: options.starsIntensity ?? 0.0 },
      uTime: { value: 0.0 },
    };

    const vertexShader = /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;

    const fragmentShader = /* glsl */ `
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunColor;
      uniform vec3 uCloudColor;
      uniform vec3 uSunPosition;
      uniform float uCloudDensity;
      uniform float uCloudSpeed;
      uniform float uStarsIntensity;
      uniform float uTime;

      varying vec3 vWorldPosition;

      // 疑似ランダムハッシュ関数
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      // 2Dバリューノイズ
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));

        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // 3オクターブ フラクタル・ブラウン運動 (FBM)
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
        for (int i = 0; i < 3; i++) {
          v += a * noise(p);
          p = rot * p * 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 rayDir = normalize(vWorldPosition);
        float elevation = clamp(rayDir.y, 0.0, 1.0);

        // 1. レイリー散乱グラデーション (大気ヘイズ)
        float horizonFade = pow(1.0 - elevation, 2.5);
        vec3 skyColor = mix(uZenithColor, uHorizonColor, horizonFade);

        // 2. 太陽ディスク & ミー散乱コロナ
        float cosTheta = dot(rayDir, normalize(uSunPosition));
        // 太陽の周りの大気ハロー
        float sunAureole = pow(max(0.0, cosTheta), 8.0) * 0.45;
        float sunGlow = pow(max(0.0, cosTheta), 64.0) * 1.5;
        // シャープな太陽ディスク
        float sunDisk = smoothstep(0.9993, 0.9997, cosTheta);
        vec3 sunContribution = uSunColor * (sunAureole + sunGlow + sunDisk * 4.0);
        skyColor += sunContribution;

        // 3. プロシージャル動的雲 (雲平面マッピング)
        if (rayDir.y > 0.02 && uCloudDensity > 0.01) {
          // 仮想雲層平面 (y = 1000m) との交差座標
          float planeDist = 1.0 / max(0.02, rayDir.y);
          vec2 cloudUv = (rayDir.xz * planeDist) * 0.0008;
          // 風による流動
          vec2 windOffset = vec2(uTime * uCloudSpeed * 0.5, uTime * uCloudSpeed * 0.2);
          cloudUv += windOffset;

          float cloudPattern = fbm(cloudUv * 3.5);
          float cloudDensityFactor = smoothstep(1.0 - uCloudDensity, 1.0 - uCloudDensity + 0.35, cloudPattern);

          // 雲の太陽前方散乱 (Silver Lining)
          float cloudSunFacing = max(0.0, cosTheta);
          vec3 cloudHighlight = mix(uCloudColor, uSunColor, pow(cloudSunFacing, 3.0) * 0.8);
          // 雲底の影
          vec3 finalCloudColor = mix(cloudHighlight * 0.65, cloudHighlight, cloudPattern);

          // 雲の透過度ブレンド (地平線付近はソフトフェード)
          float cloudAlpha = cloudDensityFactor * smoothstep(0.02, 0.18, rayDir.y);
          skyColor = mix(skyColor, finalCloudColor, cloudAlpha);
        }

        // 4. 夜間恒星 (Stars & Twinkling)
        if (uStarsIntensity > 0.01 && rayDir.y > 0.05) {
          vec2 starUv = rayDir.xz / (rayDir.y + 0.1) * 35.0;
          float starNoise = hash(floor(starUv));
          if (starNoise > 0.985) {
            float twinkle = sin(uTime * 4.0 + starNoise * 6.28) * 0.4 + 0.6;
            float starCenter = length(fract(starUv) - 0.5);
            float starGlow = smoothstep(0.12, 0.0, starCenter);
            vec3 starColor = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.8, 0.6), hash(floor(starUv) + 1.0));
            skyColor += starColor * starGlow * twinkle * uStarsIntensity * smoothstep(0.05, 0.2, rayDir.y);
          }
        }

        gl_FragColor = vec4(skyColor, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false, // 最奥描画のため深度バッファを汚染しない
      depthTest: true,
    });

    // スカイドーム用球体ジオメトリ
    const geometry = new THREE.SphereGeometry(900, 32, 16);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "AtmosphericSkyDome";
  }

  public update(time: number, cameraPos: THREE.Vector3): void {
    this.material.uniforms.uTime.value = time;
    this.mesh.position.copy(cameraPos);
  }

  public setSunPosition(pos: THREE.Vector3): void {
    this.material.uniforms.uSunPosition.value.copy(pos).normalize();
  }

  public setParams(params: {
    zenithColor?: number;
    horizonColor?: number;
    sunColor?: number;
    cloudColor?: number;
    cloudDensity?: number;
    cloudSpeed?: number;
    starsIntensity?: number;
  }): void {
    const hasZenith = params.zenithColor !== undefined;
    if (hasZenith) {
      this.material.uniforms.uZenithColor.value.setHex(params.zenithColor!);
    }

    const hasHorizon = params.horizonColor !== undefined;
    if (hasHorizon) {
      this.material.uniforms.uHorizonColor.value.setHex(params.horizonColor!);
    }

    const hasSunColor = params.sunColor !== undefined;
    if (hasSunColor) {
      this.material.uniforms.uSunColor.value.setHex(params.sunColor!);
    }

    const hasCloudColor = params.cloudColor !== undefined;
    if (hasCloudColor) {
      this.material.uniforms.uCloudColor.value.setHex(params.cloudColor!);
    }

    const hasCloudDensity = params.cloudDensity !== undefined;
    if (hasCloudDensity) {
      this.material.uniforms.uCloudDensity.value = params.cloudDensity!;
    }

    const hasCloudSpeed = params.cloudSpeed !== undefined;
    if (hasCloudSpeed) {
      this.material.uniforms.uCloudSpeed.value = params.cloudSpeed!;
    }

    const hasStars = params.starsIntensity !== undefined;
    if (hasStars) {
      this.material.uniforms.uStarsIntensity.value = params.starsIntensity!;
    }
  }
}

import * as THREE from 'three';

/**
 * フロントガラス・雨滴・ワイパー払拭シミュレーション用 PBR ガラスシェーダー
 *
 * 【視覚表現・アルゴリズム】
 * 1. 3層スケール雨滴 (Multi-scale Droplets):
 *    - 静止微小水滴 (Micro Mist / Condensation): ガラス全体にびっしりと付着する細かな霧状滴
 *    - 動的滑落水滴 (Sliding / Streaking Drops): 重力と走行風圧によって不規則に蛇行落下する水滴
 *    - 水滴トレイル (Droplet Trail): 滑落した水滴の背後に残る細い雨筋と小滴の破片
 * 2. 物理屈折・凸レンズ効果 (Lens Refraction & Caustics):
 *    - 水滴表面の法線による光の屈折歪みとハイライト（きらめき）
 * 3. 走行風圧ベクトル (Aerodynamic Wind Drag):
 *    - 車速 uSpeed に応じて水滴の滑落方向が真下から斜め上・外側へと変化
 * 4. ワイパー払拭と水堤 (Wiper Blade Clearing & Water Ridge):
 *    - ワイパー可動域内の水滴クリアリングと、ブレード折り返しエッジに溜まる水滴の縁（Ridge）
 */

export interface WindshieldUniforms {
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uRainIntensity: { value: number };
  uSpeed: { value: number };
  uWiperAngle1: { value: number };
  uWiperAngle2: { value: number };
  uWiperClearing: { value: number };
  uEnvMap: { value: THREE.Texture | null };
}

export function createWindshieldMaterial(): THREE.ShaderMaterial {
  const uniforms: WindshieldUniforms = {
    uTime: { value: 0.0 },
    uRainIntensity: { value: 0.0 },
    uSpeed: { value: 0.0 },
    uWiperAngle1: { value: 0.0 },
    uWiperAngle2: { value: 0.0 },
    uWiperClearing: { value: 1.0 },
    uEnvMap: { value: null },
  };

  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewPosition;

    void main() {
      vUv = uv;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uRainIntensity;
    uniform float uSpeed;
    uniform float uWiperAngle1;
    uniform float uWiperAngle2;
    uniform float uWiperClearing;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewPosition;

    // 擬似乱数ハッシュ
    vec2 hash22(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.xx + p3.yz) * p3.zy);
    }

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    // 1. 静止微小水滴層 (Micro Condensation Layer)
    vec3 calculateStaticMist(vec2 uv, float intensity) {
      vec2 grid = uv * vec2(110.0, 55.0);
      vec2 id = floor(grid);
      vec2 gv = fract(grid) - 0.5;

      vec2 rand = hash22(id);
      float isDropPresent = step(0.35, rand.x) * intensity;
      
      float radius = 0.22 * (0.4 + 0.6 * rand.y);
      float dist = length(gv - (rand - 0.5) * 0.4);

      vec3 norm = vec3(0.0, 0.0, 1.0);
      if (dist < radius && isDropPresent > 0.0) {
        float h = sqrt(max(0.0, radius * radius - dist * dist));
        vec2 dir = normalize(gv - (rand - 0.5) * 0.4);
        norm.xy = dir * (h / radius) * 0.8;
        norm.z = 0.6;
        norm = normalize(norm);
      }
      return norm;
    }

    // 2. 動的滑落水滴 & トレイル層 (Sliding Drops & Streaks)
    vec3 calculateSlidingDrops(vec2 uv, float time, float speedFactor) {
      vec3 norm = vec3(0.0, 0.0, 1.0);

      // 車速に応じた風圧吹き上がりオフセット（斜め上・外側への流れ）
      vec2 flowDir = vec2(0.0, -1.0) + vec2((uv.x - 0.5) * speedFactor * 0.4, speedFactor * 0.8);
      
      vec2 grid = uv * vec2(36.0, 18.0);
      vec2 id = floor(grid);
      vec2 gv = fract(grid) - 0.5;

      float rand = hash21(id);
      
      // 不規則な落下タイミングとスピード
      float fallSpeed = (0.28 + rand * 0.45) + speedFactor * 1.2;
      float dropPhase = fract(time * fallSpeed + rand);

      // 蛇行する水滴の落下軌跡
      float wobble = sin(dropPhase * 25.0 + rand * 6.28) * 0.12;
      vec2 dropCenter = vec2((rand - 0.5) * 0.6 + wobble, dropPhase - 0.5);

      float dist = length(gv - dropCenter);
      float radius = 0.14 * (0.65 + rand * 0.35);

      // 主水滴の凸レンズ法線
      if (dist < radius) {
        float h = sqrt(max(0.0, radius * radius - dist * dist));
        vec2 dir = (gv - dropCenter) / radius;
        norm.xy = dir * (h / radius);
        norm.z = 0.45;
        norm = normalize(norm);
      }

      // 滑落水滴の後方に残る細い雨筋（トレイル）
      float trailWidth = 0.035;
      float isBehindDrop = step(dropCenter.y, gv.y);
      float trailDist = abs(gv.x - dropCenter.x);
      if (trailDist < trailWidth && isBehindDrop > 0.5) {
        float trailFactor = (1.0 - trailDist / trailWidth) * 0.35;
        norm.y += trailFactor * 0.6;
        norm = normalize(norm);
      }

      return norm;
    }

    // 3. ワイパーの扇形クリアリング & 水堤マスク計算
    float calculateWiperClearing(vec2 uv, vec2 pivot, float currentAngle, float bladeLength, out float wiperRidge) {
      vec2 d = uv - pivot;
      float dist = length(d);
      float angle = atan(d.y, d.x);

      // ブレード長内の可動領域
      float inRadius = step(0.08, dist) * step(dist, bladeLength);
      float angleDiff = abs(angle - currentAngle);

      // ブレード通過部のクリアリング
      float cleared = smoothstep(0.18, 0.02, angleDiff) * inRadius;

      // ワイパーブレードのエッジに溜まる水滴の縁（Water Ridge）
      wiperRidge = smoothstep(0.03, 0.0, abs(angleDiff - 0.18)) * inRadius * 0.8;

      return cleared;
    }

    void main() {
      // 運転席・助手席のワイパーピボット
      vec2 pivotDriver = vec2(0.32, 0.04);
      vec2 pivotPassenger = vec2(0.68, 0.04);

      float ridge1 = 0.0;
      float ridge2 = 0.0;
      float wipe1 = calculateWiperClearing(vUv, pivotDriver, uWiperAngle1, 0.78, ridge1);
      float wipe2 = calculateWiperClearing(vUv, pivotPassenger, uWiperAngle2, 0.72, ridge2);

      float totalWiped = clamp(wipe1 + wipe2, 0.0, 1.0);
      float totalRidge = clamp(ridge1 + ridge2, 0.0, 1.0);

      // ワイパーで拭かれた後の残存雨滴量（エッジには水が溜まる）
      float effectiveRain = uRainIntensity * (1.0 - totalWiped * uWiperClearing) + totalRidge * uRainIntensity * 0.6;
      effectiveRain = clamp(effectiveRain, 0.0, 1.5);

      vec3 viewDir = normalize(vViewPosition);
      vec3 normal = vWorldNormal;

      // 雨が降っている場合の水滴法線合成
      if (effectiveRain > 0.02) {
        float speedFactor = clamp(uSpeed * 0.025, 0.0, 2.0);

        // A. 静止微小水滴
        vec3 mistNorm = calculateStaticMist(vUv, effectiveRain);
        // B. 滑落する中・大粒水滴
        vec3 slidingNorm = calculateSlidingDrops(vUv, uTime, speedFactor);

        // 法線合成（凸レンズ屈折歪み）
        vec3 combinedDrops = normalize(mistNorm + slidingNorm);
        normal = normalize(normal + combinedDrops * effectiveRain * 0.65);
      }

      // フレネル反射率（水の屈折率 n=1.33、ガラス n=1.52）
      float fresnel = pow(1.0 - max(0.0, dot(viewDir, normal)), 3.2);

      // フロントガラス基本トーン（薄い青緑色の合わせガラス）
      vec4 glassBase = vec4(0.015, 0.035, 0.065, 0.12);

      // 水滴による空・街並みの屈折スペキュラハイライト
      float highlight = pow(max(0.0, normal.z), 24.0) * effectiveRain * 0.55;
      vec4 highlightColor = vec4(0.9, 0.95, 1.0, 1.0) * highlight;

      // 反射色
      vec4 reflectionColor = vec4(0.75, 0.88, 1.0, 1.0) * fresnel * 0.85;

      vec4 finalColor = glassBase + reflectionColor + highlightColor;
      finalColor.a = clamp(glassBase.a + fresnel * 0.25 + effectiveRain * 0.38, 0.10, 0.88);

      gl_FragColor = finalColor;
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return material;
}

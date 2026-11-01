import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";

export interface FoliageShaderOptions {
  baseColor?: number;
  tipColor?: number;
  autumnAccentColor?: number;
  roughness?: number;
  metalness?: number;
  windSpeed?: number;
  windStrength?: number;
  sssIntensity?: number;
  sunDirection?: THREE.Vector3;
  sunColor?: number;
  nightFactor?: number;
}

export interface TreeBarkShaderOptions {
  barkDarkColor?: number;
  barkLightColor?: number;
  mossColor?: number;
  roughness?: number;
  metalness?: number;
  windSpeed?: number;
  windStrength?: number;
  nightFactor?: number;
}

export interface TreeEnvironmentSyncParams {
  wetness: number;
  time: number;
  windSpeed?: number;
  windStrength?: number;
  sunDirection?: THREE.Vector3;
  sunColor?: THREE.Color | number;
  nightFactor?: number;
}

/**
 * 1枚1枚のイチョウの葉（細長い葉柄 + 扇形葉身 + 先端中央の二股切れ込み Biloba Notch）を
 * 実体3D曲面メッシュとしてロゼット（短枝輪生）状に配置した樹冠 BufferGeometry を生成する。
 *
 * Why not: IcosahedronGeometry などの球体塊を並べただけでは「黄色い雲・マリモの塊」にしか見えず、
 * イチョウ特有の扇形の葉っぱや二股切れ込みのシルエットが判別できないため。
 */
export function createGinkgoBilobaCanopyGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const goldenAngle = (137.508 * Math.PI) / 180.0;
  const canopyCenter = new THREE.Vector3(0.0, 5.0, 0.0);

  const addGinkgoFanLeaf3D = (
    origin: THREE.Vector3,
    forwardDir: THREE.Vector3,
    upHint: THREE.Vector3,
    leafLength: number,
    fanAngle: number,
    archBend: number,
    cupDepth: number,
  ): void => {
    const fwd = forwardDir.clone().normalize();
    const side = new THREE.Vector3().crossVectors(upHint, fwd);
    const isSideDegenerate = side.lengthSq() < 1e-6;
    if (isSideDegenerate) {
      side.crossVectors(new THREE.Vector3(0, 1, 0), fwd);
    }
    side.normalize();

    const up = new THREE.Vector3().crossVectors(fwd, side).normalize();
    const isPointingDown = up.y < 0.0;
    if (isPointingDown) {
      side.negate();
      up.negate();
    }

    const leafPoint = (
      uNorm: number,
      rFrac: number,
      widthScale: number,
      yOffset: number,
    ): THREE.Vector3 => {
      const theta = (uNorm - 0.5) * fanAngle * widthScale;
      const dist = rFrac * leafLength;
      const localX = dist * Math.cos(theta);
      const localZ = dist * Math.sin(theta);
      const archY = -archBend * leafLength * (rFrac * rFrac);
      const cupY = cupDepth * leafLength * (1.0 - 4.0 * (uNorm - 0.5) * (uNorm - 0.5)) * rFrac;

      return new THREE.Vector3()
        .copy(origin)
        .addScaledVector(fwd, localX)
        .addScaledVector(side, localZ)
        .addScaledVector(up, archY + cupY + yOffset);
    };

    const baseVertexIndex = positions.length / 3;

    const pushVert = (pt: THREE.Vector3, u: number, v: number): number => {
      const idx = positions.length / 3;
      positions.push(pt.x, pt.y, pt.z);
      const radial = new THREE.Vector3().subVectors(pt, canopyCenter).normalize();
      const blendedNormal = new THREE.Vector3()
        .copy(up)
        .multiplyScalar(0.86)
        .addScaledVector(radial, 0.14)
        .normalize();
      normals.push(blendedNormal.x, blendedNormal.y, blendedNormal.z);
      uvs.push(u, v);
      return idx;
    };

    // Row 0: 葉柄（Petiole）基部 (2頂点, v = 0.0)
    const s0 = pushVert(leafPoint(0.47, 0.0, 0.08, 0.0), 0.47, 0.0);
    const s1 = pushVert(leafPoint(0.53, 0.0, 0.08, 0.0), 0.53, 0.0);

    // Row 1: 葉柄から扇形葉身への移行部 (2頂点, v = 0.20)
    const n0 = pushVert(leafPoint(0.42, 0.2, 0.2, 0.003), 0.42, 0.2);
    const n1 = pushVert(leafPoint(0.58, 0.2, 0.2, 0.003), 0.58, 0.2);

    // Row 2: 扇形中間展開アーク (7頂点, v = 0.54)
    const mSpecs: ReadonlyArray<readonly [number, number, number, number]> = [
      [0.0, 0.46, 0.84, 0.005],
      [0.17, 0.53, 0.86, 0.002],
      [0.34, 0.56, 0.88, -0.002],
      [0.5, 0.48, 0.88, -0.007],
      [0.66, 0.56, 0.88, -0.002],
      [0.83, 0.53, 0.86, 0.002],
      [1.0, 0.46, 0.84, 0.005],
    ];
    const mIdxs: number[] = [];
    for (const [uVal, rVal, wSc, yOff] of mSpecs) {
      mIdxs.push(pushVert(leafPoint(uVal, rVal, wSc, yOff), uVal, 0.54));
    }

    // Row 3: 扇形外縁＋中央二股切れ込み (Biloba Notch at u=0.50, 7頂点)
    const oSpecs: ReadonlyArray<readonly [number, number, number, number, number]> = [
      [0.0, 0.8, 1.0, 0.006, 0.86],
      [0.17, 0.99, 0.97, 0.012, 0.98],
      [0.34, 1.03, 0.94, 0.008, 1.0],
      [0.5, 0.65, 0.9, -0.014, 0.68], // 中央の二股切れ込み (Biloba V-Notch)
      [0.66, 1.03, 0.94, 0.008, 1.0],
      [0.83, 0.99, 0.97, 0.012, 0.98],
      [1.0, 0.8, 1.0, 0.006, 0.86],
    ];
    const oIdxs: number[] = [];
    for (const [uVal, rVal, wSc, yOff, vUv] of oSpecs) {
      oIdxs.push(pushVert(leafPoint(uVal, rVal, wSc, yOff), uVal, vUv));
    }

    const pushQuad = (a: number, b: number, c: number, d: number): void => {
      indices.push(a, b, c, a, c, d);
    };

    // 1. 葉柄クアッド
    pushQuad(s0, n0, n1, s1);

    // 2. 葉柄先端から中間アークへの展開
    indices.push(n0, mIdxs[0], mIdxs[1]);
    pushQuad(n0, mIdxs[1], mIdxs[2], mIdxs[3]);
    indices.push(n0, mIdxs[3], n1);
    pushQuad(n1, mIdxs[3], mIdxs[4], mIdxs[5]);
    indices.push(n1, mIdxs[5], mIdxs[6]);

    // 3. 中間アークから二股外縁への放射状クアッド (6枚)
    for (let k = 0; k < 6; k++) {
      pushQuad(mIdxs[k], oIdxs[k], oIdxs[k + 1], mIdxs[k + 1]);
    }

    void baseVertexIndex;
  };

  const addSpurRosette = (
    spurCenter: THREE.Vector3,
    outwardNormal: THREE.Vector3,
    leafCount: number,
    baseLeafLen: number,
    seed: number,
  ): void => {
    const nDir = outwardNormal.clone().normalize();
    const isVertical = Math.abs(nDir.y) > 0.9;
    const refUp = isVertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangentX = new THREE.Vector3().crossVectors(nDir, refUp).normalize();
    const tangentZ = new THREE.Vector3().crossVectors(nDir, tangentX).normalize();

    for (let i = 0; i < leafCount; i++) {
      const azim = seed * 2.1 + i * goldenAngle;
      const ringT = (i + 0.5) / leafCount;
      const spreadCone = 0.34 + 0.64 * ringT;

      const radialTangent = new THREE.Vector3()
        .copy(tangentX)
        .multiplyScalar(Math.cos(azim))
        .addScaledVector(tangentZ, Math.sin(azim));

      const leafFwd = new THREE.Vector3()
        .copy(nDir)
        .multiplyScalar(Math.cos(spreadCone))
        .addScaledVector(radialTangent, Math.sin(spreadCone))
        .add(new THREE.Vector3(0, 0.18 - 0.26 * ringT, 0))
        .normalize();

      const rollAngle = 0.24 * Math.sin(seed * 3.7 + i * 1.9);
      const leafUp = new THREE.Vector3(0, 0.88, 0)
        .addScaledVector(nDir, 0.42)
        .addScaledVector(radialTangent, rollAngle)
        .normalize();

      const lenVar = baseLeafLen * (0.86 + (0.26 * ((i * 37 + Math.floor(seed * 13)) % 7)) / 6.0);
      const fanVar = 1.92 + 0.22 * Math.sin(seed + i * 1.3);
      const archVar = 0.13 + 0.08 * ringT;

      const stemPos = new THREE.Vector3()
        .copy(spurCenter)
        .addScaledVector(radialTangent, 0.008)
        .addScaledVector(nDir, 0.007 * (1.0 - ringT));

      addGinkgoFanLeaf3D(stemPos, leafFwd, leafUp, lenVar, fanVar, archVar, 0.04);
    }
  };

  // 樹冠を構成する多層クラスタ（各クラスタを実寸 8.8cm の 3D イチョウ扇形葉ロゼットで構成）
  const clusterZones = [
    { cx: 0.0, cy: 3.4, cz: 0.0, rxy: 1.45, ry: 0.85, rosettes: 10, seed: 0.5 },
    { cx: 1.05, cy: 3.7, cz: 0.45, rxy: 0.82, ry: 0.62, rosettes: 8, seed: 1.8 },
    { cx: -0.98, cy: 3.8, cz: 0.52, rxy: 0.82, ry: 0.62, rosettes: 8, seed: 3.1 },
    { cx: 0.12, cy: 3.75, cz: -1.08, rxy: 0.82, ry: 0.62, rosettes: 8, seed: 4.4 },
    { cx: -0.18, cy: 4.6, cz: 0.92, rxy: 0.86, ry: 0.68, rosettes: 8, seed: 5.7 },
    { cx: 0.88, cy: 4.7, cz: -0.68, rxy: 0.84, ry: 0.66, rosettes: 8, seed: 7.0 },
    { cx: -0.82, cy: 4.85, cz: -0.72, rxy: 0.84, ry: 0.66, rosettes: 8, seed: 8.3 },
    { cx: 0.0, cy: 5.2, cz: 0.0, rxy: 1.28, ry: 0.92, rosettes: 10, seed: 9.6 },
    { cx: 0.68, cy: 5.9, cz: 0.55, rxy: 0.74, ry: 0.62, rosettes: 6, seed: 10.9 },
    { cx: -0.65, cy: 6.0, cz: -0.48, rxy: 0.74, ry: 0.62, rosettes: 6, seed: 12.2 },
    { cx: 0.0, cy: 6.65, cz: 0.0, rxy: 0.95, ry: 0.78, rosettes: 8, seed: 13.5 },
    { cx: 0.0, cy: 7.65, cz: 0.0, rxy: 0.58, ry: 0.65, rosettes: 6, seed: 14.8 },
  ];

  for (const zone of clusterZones) {
    const center = new THREE.Vector3(zone.cx, zone.cy, zone.cz);
    for (let rIdx = 0; rIdx < zone.rosettes; rIdx++) {
      const t = (rIdx + 0.5) / zone.rosettes;
      const yNorm = Math.max(-0.9, Math.min(0.9, -0.52 + 1.4 * t));
      const xzProj = Math.sqrt(Math.max(0.08, 1.0 - yNorm * yNorm));
      const azim = zone.seed * 1.9 + rIdx * goldenAngle;

      const localDir = new THREE.Vector3(
        Math.cos(azim) * xzProj,
        yNorm,
        Math.sin(azim) * xzProj,
      ).normalize();

      const spurPos = new THREE.Vector3(
        center.x + localDir.x * zone.rxy * 0.58,
        center.y + localDir.y * zone.ry * 0.58,
        center.z + localDir.z * zone.rxy * 0.58,
      );
      addSpurRosette(spurPos, localDir, 7, 0.088, zone.seed * 3.1 + rIdx * 1.7);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 物理ベース イチョウ葉っぱシェーダー (Ginkgo Biloba Foliage & Subsurface Scattering Shader)
 *
 * 【特徴・視覚表現】
 * 1. 階層型風揺れ頂点アニメーション (Hierarchical Wind Sway & Leaf-Tip Flutter):
 *    主幹と同期した大域スウェイに加え、枝先の中周波揺れと、葉柄(`uv.y=0`)を支点として
 *    扇形葉先(`uv.y=1`)がはためく高周波フラッターを合成。
 * 2. 逆光サブサーフェス・スキャタリング (Translucent Backlight SSS):
 *    太陽方向 (`uSunDirection`) と視線ベクトルの前方散乱および葉の厚み勾配から、
 *    夕暮れや晴天の逆光でイチョウの黄金葉が鮮やかに透き通る透過光（Translucency）を再現。
 * 3. 実体3Dイチョウ扇形葉UVと完全連動した平行二叉脈・二股切れ込み陰影 (`sampleGinkgoVenation`):
 *    各3D扇形葉の正規化UV (`u=扇幅, v=葉柄0→葉先1`) に沿って放射状に広がる平行二叉脈、
 *    葉柄基部のオリーブ褐色、先端中央の二股ノッチ陰影、および葉1枚ごとの黄金〜琥珀色調差を表現。
 * 4. 葉脈マイクロバンプ法線摂動と雨天水膜スペキュラ・夜間街灯ウォームアップライト。
 */
export class GinkgoFoliageMaterial extends THREE.MeshStandardMaterial {
  public uTime: { value: number };
  public uRainWetness: { value: number };
  public uWindSpeed: { value: number };
  public uWindStrength: { value: number };
  public uSssIntensity: { value: number };
  public uSunDirection: { value: THREE.Vector3 };
  public uSunColor: { value: THREE.Color };
  public uTipColor: { value: THREE.Color };
  public uAutumnAccentColor: { value: THREE.Color };
  public uNightFactor: { value: number };
  public uFoliageBarkVolumeTex: { value: THREE.Data3DTexture };

  constructor(options: FoliageShaderOptions = {}) {
    super({
      color: options.baseColor ?? 0xeab308,
      roughness: options.roughness ?? 0.48,
      metalness: options.metalness ?? 0.02,
      side: THREE.DoubleSide,
    });

    this.uTime = { value: 0.0 };
    this.uRainWetness = { value: 0.0 };
    this.uWindSpeed = { value: options.windSpeed ?? 1.6 };
    this.uWindStrength = { value: options.windStrength ?? 0.22 };
    this.uSssIntensity = { value: options.sssIntensity ?? 0.88 };
    this.uSunDirection = {
      value: options.sunDirection
        ? options.sunDirection.clone().normalize()
        : new THREE.Vector3(0.3, 0.25, 0.92).normalize(),
    };
    this.uSunColor = { value: new THREE.Color(options.sunColor ?? 0xff9944) };
    this.uTipColor = { value: new THREE.Color(options.tipColor ?? 0xfef08a) };
    this.uAutumnAccentColor = { value: new THREE.Color(options.autumnAccentColor ?? 0xf97316) };
    this.uNightFactor = { value: options.nightFactor ?? 0.0 };
    this.uFoliageBarkVolumeTex = {
      value: Procedural3DTextureGenerator.getSharedFoliageBark3DTexture(),
    };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uWindSpeed = this.uWindSpeed;
      shader.uniforms.uWindStrength = this.uWindStrength;
      shader.uniforms.uSssIntensity = this.uSssIntensity;
      shader.uniforms.uSunDirection = this.uSunDirection;
      shader.uniforms.uSunColor = this.uSunColor;
      shader.uniforms.uTipColor = this.uTipColor;
      shader.uniforms.uAutumnAccentColor = this.uAutumnAccentColor;
      shader.uniforms.uNightFactor = this.uNightFactor;
      shader.uniforms.uFoliageBarkVolumeTex = this.uFoliageBarkVolumeTex;

      // 頂点シェーダー: 3段階の風揺れ（主幹スウェイ + 枝ガスト + 葉柄支点の扇葉先フラッター）
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindSpeed;
        uniform float uWindStrength;
        varying vec3 vFoliageWorldPos;
        varying vec3 vFoliageLocalPos;
        varying vec2 vFoliageUv;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vFoliageLocalPos = position;
        #ifdef USE_UV
          vFoliageUv = uv;
        #else
          vFoliageUv = position.xz * 0.5 + 0.5;
        #endif

        // 地面からの高さ係数と樹冠中心からの半径係数
        vec4 worldInstancePos = modelMatrix * vec4(position, 1.0);
        float heightFactor = smoothstep(1.8, 8.2, position.y);
        float radialFactor = smoothstep(0.2, 2.2, length(position.xz));
        float treePhase = worldInstancePos.x * 0.17 + worldInstancePos.z * 0.11;
        float windT = uTime * uWindSpeed;

        // 1. 主幹・主枝の大域スウェイ（TreeBarkMaterial と位相を揃える）
        float primarySwayX = sin(windT * 1.15 + treePhase) * 0.16 * heightFactor * heightFactor;
        float primarySwayZ = cos(windT * 0.92 + treePhase * 1.3) * 0.11 * heightFactor * heightFactor;

        // 2. 枝の中周波ガスト揺れ
        float branchPhase = dot(position, vec3(1.9, 1.3, 2.1)) + treePhase;
        float branchGust = sin(windT * 2.6 + branchPhase) * 0.09 * radialFactor * heightFactor;

        // 3. イチョウ扇形葉の高周波フラッター（葉柄 uv.y=0 を支点に、扇形外縁 uv.y=1 ほど大きくはためく）
        float bladeTipWeight = 0.25 + 0.75 * smoothstep(0.08, 0.95, vFoliageUv.y);
        float leafPhase = dot(position, vec3(7.5, 9.2, 6.8)) + treePhase * 2.0;
        vec3 leafFlutter = vec3(
          sin(windT * 6.4 + leafPhase),
          cos(windT * 7.8 + leafPhase * 1.2) * 0.72,
          cos(windT * 5.9 - leafPhase)
        ) * 0.048 * radialFactor * bladeTipWeight;

        transformed.x += (primarySwayX + branchGust) * uWindStrength + leafFlutter.x * uWindStrength;
        transformed.y += leafFlutter.y * uWindStrength;
        transformed.z += (primarySwayZ + branchGust * 0.8) * uWindStrength + leafFlutter.z * uWindStrength;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vFoliageWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

      // フラグメントシェーダー: 実体3D扇形葉UV対応の平行二叉脈・葉別色調差・逆光SSS・葉脈バンプ
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uRainWetness;
        uniform float uSssIntensity;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uTipColor;
        uniform vec3 uAutumnAccentColor;
        uniform float uNightFactor;
        uniform sampler3D uFoliageBarkVolumeTex;
        varying vec3 vFoliageWorldPos;
        varying vec3 vFoliageLocalPos;
        varying vec2 vFoliageUv;

        float foliageHash2D(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float foliageNoise2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = foliageHash2D(i);
          float b = foliageHash2D(i + vec2(1.0, 0.0));
          float c = foliageHash2D(i + vec2(0.0, 1.0));
          float d = foliageHash2D(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        // 実体3Dイチョウ扇形葉の正規化UV (u=扇幅0..1, v=葉柄0..外縁1) に基づく平行二叉脈 (Dichotomous Venation)
        float sampleGinkgoVenation(vec2 uv, vec3 localPos) {
          vec2 fanCoord = vec2(uv.x - 0.5, max(0.02, uv.y));
          float fanRadius = length(fanCoord);
          float fanAngle = atan(fanCoord.x, fanCoord.y);

          // 葉柄から扇状に二股分岐しながら広がる平行脈ストライプ
          float primaryVeins = 0.5 + 0.5 * cos(fanAngle * 44.0);
          float dichotomousSplit = 0.5 + 0.5 * cos(fanAngle * 88.0 + fanRadius * 5.0);
          float fanVeins = mix(primaryVeins, dichotomousSplit, smoothstep(0.32, 0.86, uv.y));

          // 扇の成長リングと先端中央の二股切れ込み (Biloba Notch) の陰影コントラスト
          float growthBand = smoothstep(0.18, 0.92, uv.y);
          float bilobaNotch = 1.0 - 0.30 * exp(-pow((uv.x - 0.5) * 11.5, 2.0)) * smoothstep(0.45, 0.78, uv.y);
          // 葉縁（外縁・側縁）の明るい黄金リムと付け根（葉柄）の引き締め
          float marginHighlight = 1.0 + 0.16 * smoothstep(0.76, 0.98, uv.y) + 0.10 * smoothstep(0.36, 0.49, abs(uv.x - 0.5));
          float petioleShade = mix(0.68, 1.0, smoothstep(0.02, 0.22, uv.y));

          vec4 volSample = texture(uFoliageBarkVolumeTex, localPos * 0.42);
          float volumeVeinMod = mix(0.92, 1.08, volSample.r);
          return mix(0.78, 1.16, fanVeins * 0.68 + growthBand * 0.32) * bilobaNotch * marginHighlight * petioleShade * volumeVeinMod;
        }
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        float canopyHeight = smoothstep(2.6, 8.2, vFoliageLocalPos.y);
        float canopyOuter = smoothstep(0.30, 1.90, length(vFoliageLocalPos.xz));
        vec4 foliageVol = texture(uFoliageBarkVolumeTex, vFoliageWorldPos * 0.14);
        float treeVariation = mix(foliageNoise2D(vFoliageWorldPos.xz * 0.08), foliageVol.b, 0.45);
        float clusterNoise = mix(foliageNoise2D(vFoliageWorldPos.xy * 1.6 + vFoliageWorldPos.z * 1.2), foliageVol.r, 0.5);

        // 重なり合う葉1枚ごとに微妙な色調差（若黄金・濃黄金・琥珀）を与え、個々の扇形葉の輪郭を際立たせる
        vec3 approxStemCell = floor((vFoliageLocalPos - vec3(0.0, vFoliageUv.y * 0.16, 0.0)) * 5.2);
        float leafIdHash = foliageHash2D(approxStemCell.xz + vec2(approxStemCell.y * 17.3, approxStemCell.x * 9.1));

        float venation = sampleGinkgoVenation(vFoliageUv, vFoliageLocalPos);

        // 内側の少し落ち着いたオリーブゴールド、若葉ライムゴールド、外側の輝くイチョウイエロー
        vec3 innerChlorophyll = vec3(0.56, 0.52, 0.08);
        vec3 freshLimeGold = vec3(0.78, 0.84, 0.16);
        vec3 baseLeafTone = mix(diffuseColor.rgb, freshLimeGold, smoothstep(0.65, 0.95, leafIdHash) * 0.35);
        vec3 goldenCore = mix(innerChlorophyll, baseLeafTone, smoothstep(0.0, 0.65, canopyOuter * 0.6 + canopyHeight * 0.5));
        vec3 tippedGold = mix(goldenCore, uTipColor, smoothstep(0.42, 0.96, vFoliageUv.y * 0.55 + canopyHeight * 0.25 + clusterNoise * 0.20));
        vec3 autumnBlend = mix(tippedGold, uAutumnAccentColor, smoothstep(0.52, 0.92, treeVariation * 0.45 + leafIdHash * 0.35 + canopyOuter * 0.20) * 0.48);

        // 樹冠下部のセルフAOと葉柄付け根の奥行き陰影で葉の重なりを立体化
        float leafBaseAo = mix(0.76, 1.06, smoothstep(0.0, 0.75, vFoliageUv.y));
        float canopyAo = mix(0.52, 1.05, smoothstep(0.12, 0.88, canopyHeight * 0.55 + canopyOuter * 0.45)) * mix(0.88, 1.06, foliageVol.a) * leafBaseAo;
        diffuseColor.rgb = autumnBlend * venation * canopyAo;

        // 雨天時は濡れた葉がしっとり濃色化
        diffuseColor.rgb *= mix(1.0, 0.78, uRainWetness);
        `,
      );

      // Why not: Three.js MeshStandardMaterial では metalnessFactor は #include <metalnessmap_fragment> で宣言されるため、
      // その直後で roughnessFactor / metalnessFactor とサブサーフェス散乱 (totalEmissiveRadiance) を注入する
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        /* glsl */ `
        #include <metalnessmap_fragment>
        vec3 foliageViewDir = normalize(cameraPosition - vFoliageWorldPos);
        vec3 foliageSunDir = normalize(uSunDirection);
        vec3 foliageWorldNormal = normalize(vFoliageLocalPos - vec3(0.0, 4.8, 0.0));

        // 1. 逆光サブサーフェス・スキャタリング (Translucent Backlight Subsurface Scattering)
        // 葉の先端・扇外縁 (vFoliageUv.y が大きい部分) ほど薄く光をよく通す
        float backLightDot = max(0.0, dot(foliageViewDir, -foliageSunDir));
        float forwardScatter = pow(backLightDot, 3.2) * 0.75 + pow(backLightDot, 12.0) * 0.45;
        float rimTranslucency = pow(1.0 - abs(dot(foliageViewDir, foliageWorldNormal)), 2.0);
        float bladeTranslucency = 0.45 + 0.55 * smoothstep(0.15, 0.92, vFoliageUv.y);
        float leafThickness = smoothstep(0.22, 1.85, length(vFoliageLocalPos.xz)) * bladeTranslucency;
        float wrapSun = max(0.0, (dot(foliageWorldNormal, foliageSunDir) + 0.45) / 1.45);

        vec3 sssColor = mix(diffuseColor.rgb, uTipColor, 0.55) * uSunColor;
        float dayVisibility = 1.0 - uNightFactor * 0.85;
        vec3 sssContribution = sssColor * (forwardScatter * 1.15 + rimTranslucency * wrapSun * 0.55) * leafThickness * uSssIntensity * dayVisibility;

        // 2. 夜間の行幸通り街灯・都市光による樹冠下部のウォームアップライト
        float underCanopyFactor = smoothstep(6.2, 2.8, vFoliageLocalPos.y) * smoothstep(0.3, 1.8, length(vFoliageLocalPos.xz));
        vec3 nightStreetlightGlow = vec3(1.0, 0.76, 0.38) * underCanopyFactor * uNightFactor * 0.36;

        // 3. 雨天時の葉面水膜によるラフネス低下と濡れツヤ反射
        roughnessFactor = mix(roughnessFactor, 0.14, uRainWetness * 0.85);
        metalnessFactor = mix(metalnessFactor, 0.08, uRainWetness * 0.5);

        totalEmissiveRadiance += sssContribution + nightStreetlightGlow;
        `,
      );

      // 葉脈に沿った微細バンプ法線摂動を注入し、1枚1枚の扇形葉の平行脈レリーフを浮かび上がらせる
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        float veinCenter = sampleGinkgoVenation(vFoliageUv, vFoliageLocalPos);
        float veinDu = sampleGinkgoVenation(vFoliageUv + vec2(0.015, 0.0), vFoliageLocalPos) - veinCenter;
        float veinDv = sampleGinkgoVenation(vFoliageUv + vec2(0.0, 0.015), vFoliageLocalPos) - veinCenter;
        vec3 leafVeinBump = normalize(vec3(-veinDu * 1.6, 1.0, -veinDv * 1.6));
        vec3 viewLeafBump = normalize(mat3(viewMatrix) * leafVeinBump);
        normal = normalize(mix(normal, viewLeafBump, 0.18));
        `,
      );
    };
  }

  /**
   * 天候・時刻・太陽ベクトル・風パラメータを一括同期する
   */
  public syncEnvironment(params: TreeEnvironmentSyncParams): void {
    this.uRainWetness.value = params.wetness;
    this.uTime.value = params.time;

    const hasWindSpeed = params.windSpeed !== undefined;
    if (hasWindSpeed) {
      this.uWindSpeed.value = params.windSpeed!;
    }

    const hasWindStrength = params.windStrength !== undefined;
    if (hasWindStrength) {
      this.uWindStrength.value = params.windStrength!;
    }

    const hasSunDir = params.sunDirection !== undefined;
    if (hasSunDir) {
      this.uSunDirection.value.copy(params.sunDirection!).normalize();
    }

    const hasSunColor = params.sunColor !== undefined;
    if (hasSunColor) {
      this.uSunColor.value.set(params.sunColor!);
    }

    const hasNightFactor = params.nightFactor !== undefined;
    if (hasNightFactor) {
      this.uNightFactor.value = params.nightFactor!;
    }
  }
}

/**
 * 物理ベース イチョウ樹皮・木シェーダー (Procedural Ginkgo Bark, Moss & Wetness Shader)
 *
 * 【特徴・視覚表現】
 * 1. プロシージャル縦溝樹皮＆微細法線摂動 (Anisotropic Vertical Bark Furrows & Bump):
 *    イチョウの幹特有の深い縦方向の裂け目（Fissures）と繊維質リッジを異方性FBMで生成し、
 *    ビュー空間法線 (`normal`) に凹凸バンプを注入。
 * 2. 根元の湿潤コケ＆アンビエントオクルージョン (Root Flare Moss & Ground AO):
 *    地面に近い根張り部（`y < 1.1m`）や北側面に緑色のコケ（Moss）と土壌由来の自然なAOグラデーションを付与。
 * 3. 雨天時の樹皮吸水暗色化＆水筋グロス (Rainwater Bark Absorption & Wet Streaks):
 *    雨天時は樹皮が水を吸って深い黒褐色に変化し、縦溝に沿って流れ落ちる水筋（Wet Streaks）が光沢を持つ。
 * 4. 葉っぱシェーダーと完全同期した主幹スウェイ (Synchronized Trunk Sway):
 *    `GinkgoFoliageMaterial` の第1項（主幹大域スウェイ）と同一の数式・位相で幹と枝をしなやかに揺らす。
 */
export class TreeBarkMaterial extends THREE.MeshStandardMaterial {
  public uTime: { value: number };
  public uRainWetness: { value: number };
  public uWindSpeed: { value: number };
  public uWindStrength: { value: number };
  public uBarkDarkColor: { value: THREE.Color };
  public uBarkLightColor: { value: THREE.Color };
  public uMossColor: { value: THREE.Color };
  public uNightFactor: { value: number };
  public uFoliageBarkVolumeTex: { value: THREE.Data3DTexture };

  constructor(options: TreeBarkShaderOptions = {}) {
    super({
      color: options.barkLightColor ?? 0x5c4033,
      roughness: options.roughness ?? 0.88,
      metalness: options.metalness ?? 0.04,
    });

    this.uTime = { value: 0.0 };
    this.uRainWetness = { value: 0.0 };
    this.uWindSpeed = { value: options.windSpeed ?? 1.6 };
    this.uWindStrength = { value: options.windStrength ?? 0.22 };
    this.uBarkDarkColor = { value: new THREE.Color(options.barkDarkColor ?? 0x261710) };
    this.uBarkLightColor = { value: new THREE.Color(options.barkLightColor ?? 0x6b4c3b) };
    this.uMossColor = { value: new THREE.Color(options.mossColor ?? 0x365314) };
    this.uNightFactor = { value: options.nightFactor ?? 0.0 };
    this.uFoliageBarkVolumeTex = {
      value: Procedural3DTextureGenerator.getSharedFoliageBark3DTexture(),
    };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uRainWetness = this.uRainWetness;
      shader.uniforms.uWindSpeed = this.uWindSpeed;
      shader.uniforms.uWindStrength = this.uWindStrength;
      shader.uniforms.uBarkDarkColor = this.uBarkDarkColor;
      shader.uniforms.uBarkLightColor = this.uBarkLightColor;
      shader.uniforms.uMossColor = this.uMossColor;
      shader.uniforms.uNightFactor = this.uNightFactor;
      shader.uniforms.uFoliageBarkVolumeTex = this.uFoliageBarkVolumeTex;

      // 頂点シェーダー: GinkgoFoliageMaterial と同期した主幹スウェイ
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindSpeed;
        uniform float uWindStrength;
        varying vec3 vBarkWorldPos;
        varying vec3 vBarkLocalPos;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vBarkLocalPos = position;
        vec4 barkWorldInst = modelMatrix * vec4(position, 1.0);
        float heightFactor = smoothstep(1.8, 8.2, position.y);
        float treePhase = barkWorldInst.x * 0.17 + barkWorldInst.z * 0.11;
        float windT = uTime * uWindSpeed;

        // 葉っぱシェーダーと完全同期する大域スウェイ
        float primarySwayX = sin(windT * 1.15 + treePhase) * 0.16 * heightFactor * heightFactor;
        float primarySwayZ = cos(windT * 0.92 + treePhase * 1.3) * 0.11 * heightFactor * heightFactor;

        transformed.x += primarySwayX * uWindStrength;
        transformed.z += primarySwayZ * uWindStrength;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vBarkWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

      // フラグメントシェーダー: 異方性縦溝樹皮ノイズ・根元コケ・雨天水筋グロス
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uRainWetness;
        uniform vec3 uBarkDarkColor;
        uniform vec3 uBarkLightColor;
        uniform vec3 uMossColor;
        uniform float uNightFactor;
        uniform sampler3D uFoliageBarkVolumeTex;
        varying vec3 vBarkWorldPos;
        varying vec3 vBarkLocalPos;

        float barkHash2D(vec2 p) {
          p = fract(p * vec2(234.17, 567.89));
          p += dot(p, p + 33.45);
          return fract(p.x * p.y);
        }

        float barkNoise2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = barkHash2D(i);
          float b = barkHash2D(i + vec2(1.0, 0.0));
          float c = barkHash2D(i + vec2(0.0, 1.0));
          float d = barkHash2D(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        // イチョウ樹皮の縦方向に伸びる裂け目（Anisotropic Vertical Fissures FBM + 3D Volume Texture）
        float sampleBarkFurrows(vec3 localPos) {
          float angle = atan(localPos.x, localPos.z);
          vec2 uv = vec2(angle * 4.5, localPos.y * 1.35);
          float warp = barkNoise2D(uv * 1.8) * 0.65;
          float ridge1 = 0.5 + 0.5 * sin(uv.x * 6.0 + warp * 4.2);
          float ridge2 = barkNoise2D(vec2(uv.x * 12.0 + warp * 2.0, uv.y * 3.5));
          vec4 barkVol = texture(uFoliageBarkVolumeTex, vec3(localPos.x * 0.85, localPos.y * 0.32, localPos.z * 0.85));
          return clamp(ridge1 * 0.45 + ridge2 * 0.25 + barkVol.g * 0.30, 0.0, 1.0);
        }
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        float furrow = sampleBarkFurrows(vBarkLocalPos);
        vec3 barkAlbedo = mix(uBarkDarkColor, uBarkLightColor, smoothstep(0.18, 0.85, furrow));

        // 根張り付近のコケ（Moss）と地面からのアンビエントオクルージョン
        float mossNoise = barkNoise2D(vBarkLocalPos.xz * 6.5 + vec2(0.0, vBarkLocalPos.y * 2.2));
        float mossMask = smoothstep(1.35, 0.08, vBarkLocalPos.y) * smoothstep(0.35, 0.78, mossNoise);
        barkAlbedo = mix(barkAlbedo, uMossColor, mossMask * (0.45 + 0.25 * uRainWetness));

        float groundAo = mix(0.55, 1.0, smoothstep(0.0, 0.9, vBarkLocalPos.y));
        diffuseColor.rgb = barkAlbedo * groundAo;

        // 雨天時は樹皮が水分を吸収して深い暗褐色になる
        float wetStreak = barkNoise2D(vec2(atan(vBarkLocalPos.x, vBarkLocalPos.z) * 5.0, vBarkLocalPos.y * 0.8 - uTime * 0.25));
        float barkWetFactor = clamp(uRainWetness * (0.75 + 0.25 * wetStreak), 0.0, 1.0);
        diffuseColor.rgb *= mix(1.0, 0.48, barkWetFactor);
        `,
      );

      // Why not: normal は #include <normal_fragment_begin> で宣言されるため、
      // normal を摂動する処理は #include <normal_fragment_maps> の直後に配置する
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        /* glsl */ `
        #include <metalnessmap_fragment>
        // 雨天時の縦溝水筋によるスペキュラ光沢
        float furrowGlossSample = sampleBarkFurrows(vBarkLocalPos);
        float streakGloss = smoothstep(0.45, 0.85, furrowGlossSample) * uRainWetness;
        roughnessFactor = mix(roughnessFactor, 0.18, streakGloss * 0.82);
        metalnessFactor = mix(metalnessFactor, 0.10, streakGloss * 0.45);
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        float furrowBump = sampleBarkFurrows(vBarkLocalPos);
        float furrowDx = sampleBarkFurrows(vBarkLocalPos + vec3(0.02, 0.0, 0.0)) - furrowBump;
        float furrowDz = sampleBarkFurrows(vBarkLocalPos + vec3(0.0, 0.0, 0.02)) - furrowBump;
        vec3 barkWorldBump = normalize(vec3(-furrowDx * 2.5, 0.15, -furrowDz * 2.5));
        vec3 viewBump = normalize(mat3(viewMatrix) * barkWorldBump);
        normal = normalize(mix(normal, viewBump, 0.24));
        `,
      );
    };
  }

  /**
   * 天候・時刻・風パラメータを一括同期する
   */
  public syncEnvironment(params: TreeEnvironmentSyncParams): void {
    this.uRainWetness.value = params.wetness;
    this.uTime.value = params.time;

    const hasWindSpeed = params.windSpeed !== undefined;
    if (hasWindSpeed) {
      this.uWindSpeed.value = params.windSpeed!;
    }

    const hasWindStrength = params.windStrength !== undefined;
    if (hasWindStrength) {
      this.uWindStrength.value = params.windStrength!;
    }

    const hasNightFactor = params.nightFactor !== undefined;
    if (hasNightFactor) {
      this.uNightFactor.value = params.nightFactor!;
    }
  }
}

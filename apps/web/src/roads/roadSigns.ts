import * as THREE from "three";
import { Procedural3DTextureGenerator } from "../textures/procedural3DTexture";
import { applyRoadProp3DTexture } from "./roadProps";

export type RoadSign3DTextureMode = "pole" | "sign-back" | "sign-face";

/**
 * 日本の道路標識ジェネレーター
 * 「道路標識、区画線及び道路標示に関する命令」（道路標識令）準拠
 * - 案内標識（大型青看板：方面・方向・路線名・英語併記）
 * - 規制標識（最高速度、止まれ、進入禁止、指定方向外進行禁止、転回禁止）
 * - 警戒標識（信号機あり、交差点あり）
 * - 指示標識（横断歩道）
 * - 道路の通称名標識（行幸通り、日比谷通り等）
 */
export class JapaneseRoadSigns {
  public poleMat: THREE.MeshStandardMaterial;
  public signBackMat: THREE.MeshStandardMaterial;
  public delineatorRetroMat: THREE.MeshStandardMaterial;

  constructor() {
    this.poleMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // 溶融亜鉛めっき鋼管・アルミニウムグレー
      metalness: 0.8,
      roughness: 0.35,
    });
    this.applyRoadSign3DTexture(this.poleMat, "pole");

    this.signBackMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // 標識裏面のグレー防錆塗装
      metalness: 0.5,
      roughness: 0.6,
    });
    this.applyRoadSign3DTexture(this.signBackMat, "sign-back");

    this.delineatorRetroMat = new THREE.MeshStandardMaterial({
      color: 0xff6d00, // 視線誘導標（デリネーター）高輝度オレンジ再帰反射プリズムレンズ
      emissive: 0xff7b00,
      emissiveIntensity: 1.35,
      metalness: 0.42,
      roughness: 0.1,
    });
    applyRoadProp3DTexture(this.delineatorRetroMat, "retroreflector");
  }

  /**
   * 道路標識の鋼製支柱・アルミ裏板・高輝度再帰反射カプセルフィルム看板表面へ
   * 3D ボリュームテクスチャ（sampler3D）を注入する
   *
   * How:
   * - pole: B/A チャンネルで溶融亜鉛めっき鋼管の結晶スパングルと微細風化を表現
   * - sign-back: B/A チャンネルでアルミ裏板の防錆塗装・リブヘアラインの微細粒子を表現
   * - sign-face: R/G チャンネルでガラスビーズ・マイクロプリズム再帰反射シートの粒子きらめきと微細ラフネス変調を表現
   *
   * Why not 2D テクスチャ重ね貼りにするか:
   * 標識盤面の CanvasTexture（文字・矢印・路線バッジ）を汚さずに、視線角度と 3D ワールド位置に応じた
   * マイクロプリズム反射粒子と金属基材バンプを統合するため。
   */
  public applyRoadSign3DTexture(
    material: THREE.MeshStandardMaterial,
    mode: RoadSign3DTextureMode,
  ): void {
    const volumeTex = Procedural3DTextureGenerator.getSharedRoadMarkingProp3DTexture(32);
    const isPole = mode === "pole";
    const isSignBack = mode === "sign-back";
    const modeCode = isPole ? 0 : isSignBack ? 1 : 2;

    material.userData.uRoadPropVolumeTex = volumeTex;
    material.userData.roadSignMode = mode;
    material.customProgramCacheKey = () => "road-sign-3d-unified-v2";

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRoadPropVolumeTex = { value: volumeTex };
      shader.uniforms.uRoadSignMode = { value: modeCode };

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
varying vec3 vSignWorldPos;
varying vec3 vSignLocalPos;`,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vSignLocalPos = position;
vSignWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
precision highp sampler3D;
uniform sampler3D uRoadPropVolumeTex;
uniform int uRoadSignMode;
varying vec3 vSignWorldPos;
varying vec3 vSignLocalPos;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
if (diffuseColor.a < 0.5) discard;
float signCamDist = length(cameraPosition - vSignWorldPos);
vec4 signVoxFine = vec4(0.5);
vec4 signVoxMacro = vec4(0.5);
float signSpangle = 0.5;
float signWeathered = 0.5;
float signBead = 0.5;
float signFilm = 0.5;
float signHeightSignal = 0.5;

if (signCamDist < 65.0) {
  signVoxFine = texture(uRoadPropVolumeTex, vSignWorldPos * 11.0 + vSignLocalPos * 5.0);
  signVoxMacro = texture(uRoadPropVolumeTex, vSignWorldPos * 2.1 + vec3(0.41, 0.19, 0.67));
  signSpangle = mix(signVoxFine.b, signVoxMacro.b, 0.35);
  signWeathered = mix(signVoxFine.a, signVoxMacro.a, 0.4);
  signBead = signVoxFine.r;
  signFilm = signVoxFine.g;
  signHeightSignal = signSpangle;

  if (uRoadSignMode == 0) {
    // 鋼管支柱・F型片持ち水平アーム・照明フード：溶融亜鉛めっき結晶スパングルと雨だれ風化
    float poleShade = 0.90 + (signSpangle - 0.5) * 0.20 + (signWeathered - 0.5) * 0.10;
    diffuseColor.rgb *= clamp(poleShade, 0.72, 1.14);
    signHeightSignal = mix(signSpangle, signWeathered, 0.35);
  } else if (uRoadSignMode == 1) {
    // アルミ裏板・フランジ・補強リブ：ヘアライン防錆塗装と微細アルミ粒子
    float hairline = texture(uRoadPropVolumeTex, vec3(vSignLocalPos.x * 16.0, vSignLocalPos.y * 3.5, vSignWorldPos.z * 4.0)).b;
    float backShade = 0.91 + (hairline - 0.5) * 0.16 + (signWeathered - 0.5) * 0.10;
    diffuseColor.rgb *= clamp(backShade, 0.74, 1.12);
    signHeightSignal = mix(hairline, signWeathered, 0.4);
  } else {
    // 標識表面（大型青看板・規制/警戒/指示標識）：高輝度ガラスビーズ＆マイクロプリズム再帰反射粒子
    vec3 signViewDir = normalize(cameraPosition - vSignWorldPos);
    float retroView = pow(clamp(abs(signViewDir.z) * 0.75 + 0.25, 0.0, 1.0), 1.2);
    float microPrism = smoothstep(0.54, 0.93, signBead) * retroView;
    float filmMod = 0.96 + (signFilm - 0.5) * 0.07 + microPrism * 0.14;
    diffuseColor.rgb *= clamp(filmMod, 0.88, 1.18);
    signHeightSignal = mix(signBead, signFilm, 0.5);
  }
}`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
if (signCamDist < 65.0) {
  if (uRoadSignMode == 0) {
    roughnessFactor = clamp(roughnessFactor + (0.5 - signSpangle) * 0.20, 0.18, 0.68);
    metalnessFactor = clamp(metalnessFactor + (signSpangle - 0.5) * 0.15, 0.55, 0.95);
  } else if (uRoadSignMode == 1) {
    roughnessFactor = clamp(roughnessFactor + (0.5 - signSpangle) * 0.16, 0.35, 0.82);
    metalnessFactor = clamp(metalnessFactor + (signSpangle - 0.5) * 0.12, 0.32, 0.75);
  } else {
    roughnessFactor = clamp(roughnessFactor - (signBead - 0.5) * 0.16, 0.18, 0.62);
    metalnessFactor = clamp(metalnessFactor + (signBead - 0.5) * 0.08, 0.02, 0.24);
  }
}`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
if (signCamDist < 42.0) {
  vec3 dSignPosDx = dFdx(vSignWorldPos);
  vec3 dSignPosDy = dFdy(vSignWorldPos);
  float signBumpAmp = (uRoadSignMode == 2) ? 0.12 : 0.18;
  vec3 signPerturb = (dSignPosDx * dFdx(signHeightSignal) + dSignPosDy * dFdy(signHeightSignal)) * signBumpAmp;
  normal = normalize(normal + signPerturb);
}`,
      );
    };
    material.needsUpdate = true;
  }

  /**
   * 1. 案内標識（オーバーヘッド大型青看板・F型片持ち単柱 / 門型両脚ガントリー）
   * Google Street View（千代田区・日比谷通り大手町交差点 `panoid=sswNlshZHloTRzbinMy4RA`・和田倉門交差点 `panoid=EYjFT0pvZZuvb7MWE8sDng`）
   * の実写検証に基づく日本の方面及び方向案内標識（108-A）：
   *
   * How:
   * - 既定は実写と同一の「F型片持ち式単柱（cantilever = 片足）」：
   *   左歩道側（ローカル `-span / 2`、マップ配置 `rotationY = Math.PI` 時にワールド `+X` の自車左側歩道）に
   *   1本の鋼管支柱を立て、支柱上部の抱き金具（サドルブラケット）から上下2本の平行水平アーム管を右方向へ伸ばす。
   * - 1枚のコンパクトな角丸青看板（横3.6m × 縦2.75m）を支柱から1.9m離して自車走行車線上に架設し、
   *   上下2本の水平アーム管は看板右端から0.14mのエンドキャップ位置でピタッと止める（看板より右へ空のビームが突き出ない）。
   * - 看板表面は千代田区108-A実写に忠実な「中央直進矢印＋水平左右分岐矢印＋交差点名白ピル＋都道ヘキサ［404］・国道おにぎり［1］バッジ＋左右矢印上の方面表記（日英併記）」を描画する。
   *
   * Why not 門型2本足（portal）を既定にするか:
   * 行幸通り・日比谷通り（大手町〜和田倉門〜馬場先門）の実際の道路案内標識を Google Street View で確認すると、
   * すべて歩道植栽帯から1本の支柱で張り出す「F型片持ち式（単柱・片足）」で設置されており、門型2本足ではないため。
   */
  public createOverheadGuideSign(
    x: number,
    z: number,
    options: {
      straightText?: string;
      straightEn?: string;
      leftText?: string;
      leftEn?: string;
      rightText?: string;
      rightEn?: string;
      roadNumber?: string;
      subRoadNumber?: string;
      intersectionName?: string;
      spanWidth?: number;
      supportType?: "portal" | "cantilever";
    } = {},
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.name = "OverheadGuideSignGantry";

    const span = options.spanWidth ?? 19.2;
    const supportType = options.supportType ?? "cantilever";
    const isPortalGantry = supportType === "portal";

    // Why not localX > 0 に片持ち支柱や主看板を置くか:
    // 看板表面の法線はローカル +Z を向いており、正面（+Z側）から看板を見るドライバーにとって
    // 左側（日本の左側通行における左歩道・自車走行車線側）は常にローカル -X（rotationY = Math.PI 時はワールド +X）となるため。
    const signBoardWidth = isPortalGantry ? 4.8 : 3.6;
    const signBoardHeight = isPortalGantry ? 2.45 : 2.75;
    const boardCenterY = isPortalGantry ? 6.05 : 5.85;
    const cantileverColX = -span / 2;
    const maxArmExposeGap = Math.max(0.35, span - signBoardWidth - 0.5);
    const armExposeGap = Math.min(1.9, maxArmExposeGap);
    const portalMainX = Math.max(-span * 0.5 + signBoardWidth * 0.5 + 0.3, -2.4);
    const signCenterX = isPortalGantry
      ? portalMainX
      : cantileverColX + armExposeGap + signBoardWidth * 0.5;
    const companionBoardWidth = 4.2;
    const companionBoardHeight = 2.15;
    const companionCenterX = Math.min(span * 0.5 - companionBoardWidth * 0.5 - 0.3, 2.6);

    const upperBeamY = isPortalGantry ? 7.05 : 6.52;
    const lowerBeamY = isPortalGantry ? 5.05 : 5.18;
    // F型片持ち単柱はGoogle Street View実写通り上段アーム抱き金具のすぐ上（+0.20m）で柱頭キャップとなる
    const columnHeight = isPortalGantry ? 7.55 : upperBeamY + 0.2;

    // 柱・抱き金具（サドルブラケット）・基礎を生成するヘルパー
    const createGantryColumn = (colX: number, sideLabel: string): void => {
      const colGroup = new THREE.Group();
      colGroup.name = `GantryColumn_${sideLabel}`;
      colGroup.position.set(colX, 0, 0);

      // 歩道面（y=0.15m）に馴染む鋼製ベースフランジと基礎カラー
      const foundationGeo = new THREE.CylinderGeometry(0.32, 0.36, 0.3, 16);
      const foundationMesh = new THREE.Mesh(foundationGeo, this.signBackMat);
      foundationMesh.position.y = 0.15;
      colGroup.add(foundationMesh);

      const baseFlangeGeo = new THREE.CylinderGeometry(0.28, 0.3, 0.06, 16);
      const baseFlangeMesh = new THREE.Mesh(baseFlangeGeo, this.poleMat);
      baseFlangeMesh.position.y = 0.33;
      colGroup.add(baseFlangeMesh);

      // 主鋼管支柱（Google Street View 実写のグレー塗装単柱鋼管）
      const topRadius = isPortalGantry ? 0.2 : 0.175;
      const bottomRadius = isPortalGantry ? 0.25 : 0.21;
      const columnGeo = new THREE.CylinderGeometry(topRadius, bottomRadius, columnHeight, 20);
      const column = new THREE.Mesh(columnGeo, this.poleMat);
      column.position.set(0, columnHeight * 0.5, 0);
      column.castShadow = true;
      column.receiveShadow = true;
      colGroup.add(column);

      // 柱頭フラットキャップ
      const capGeo = new THREE.CylinderGeometry(topRadius + 0.02, topRadius + 0.02, 0.07, 20);
      const capMesh = new THREE.Mesh(capGeo, this.poleMat);
      capMesh.position.y = columnHeight + 0.035;
      colGroup.add(capMesh);

      // 上下アーム接合リングバンド＆縦型サドルブラケット（Google Street View 108-A の抱き金具構造）
      const innerSignDir = colX < 0 ? 1 : -1;
      const saddleHeight = upperBeamY - lowerBeamY + 0.28;
      const saddleGeo = new THREE.BoxGeometry(0.22, saddleHeight, 0.26);
      const saddle = new THREE.Mesh(saddleGeo, this.poleMat);
      saddle.name = "CantileverSaddleBracket";
      saddle.position.set(innerSignDir * (topRadius + 0.06), (upperBeamY + lowerBeamY) * 0.5, 0);
      colGroup.add(saddle);

      for (const beamY of [upperBeamY, lowerBeamY]) {
        const collarGeo = new THREE.CylinderGeometry(
          topRadius + 0.045,
          topRadius + 0.045,
          0.22,
          20,
        );
        const collar = new THREE.Mesh(collarGeo, this.poleMat);
        collar.position.y = beamY;
        colGroup.add(collar);
      }

      group.add(colGroup);
    };

    if (isPortalGantry) {
      // 門型両脚ガントリー：左右両側の歩道に2本の支柱（両足）を配置
      createGantryColumn(-span / 2, "Left");
      createGantryColumn(span / 2, "Right");
    } else {
      // F型片持ち式単柱（片足）：左歩道（ローカル -span / 2 -> ワールド +span / 2）に1本の支柱のみ配置
      createGantryColumn(cantileverColX, "CantileverLeft");
    }

    // 水平アーム管の始端・終端（F型片持ち時は左支柱から看板右端+0.14mまでのみ伸び、道路中央・右側へは一切突出しない）
    const beamStartX = isPortalGantry ? -span / 2 : cantileverColX;
    const beamEndX = isPortalGantry
      ? span / 2
      : Math.min(span / 2, signCenterX + signBoardWidth * 0.5 + 0.14);
    const beamLength = beamEndX - beamStartX;
    const beamCenterX = (beamStartX + beamEndX) * 0.5;
    const armRadiusUpper = isPortalGantry ? 0.135 : 0.088;
    const armRadiusLower = isPortalGantry ? 0.12 : 0.084;

    // 上下2本の平行水平アーム鋼管（Google Street View 実写準拠）
    const upperBeamGeo = new THREE.CylinderGeometry(armRadiusUpper, armRadiusUpper, beamLength, 16);
    upperBeamGeo.rotateZ(Math.PI / 2);
    const beam = new THREE.Mesh(upperBeamGeo, this.poleMat);
    beam.name = "GantryUpperBeam";
    beam.position.set(beamCenterX, upperBeamY, 0);
    beam.castShadow = true;
    group.add(beam);

    const lowerBeamGeo = new THREE.CylinderGeometry(armRadiusLower, armRadiusLower, beamLength, 16);
    lowerBeamGeo.rotateZ(Math.PI / 2);
    const beamLower = new THREE.Mesh(lowerBeamGeo, this.poleMat);
    beamLower.name = "GantryLowerBeam";
    beamLower.position.set(beamCenterX, lowerBeamY, 0);
    beamLower.castShadow = true;
    group.add(beamLower);

    // F型片持ち時は水平アーム右端に丸型パイプエンドキャップを装着
    if (!isPortalGantry) {
      for (const [beamY, r] of [
        [upperBeamY, armRadiusUpper],
        [lowerBeamY, armRadiusLower],
      ] as const) {
        const endCapGeo = new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.04, 16);
        endCapGeo.rotateZ(Math.PI / 2);
        const endCap = new THREE.Mesh(endCapGeo, this.signBackMat);
        endCap.position.set(beamEndX + 0.01, beamY, 0);
        group.add(endCap);
      }
    }

    // 門型ガントリー時のみ上下横梁を繋ぐトラス束材を配置（F型片持ち単柱は実写通りスッキリした平行2本パイプ）
    if (isPortalGantry) {
      const trussHeight = upperBeamY - lowerBeamY;
      const trussMidY = (upperBeamY + lowerBeamY) * 0.5;
      const bayStep = 2.1;
      const strutGeo = new THREE.CylinderGeometry(0.055, 0.055, trussHeight, 8);

      const firstBayX = beamStartX + 0.75;
      const lastBayX = beamEndX - 0.75;
      for (let bx = firstBayX; bx <= lastBayX + 0.01; bx += bayStep) {
        const strut = new THREE.Mesh(strutGeo, this.poleMat);
        strut.position.set(bx, trussMidY, 0);
        group.add(strut);
      }
    }

    // 1. 主案内標識ボード（自車走行車線直上: F型時は横3.6m × 縦2.75m、厚み0.07m）
    const boardGeo = new THREE.BoxGeometry(signBoardWidth, signBoardHeight, 0.07);
    const boardMesh = new THREE.Mesh(boardGeo, this.signBackMat);
    boardMesh.name = "PrimaryGuideBoard";
    boardMesh.position.set(signCenterX, boardCenterY, 0.16);
    boardMesh.castShadow = true;
    group.add(boardMesh);

    // 看板背面のアルミ取付チャンネル（縦リブ 3本）
    const ribGeo = new THREE.BoxGeometry(0.07, signBoardHeight + 0.1, 0.12);
    const ribOffsets = isPortalGantry ? [-1.8, -0.6, 0.6, 1.8] : [-1.25, 0, 1.25];
    for (const rx of ribOffsets) {
      const rib = new THREE.Mesh(ribGeo, this.poleMat);
      rib.position.set(signCenterX + rx, boardCenterY, 0.08);
      group.add(rib);
    }

    // 2. 門型ガントリー時のみ隣レーン上部にサブボード＆背面対向ボードを並設
    if (isPortalGantry) {
      const companionBoardMesh = new THREE.Mesh(
        new THREE.BoxGeometry(companionBoardWidth, companionBoardHeight, 0.07),
        this.signBackMat,
      );
      companionBoardMesh.name = "SecondaryLaneGuideBoard";
      companionBoardMesh.position.set(companionCenterX, boardCenterY, 0.16);
      companionBoardMesh.castShadow = true;
      group.add(companionBoardMesh);

      const oppBoardMesh = new THREE.Mesh(
        new THREE.BoxGeometry(companionBoardWidth, companionBoardHeight, 0.07),
        this.signBackMat,
      );
      oppBoardMesh.name = "OppositeGuideBoard";
      oppBoardMesh.position.set(companionCenterX, boardCenterY, -0.16);
      group.add(oppBoardMesh);
    }

    // 表面青看板グラフィック（千代田区 Google Street View 実写準拠の 108-A 方面及び方向標識）
    // Why not: Node/ヘッドレス単体テスト環境（typeof document === "undefined"）で看板表面メッシュの生成自体をスキップすると、
    // 表面メッシュ（PrimaryGuideSignFace）や再帰反射マテリアル（emissiveMap）の構造検証ができないため、
    // DOM 非存在時は JIS 案内標識ブルー（#0052ac）の DataTexture フォールバックを生成して常に同一のメッシュ階層を構築する。
    let signTex: THREE.Texture;
    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 780;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 千代田区高輝度再帰反射シートの鮮やかな案内標識ブルー（#0052ac）
        ctx!.fillStyle = "#0052ac";
        ctx!.fillRect(0, 0, 1024, 780);

        // 外枠の角丸白フチ線（108-A 実写準拠の角丸白枠）
        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 16;
        ctx!.beginPath();
        ctx!.roundRect(20, 20, 984, 740, 28);
        ctx!.stroke();

        ctx!.fillStyle = "#ffffff";
        ctx!.textAlign = "center";

        // 1. 上部中央：直進方面（漢字＋英語併記、直進矢印先端の真上）
        const straightJa = options.straightText ?? "皇居・大手町";
        const straightEn = options.straightEn ?? "Imperial Palace / Otemachi";
        ctx!.font = "bold 62px sans-serif";
        ctx!.fillText(straightJa, 512, 106, 860);
        ctx!.font = "bold 32px sans-serif";
        ctx!.fillText(straightEn, 512, 154, 860);

        // 2. 中央縦軸の太い直進矢印（下端 y=718 から上端矢尻 y=178 まで貫通）
        const centerShaftX = 512;
        const crossY = 580;
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(centerShaftX - 19, 250, 38, 468);
        ctx!.beginPath();
        ctx!.moveTo(centerShaftX, 176);
        ctx!.lineTo(centerShaftX - 56, 260);
        ctx!.lineTo(centerShaftX + 56, 260);
        ctx!.closePath();
        ctx!.fill();

        // 3. 水平交差分岐矢印（y=580 で直進軸と十字交差する左右矢印 ← ——— →）
        ctx!.fillRect(128, crossY - 17, 768, 34);
        // 左矢尻
        ctx!.beginPath();
        ctx!.moveTo(56, crossY);
        ctx!.lineTo(138, crossY - 50);
        ctx!.lineTo(138, crossY + 50);
        ctx!.closePath();
        ctx!.fill();
        // 右矢尻
        ctx!.beginPath();
        ctx!.moveTo(968, crossY);
        ctx!.lineTo(886, crossY - 50);
        ctx!.lineTo(886, crossY + 50);
        ctx!.closePath();
        ctx!.fill();

        // 4. 左右水平矢印の真上に配置される左折・右折方面テキスト（Google Street View 実写レイアウト）
        const leftJa = options.leftText ?? "日比谷";
        const leftEn = options.leftEn ?? "Hibiya";
        ctx!.fillStyle = "#ffffff";
        ctx!.font = "bold 54px sans-serif";
        ctx!.fillText(leftJa, 246, 442, 380);
        ctx!.font = "bold 28px sans-serif";
        ctx!.fillText(leftEn, 246, 488, 380);

        const rightJa = options.rightText ?? "大手町・神田";
        const rightEn = options.rightEn ?? "Otemachi / Kanda";
        ctx!.font = "bold 54px sans-serif";
        ctx!.fillText(rightJa, 778, 442, 380);
        ctx!.font = "bold 28px sans-serif";
        ctx!.fillText(rightEn, 778, 488, 380);

        // 5. 矢印軸上の路線番号バッジ（都道ヘキサ［404］・国道おにぎり［1］）と交差点名白ピル
        const routeNum = options.roadNumber ?? "1";
        const subRouteNum = options.subRoadNumber ?? "404";
        const intersectionName = options.intersectionName ?? "和田倉門";

        // 直進軸上の路線バッジ
        this.drawPrefecturalHexBadge(ctx!, centerShaftX, 376, subRouteNum);
        // 左分岐軸上の都道ヘキサバッジ
        this.drawPrefecturalHexBadge(ctx!, 268, crossY, subRouteNum);
        // 右分岐軸上の国道おにぎりバッジ
        this.drawRouteBadge(ctx!, 756, crossY, routeNum);

        // 十字交差部中央の交差点名白ピル（実写の大手町・和田倉門表記）
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.roundRect(centerShaftX - 92, crossY - 27, 184, 54, 10);
        ctx!.fill();
        ctx!.strokeStyle = "#0052ac";
        ctx!.lineWidth = 4;
        ctx!.stroke();
        ctx!.fillStyle = "#0052ac";
        ctx!.font = "bold 33px sans-serif";
        ctx!.fillText(intersectionName, centerShaftX, crossY + 12, 168);
      }

      signTex = new THREE.CanvasTexture(canvas);
    } else {
      const fallbackPixels = new Uint8Array([0, 82, 172, 255]);
      signTex = new THREE.DataTexture(fallbackPixels, 1, 1, THREE.RGBAFormat);
      signTex.needsUpdate = true;
    }

    signTex.colorSpace = THREE.SRGBColorSpace;
    const frontMat = new THREE.MeshStandardMaterial({
      map: signTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: signTex,
      // Why not: 全面均一の高い emissiveIntensity だけに頼ると、上部外照灯（SpotLight）の照射グラデーションが潰れて「ライトが光源になっていない」不自然な見た目になるため、
      // ベース再帰反射は 0.22 に抑え、上部2灯の SpotLight 実光源で看板表面を直接照らす。
      emissiveIntensity: 0.22,
      roughness: 0.36,
      metalness: 0.05,
    });
    this.applyRoadSign3DTexture(frontMat, "sign-face");

    const frontGeo = new THREE.PlaneGeometry(signBoardWidth * 0.985, signBoardHeight * 0.985);
    const frontMesh = new THREE.Mesh(frontGeo, frontMat);
    frontMesh.name = "PrimaryGuideSignFace";
    frontMesh.position.set(signCenterX, boardCenterY, 0.205);
    frontMesh.receiveShadow = true;
    group.add(frontMesh);

    // 看板上部の外照式標識照明灯（アーム＋アルミ反射フード＋高輝度LED発光面＋Three.js SpotLight 実光源）を装着するヘルパー
    // Why not: 発光色メッシュ（MeshBasicMaterial や emissive）を看板上に置くだけでは Three.js の実光源にならず、
    // 逆光時や夕暮れ・夜間にライト直下の看板面が暗い影のままになるため、各灯具に THREE.SpotLight と target を組み込んで看板面を実際に照射する。
    const lampBulbMat = new THREE.MeshStandardMaterial({
      color: 0xfffbeb,
      emissive: new THREE.Color(0xfef08a),
      emissiveIntensity: 2.6,
      roughness: 0.15,
      metalness: 0.05,
      toneMapped: false,
    });

    const attachBoardFloodlights = (
      targetBoardX: number,
      targetBoardWidth: number,
      targetBoardHeight: number,
      boardTag: string,
    ): void => {
      const boardTopY = boardCenterY + targetBoardHeight * 0.5;
      const lampOffsetsX = [-targetBoardWidth * 0.26, targetBoardWidth * 0.26];

      for (let i = 0; i < lampOffsetsX.length; i++) {
        const lampX = targetBoardX + lampOffsetsX[i];

        // 1. 看板上端フレームから手前（+Z）へ張り出す外照灯サポートアーム
        const riserGeo = new THREE.BoxGeometry(0.06, 0.16, 0.06);
        const riserMesh = new THREE.Mesh(riserGeo, this.poleMat);
        riserMesh.name = `OverheadSignLampRiser_${boardTag}_${i}`;
        riserMesh.position.set(lampX, boardTopY + 0.08, 0.16);
        group.add(riserMesh);

        const armGeo = new THREE.BoxGeometry(0.05, 0.05, 0.66);
        const armMesh = new THREE.Mesh(armGeo, this.poleMat);
        armMesh.name = `OverheadSignLampArm_${boardTag}_${i}`;
        armMesh.position.set(lampX, boardTopY + 0.15, 0.47);
        group.add(armMesh);

        // 2. 下向きに傾斜したアルミ反射フードと下面の高輝度LED発光レンズ
        const hoodGroup = new THREE.Group();
        hoodGroup.name = `OverheadSignLampHood_${boardTag}_${i}`;
        hoodGroup.position.set(lampX, boardTopY + 0.14, 0.78);
        hoodGroup.rotation.x = 0.32;

        const hoodHousingGeo = new THREE.BoxGeometry(0.84, 0.075, 0.34);
        const hoodHousingMesh = new THREE.Mesh(hoodHousingGeo, this.poleMat);
        hoodGroup.add(hoodHousingMesh);

        const bulbGeo = new THREE.BoxGeometry(0.76, 0.028, 0.26);
        const bulbMesh = new THREE.Mesh(bulbGeo, lampBulbMat);
        bulbMesh.name = `OverheadSignLampBulb_${boardTag}_${i}`;
        bulbMesh.position.set(0, -0.042, 0);
        hoodGroup.add(bulbMesh);

        group.add(hoodGroup);

        // 3. 看板表面（z = 0.205）および直下路面を実際に照らす Three.js SpotLight 実光源
        const spotLight = new THREE.SpotLight(0xfff7ed, 22.0, 9.5, Math.PI / 2.15, 0.72, 1.2);
        spotLight.name = `OverheadSignSpotLight_${boardTag}_${i}`;
        spotLight.position.set(lampX, boardTopY + 0.1, 0.82);
        spotLight.castShadow = false;

        const spotTarget = new THREE.Object3D();
        spotTarget.name = `OverheadSignSpotLightTarget_${boardTag}_${i}`;
        spotTarget.position.set(lampX, boardCenterY - 0.15, 0.205);
        group.add(spotTarget);

        spotLight.target = spotTarget;
        group.add(spotLight);
      }
    };

    attachBoardFloodlights(signCenterX, signBoardWidth, signBoardHeight, "Primary");

    // 門型ガントリー時のみ車線別進行方向・路線案内パネルを並設
    if (isPortalGantry) {
      let laneTex: THREE.Texture;
      if (hasDocument) {
        const laneCanvas = document.createElement("canvas");
        laneCanvas.width = 768;
        laneCanvas.height = 384;
        const lCtx = laneCanvas.getContext("2d");
        const hasLaneCtx = Boolean(lCtx);
        if (hasLaneCtx) {
          lCtx!.fillStyle = "#0052ac";
          lCtx!.fillRect(0, 0, 768, 384);

          lCtx!.strokeStyle = "#ffffff";
          lCtx!.lineWidth = 12;
          lCtx!.beginPath();
          lCtx!.roundRect(14, 14, 740, 356, 20);
          lCtx!.stroke();

          lCtx!.setLineDash([24, 16]);
          lCtx!.lineWidth = 8;
          for (const divX of [256, 512]) {
            lCtx!.beginPath();
            lCtx!.moveTo(divX, 30);
            lCtx!.lineTo(divX, 354);
            lCtx!.stroke();
          }
          lCtx!.setLineDash([]);

          lCtx!.fillStyle = "#ffffff";
          lCtx!.textAlign = "center";
          lCtx!.font = "bold 31px sans-serif";
          lCtx!.fillText(options.leftText ?? "日比谷・霞が関", 128, 78, 224);
          lCtx!.fillText(options.straightText ?? "皇居・内堀通", 384, 78, 224);
          lCtx!.fillText(options.rightText ?? "大手町・東京駅", 640, 78, 224);

          lCtx!.font = "bold 19px sans-serif";
          lCtx!.fillText(options.leftEn ?? "Hibiya", 128, 112, 224);
          lCtx!.fillText(options.straightEn ?? "Uchibori-dori", 384, 112, 224);
          lCtx!.fillText(options.rightEn ?? "Otemachi", 640, 112, 224);

          this.drawArrow(lCtx!, 142, 330, 142, 165, "#ffffff", 20);
          this.drawTurnArrowLeft(lCtx!, 142, 265, 68, 205, "#ffffff");
          this.drawArrow(lCtx!, 384, 330, 384, 155, "#ffffff", 24);
          this.drawRouteBadge(lCtx!, 384, 255, options.roadNumber ?? "1");
          this.drawTurnArrow(lCtx!, 608, 330, 688, 205, "#ffffff");
        }
        laneTex = new THREE.CanvasTexture(laneCanvas);
      } else {
        const fallbackLanePixels = new Uint8Array([0, 82, 172, 255]);
        laneTex = new THREE.DataTexture(fallbackLanePixels, 1, 1, THREE.RGBAFormat);
        laneTex.needsUpdate = true;
      }

      laneTex.colorSpace = THREE.SRGBColorSpace;
      const laneMat = new THREE.MeshStandardMaterial({
        map: laneTex,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: laneTex,
        emissiveIntensity: 0.22,
        roughness: 0.36,
        metalness: 0.05,
      });
      this.applyRoadSign3DTexture(laneMat, "sign-face");

      const companionFrontMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(companionBoardWidth * 0.98, companionBoardHeight * 0.98),
        laneMat,
      );
      companionFrontMesh.name = "SecondaryLaneGuideSignFace";
      companionFrontMesh.position.set(companionCenterX, boardCenterY, 0.205);
      companionFrontMesh.receiveShadow = true;
      group.add(companionFrontMesh);

      attachBoardFloodlights(
        companionCenterX,
        companionBoardWidth,
        companionBoardHeight,
        "Secondary",
      );

      const backSignMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(companionBoardWidth * 0.98, companionBoardHeight * 0.98),
        frontMat,
      );
      backSignMesh.name = "OppositeGuideSignFace";
      backSignMesh.position.set(companionCenterX, boardCenterY, -0.205);
      backSignMesh.rotation.y = Math.PI;
      group.add(backSignMesh);
    }

    return group;
  }

  /**
   * 2. 規制標識: 「止まれ / STOP」（330: 赤色逆三角形）
   */
  public createStopSign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 支柱（標識板上端 y = 3.2 + 0.37 = 3.57m より低く止め、上から柱が突き出ないようにする）
    const pole = this.createPoleMesh(3.45);
    group.add(pole);

    // 逆三角形標識板
    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 444; // 三角比率 (sqrt(3)/2)
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 赤地逆三角形
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.moveTo(16, 20);
        ctx!.lineTo(496, 20);
        ctx!.lineTo(256, 424);
        ctx!.closePath();
        ctx!.fill();

        // 白フチ線
        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 16;
        ctx!.stroke();

        // 文字「止まれ」 & 「STOP」
        ctx!.fillStyle = "#ffffff";
        ctx!.textAlign = "center";
        ctx!.font = "bold 96px sans-serif";
        ctx!.fillText("止まれ", 256, 175);
        ctx!.font = "bold 64px sans-serif";
        ctx!.fillText("STOP", 256, 280);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.5,
      });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.74), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    // 裏板（表面の赤色逆三角形 ▼ と完全に一致する下向き頂点の3角板）
    // Why not CylinderGeometry(..., 3) + rotateZ(Math.PI) を使うか:
    // rotateX(Math.PI / 2) 時点で既に下向き頂点（▼）になっている3角柱をさらに rotateZ(Math.PI) すると
    // 上向き3角形（▲）に反転して表面の逆三角形から裏板の角が大きくはみ出すため、Shape + ExtrudeGeometry で逆三角形を直接生成する。
    const backShape = new THREE.Shape();
    backShape.moveTo(-0.4, 0.34);
    backShape.lineTo(0.4, 0.34);
    backShape.lineTo(0, -0.34);
    backShape.closePath();
    const backGeo = new THREE.ExtrudeGeometry(backShape, {
      depth: 0.02,
      bevelEnabled: false,
    });
    backGeo.translate(0, 0, -0.01);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    back.name = "StopSignBackingBoard";
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, 0.36);

    group.add(signGroup);
    return group;
  }

  /**
   * 3. 規制標識: 「車両進入禁止」（303: 赤丸に白横バー）
   */
  public createNoEntrySign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.45);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 赤丸
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.arc(128, 128, 120, 0, Math.PI * 2);
        ctx!.fill();

        // 白フチ
        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 8;
        ctx!.stroke();

        // 中央の白長方形バー
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(36, 104, 184, 48);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.5,
      });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    // 裏板
    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, 0.42);

    group.add(signGroup);
    return group;
  }

  /**
   * 4. 規制標識: 「指定方向外進行禁止」（311: 青丸白矢印・直進および左折等）
   */
  public createDirectionSign(
    x: number,
    z: number,
    direction: "straight-left" | "straight-right" | "straight-only" = "straight-left",
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.45);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 青丸
        ctx!.fillStyle = "#1d4ed8";
        ctx!.beginPath();
        ctx!.arc(128, 128, 120, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 8;
        ctx!.stroke();

        // 白矢印
        const isStraightOnly = direction === "straight-only";
        const isStraightLeft = direction === "straight-left";
        if (isStraightOnly) {
          this.drawArrow(ctx!, 128, 200, 128, 50, "#ffffff", 22);
        } else if (isStraightLeft) {
          this.drawArrow(ctx!, 140, 200, 140, 60, "#ffffff", 18);
          this.drawTurnArrowLeft(ctx!, 140, 160, 50, 100, "#ffffff");
        } else {
          this.drawArrow(ctx!, 116, 200, 116, 60, "#ffffff", 18);
          this.drawTurnArrow(ctx!, 116, 160, 206, 100, "#ffffff");
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.5,
      });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, 0.42);

    group.add(signGroup);
    return group;
  }

  /**
   * 5. 警戒標識: 「信号機あり」（201-2: 黄色ひし形黒枠・信号機シンボル）
   */
  public createWarningSignalSign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.42);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 黄色ひし形（45度回転した正方形）
        ctx!.save();
        ctx!.translate(128, 128);
        ctx!.rotate(Math.PI / 4);

        ctx!.fillStyle = "#facc15"; // 警戒黄色
        ctx!.fillRect(-80, -80, 160, 160);

        ctx!.strokeStyle = "#18181b";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(-76, -76, 152, 152);

        ctx!.restore();

        // 信号機ピクトグラム（日本の道路標識令 201-2 準拠：白縁付き黒カプセル筐体に左から青緑・黄・赤）
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(94, 128, 25, Math.PI * 0.5, Math.PI * 1.5);
        ctx!.arc(162, 128, 25, -Math.PI * 0.5, Math.PI * 0.5);
        ctx!.closePath();
        ctx!.fill();

        ctx!.fillStyle = "#18181b";
        ctx!.beginPath();
        ctx!.arc(94, 128, 21, Math.PI * 0.5, Math.PI * 1.5);
        ctx!.arc(162, 128, 21, -Math.PI * 0.5, Math.PI * 0.5);
        ctx!.closePath();
        ctx!.fill();

        // 左：青（日本の青緑信号色）・中：黄・右：赤
        ctx!.fillStyle = "#00b894";
        ctx!.beginPath();
        ctx!.arc(94, 128, 12, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = "#facc15";
        ctx!.beginPath();
        ctx!.arc(128, 128, 12, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = "#ef4444";
        ctx!.beginPath();
        ctx!.arc(162, 128, 12, 0, Math.PI * 2);
        ctx!.fill();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.5,
      });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    // ひし形裏板
    const backGeo = new THREE.BoxGeometry(0.55, 0.55, 0.02);
    backGeo.rotateZ(Math.PI / 4);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, 0.36);

    group.add(signGroup);
    return group;
  }

  /**
   * 6. 指示標識: 「横断歩道」（407: 青五角形屋根型・歩行者ピクトグラム）
   */
  public createCrosswalkSign(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pole = this.createPoleMesh(3.42);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.2, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 青色五角形（家型・屋根型）
        ctx!.fillStyle = "#1d4ed8";
        ctx!.beginPath();
        ctx!.moveTo(128, 12);
        ctx!.lineTo(240, 96);
        ctx!.lineTo(240, 240);
        ctx!.lineTo(16, 240);
        ctx!.lineTo(16, 96);
        ctx!.closePath();
        ctx!.fill();

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 8;
        ctx!.stroke();

        // 内部白三角（横断歩道エリア）
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.moveTo(128, 48);
        ctx!.lineTo(218, 220);
        ctx!.lineTo(38, 220);
        ctx!.closePath();
        ctx!.fill();

        // 歩行者シルエット（黒色）
        ctx!.fillStyle = "#1e293b";
        // 頭
        ctx!.beginPath();
        ctx!.arc(128, 92, 12, 0, Math.PI * 2);
        ctx!.fill();
        // 体・手足（簡易ピクトグラム）
        ctx!.fillRect(122, 108, 12, 42);
        ctx!.beginPath();
        ctx!.moveTo(124, 150);
        ctx!.lineTo(108, 195);
        ctx!.lineTo(118, 195);
        ctx!.lineTo(128, 155);
        ctx!.lineTo(138, 195);
        ctx!.lineTo(148, 195);
        ctx!.lineTo(132, 150);
        ctx!.fill();

        // ゼブラ帯（横断歩道ストライプ）
        ctx!.fillRect(75, 198, 106, 6);
        ctx!.fillRect(65, 208, 126, 6);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.5,
      });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    // 五角形（家型）裏板
    // Why not BoxGeometry(0.68, 0.68, 0.02) を使うか:
    // 正方形の裏板にすると五角形の斜め屋根部分の左右上角からグレーの裏板が突き出てしまうため、五角形 Shape で生成する。
    const pentShape = new THREE.Shape();
    pentShape.moveTo(0, 0.32);
    pentShape.lineTo(0.31, 0.08);
    pentShape.lineTo(0.31, -0.32);
    pentShape.lineTo(-0.31, -0.32);
    pentShape.lineTo(-0.31, 0.08);
    pentShape.closePath();
    const backGeo = new THREE.ExtrudeGeometry(pentShape, {
      depth: 0.02,
      bevelEnabled: false,
    });
    backGeo.translate(0, 0, -0.01);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    back.name = "CrosswalkSignBackingBoard";
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, 0.44);

    group.add(signGroup);
    return group;
  }

  /**
   * 7. 通称名標識（119: 青長方形「行幸通り Gyoko-dori Ave.」等）
   */
  public createStreetNameSign(x: number, z: number, nameJa: string, nameEn: string): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 看板上端 (y = 3.4 + 0.225 = 3.625m) より必ず下で支柱が止まるように高さを 3.50m に設定
    const pole = this.createPoleMesh(3.5);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.4, 0);

    const width = 1.4;
    const height = 0.45;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 160;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#00428a"; // 道路標識ブルー
        ctx!.fillRect(0, 0, 512, 160);

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 8;
        ctx!.strokeRect(6, 6, 500, 148);

        ctx!.fillStyle = "#ffffff";
        ctx!.textAlign = "center";
        ctx!.font = "bold 50px sans-serif";
        ctx!.fillText(nameJa, 256, 68);
        ctx!.font = "bold 24px sans-serif";
        ctx!.fillText(nameEn, 256, 122);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4 });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(width, height, 0.02);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, width * 0.78);

    group.add(signGroup);
    return group;
  }

  // --- ヘルパー描画メソッド ---

  public createPoleMesh(height: number): THREE.Mesh {
    const poleGeo = new THREE.CylinderGeometry(0.042, 0.045, height, 12);
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.name = "RoadSignPole";
    pole.userData.poleHeight = height;
    // Why not z = 0 に支柱を置くか:
    // 標識表面メッシュは z = +0.02 に配置されるため、半径 0.045m の円柱を z = 0 に置くと
    // 支柱前面（z = +0.045）が標識表面を貫通して縦縞状に露出してしまうため、背面板（z = -0.01）の直後へオフセットする。
    pole.position.set(0, height / 2, -0.06);
    pole.castShadow = true;

    // 支柱上端のドーム型雨水侵入防止キャップ
    const capGeo = new THREE.SphereGeometry(0.044, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const cap = new THREE.Mesh(capGeo, this.signBackMat);
    cap.position.set(0, height / 2, 0);
    pole.add(cap);

    return pole;
  }

  /**
   * 標識板背面の横リブ金具およびUボルト取付ブラケットを追加する
   * How: 看板背面 (z = -0.02) と支柱 (z = -0.06) を物理的に締結する上下2本のアルミ平リブとU字クランプを生成する。
   */
  public addBackMountingRibs(signGroup: THREE.Group, ribWidth: number): void {
    const ribsGroup = new THREE.Group();
    ribsGroup.name = "SignBackMountingRibs";
    const ribGeo = new THREE.BoxGeometry(ribWidth, 0.032, 0.024);
    const clampGeo = new THREE.BoxGeometry(0.11, 0.044, 0.065);
    for (const offsetY of [-0.11, 0.11]) {
      const rib = new THREE.Mesh(ribGeo, this.signBackMat);
      rib.position.set(0, offsetY, -0.022);
      ribsGroup.add(rib);

      const clamp = new THREE.Mesh(clampGeo, this.poleMat);
      clamp.position.set(0, offsetY, -0.045);
      ribsGroup.add(clamp);
    }
    signGroup.add(ribsGroup);
  }

  private drawArrow(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width = 24,
  ): void {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 矢尻
    const headLen = width * 2.2;
    ctx.beginPath();
    ctx.moveTo(x2, y2 - headLen * 0.4);
    ctx.lineTo(x2 - headLen * 0.8, y2 + headLen * 0.8);
    ctx.lineTo(x2 + headLen * 0.8, y2 + headLen * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  private drawTurnArrow(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): void {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 20;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 矢尻（右向き）
    ctx.beginPath();
    ctx.moveTo(x2 + 20, y2);
    ctx.lineTo(x2 - 25, y2 - 25);
    ctx.lineTo(x2 - 25, y2 + 25);
    ctx.closePath();
    ctx.fill();
  }

  private drawTurnArrowLeft(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): void {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 20;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 矢尻（左向き）
    ctx.beginPath();
    ctx.moveTo(x2 - 20, y2);
    ctx.lineTo(x2 + 25, y2 - 25);
    ctx.lineTo(x2 + 25, y2 + 25);
    ctx.closePath();
    ctx.fill();
  }

  private drawRouteBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    routeNum: string,
  ): void {
    // 国道「おにぎり」型青色マーク（118のA：丸みのある逆三角形、Google Street View otemachi_108a_superzoom.jpg 準拠）
    ctx.save();
    ctx.fillStyle = "#004a99";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4.5;
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(x - 32, y - 28);
    ctx.quadraticCurveTo(x, y - 34, x + 32, y - 28);
    ctx.quadraticCurveTo(x + 40, y - 24, x + 34, y - 8);
    ctx.quadraticCurveTo(x + 18, y + 26, x, y + 34);
    ctx.quadraticCurveTo(x - 18, y + 26, x - 34, y - 8);
    ctx.quadraticCurveTo(x - 40, y - 24, x - 32, y - 28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("国道", x, y - 13);

    ctx.font = "bold 28px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillText(routeNum, x, y + 18);
    ctx.restore();
  }

  private drawPrefecturalHexBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    routeNum: string,
  ): void {
    // 都道府県道「ヘキサゴン（六角形）」青色路線番号マーク（sign_2.jpg 準拠）
    const rx = 40;
    const ry = 28;
    ctx.fillStyle = "#0369a1";
    ctx.beginPath();
    ctx.moveTo(x - rx * 0.6, y - ry);
    ctx.lineTo(x + rx * 0.6, y - ry);
    ctx.lineTo(x + rx, y);
    ctx.lineTo(x + rx * 0.6, y + ry);
    ctx.lineTo(x - rx * 0.6, y + ry);
    ctx.lineTo(x - rx, y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(routeNum, x, y + 9);
  }

  /**
   * 規制標識（最高速度 323: 丸型赤枠・青数字 + オプション補助標識）
   * How: 支柱に丸型赤枠・白地メッシュを配置し、Canvasで日本の標識数字を描画する。
   */
  public createSpeedLimitSign(
    x: number,
    z: number,
    limit = 50,
    auxiliaryText?: string,
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 支柱（丸型看板上端 y = 3.4 + 0.38 = 3.78m より低く止め、上から柱が突き出ないようにする）
    const pole = this.createPoleMesh(3.62);
    group.add(pole);

    // 丸型看板
    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.4, 0);

    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    // Why not CylinderGeometry を rotateX(Math.PI / 2) したキャップ面に直接 CanvasTexture を貼るか:
    // Three.js の CylinderGeometry キャップ UV は角度 θ=0 (+X/+Z) 起点の極座標展開になっているため、
    // rotateX(Math.PI / 2) で正面に向けると文字「40」「50」が 90度横倒し＆鏡文字に反転してしまう。
    // そのため他の丸型規制標識と同様に、正立 UV を持つ PlaneGeometry(0.72, 0.72) を z = +0.02 に配置して描画する。
    let tex: THREE.Texture | undefined;
    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = ctx !== null;
      if (hasCtx) {
        // 白外縁
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(128, 128, 122, 0, Math.PI * 2);
        ctx!.fill();

        // 赤規制リング
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.arc(128, 128, 116, 0, Math.PI * 2);
        ctx!.fill();

        // 中央の白円
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(128, 128, 86, 0, Math.PI * 2);
        ctx!.fill();

        // 最高速度の青数字（正立・水平）
        ctx!.fillStyle = "#00428a";
        ctx!.font = "bold 108px 'Helvetica Neue', Arial, sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(`${limit}`, 128, 132);

        tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
      }
    }

    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex ?? null,
      transparent: true,
      alphaTest: 0.5,
      roughness: 0.4,
    });
    this.applyRoadSign3DTexture(faceMat, "sign-face");
    const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), faceMat);
    facePlane.name = "SpeedLimitSignFace";
    facePlane.position.z = 0.02;
    signGroup.add(facePlane);

    this.addBackMountingRibs(signGroup, 0.44);

    const hasAux = Boolean(auxiliaryText);
    if (hasAux) {
      const auxPlate = this.createAuxiliaryPlate(auxiliaryText!);
      auxPlate.position.set(0, -0.52, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);
    return group;
  }

  /**
   * 8. 規制標識: 「駐車禁止」(316) / 「駐停車禁止」(315) + 補助標識プレート
   * How: 赤枠・青地丸板に斜め赤線（駐車禁止は1本、駐停車禁止はX字2本）を描画し、下部に補助標識を添える。
   */
  public createNoParkingSign(
    x: number,
    z: number,
    isNoStopping = false,
    auxiliaryText = "終日",
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 丸型看板上端 (y = 3.35 + 0.38 = 3.73m) より下で支柱を止める
    const pole = this.createPoleMesh(3.58);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.35, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 白外縁
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(128, 128, 122, 0, Math.PI * 2);
        ctx!.fill();

        // 赤リング
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.arc(128, 128, 116, 0, Math.PI * 2);
        ctx!.fill();

        // 内部の青円
        ctx!.fillStyle = "#1d4ed8";
        ctx!.beginPath();
        ctx!.arc(128, 128, 86, 0, Math.PI * 2);
        ctx!.fill();

        // 斜め赤スラッシュ（左上→右下）
        ctx!.strokeStyle = "#dc2626";
        ctx!.lineWidth = 24;
        ctx!.beginPath();
        ctx!.moveTo(56, 56);
        ctx!.lineTo(200, 200);
        ctx!.stroke();

        // 駐停車禁止（315）の場合は右上→左下の斜線も追加
        if (isNoStopping) {
          ctx!.beginPath();
          ctx!.moveTo(200, 56);
          ctx!.lineTo(56, 200);
          ctx!.stroke();
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.45,
      });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, 0.44);

    const hasAux = Boolean(auxiliaryText);
    if (hasAux) {
      const auxPlate = this.createAuxiliaryPlate(auxiliaryText);
      auxPlate.position.set(0, -0.52, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);
    return group;
  }

  /**
   * 9. 規制標識: 「転回禁止」(313: Uターン禁止) + 補助標識
   * How: 白地・赤枠丸板に黒のUターン矢印と赤スラッシュを描画する。
   */
  public createNoUTurnSign(x: number, z: number, auxiliaryText = "終日"): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 丸型看板上端 (y = 3.35 + 0.38 = 3.73m) より下で支柱を止める
    const pole = this.createPoleMesh(3.58);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.35, 0);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        // 赤外枠
        ctx!.fillStyle = "#dc2626";
        ctx!.beginPath();
        ctx!.arc(128, 128, 118, 0, Math.PI * 2);
        ctx!.fill();

        // 内部白円
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(128, 128, 90, 0, Math.PI * 2);
        ctx!.fill();

        // 黒Uターン矢印
        ctx!.strokeStyle = "#18181b";
        ctx!.lineWidth = 18;
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(156, 185);
        ctx!.lineTo(156, 108);
        ctx!.arc(128, 108, 28, 0, Math.PI, true);
        ctx!.lineTo(100, 155);
        ctx!.stroke();

        // 矢尻
        ctx!.fillStyle = "#18181b";
        ctx!.beginPath();
        ctx!.moveTo(100, 185);
        ctx!.lineTo(78, 148);
        ctx!.lineTo(122, 148);
        ctx!.closePath();
        ctx!.fill();

        // 赤禁止スラッシュ
        ctx!.strokeStyle = "#dc2626";
        ctx!.lineWidth = 22;
        ctx!.beginPath();
        ctx!.moveTo(58, 58);
        ctx!.lineTo(198, 198);
        ctx!.stroke();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.45,
      });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 24);
    backGeo.rotateX(Math.PI / 2);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, 0.44);

    const hasAux = Boolean(auxiliaryText);
    if (hasAux) {
      const auxPlate = this.createAuxiliaryPlate(auxiliaryText);
      auxPlate.position.set(0, -0.52, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);
    return group;
  }

  /**
   * 10. 規制標識: 「一方通行」(326-A: 青長方形に白太矢印)
   */
  public createOneWaySign(x: number, z: number, auxiliaryText = "自転車を除く"): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 看板上端 (y = 3.25 + 0.21 = 3.46m) より下で支柱を止める
    const pole = this.createPoleMesh(3.34);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.25, 0);

    const width = 0.95;
    const height = 0.42;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = 168;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#1d4ed8";
        ctx!.fillRect(0, 0, 384, 168);

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(6, 6, 372, 156);

        // 左向き白太矢印
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(110, 64, 220, 40);
        ctx!.beginPath();
        ctx!.moveTo(42, 84);
        ctx!.lineTo(122, 34);
        ctx!.lineTo(122, 134);
        ctx!.closePath();
        ctx!.fill();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(width, height, 0.02);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, width * 0.78);

    const hasAux = Boolean(auxiliaryText);
    if (hasAux) {
      const auxPlate = this.createAuxiliaryPlate(auxiliaryText);
      auxPlate.position.set(0, -0.38, 0);
      signGroup.add(auxPlate);
    }

    group.add(signGroup);
    return group;
  }

  /**
   * 11. 規制標識: 「進行方向別通行区分」(327の7: 交差点手前の車線別進行方向表示板)
   * How: 道路交通法第35条第1項および標識令（327の7）に準拠し、
   * 実際の片側車線数（lanesPerDirection = 2 または 3）と路面進行方向矢印（RoadMarkings.createLaneArrowMarking）に一致させて
   * 2車線時は「直進・左折 ｜ 右折」、3車線時は「直進・左折 ｜ 直進 ｜ 右折」を描画する。
   */
  public createLaneDirectionSign(x: number, z: number, lanesPerDirection = 2): THREE.Group {
    const group = new THREE.Group();
    const resolvedLanes = lanesPerDirection >= 3 ? 3 : 2;
    group.name = `LaneDirectionSign_${resolvedLanes}Lanes`;
    group.userData.lanesPerDirection = resolvedLanes;
    group.position.set(x, 0, z);

    // 看板上端 (y = 3.85 + 0.575 = 4.425m) より下で支柱を止める
    const pole = this.createPoleMesh(4.28);
    group.add(pole);

    const signGroup = new THREE.Group();
    signGroup.position.set(0, 3.85, 0);

    const width = 1.65;
    const height = 1.15;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#00428a";
        ctx!.fillRect(0, 0, 512, 360);

        ctx!.strokeStyle = "#ffffff";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(8, 8, 496, 344);

        const isThreeLane = resolvedLanes >= 3;
        if (isThreeLane) {
          // 3車線区切り破線（2本：左レーン＝直進＋左折、中央レーン＝直進、右レーン＝右折）
          ctx!.setLineDash([22, 16]);
          ctx!.lineWidth = 8;
          for (const divX of [170, 342]) {
            ctx!.beginPath();
            ctx!.moveTo(divX, 24);
            ctx!.lineTo(divX, 336);
            ctx!.stroke();
          }
          ctx!.setLineDash([]);

          // 左レーン: 直進＋左折
          this.drawArrow(ctx!, 105, 300, 105, 75, "#ffffff", 16);
          this.drawTurnArrowLeft(ctx!, 105, 210, 42, 140, "#ffffff");

          // 中央レーン: 直進
          this.drawArrow(ctx!, 256, 300, 256, 75, "#ffffff", 20);

          // 右レーン: 右折専用
          this.drawTurnArrow(ctx!, 400, 300, 470, 145, "#ffffff");
        } else {
          // 2車線区切り破線（中央1本：左レーン＝直進＋左折、右レーン＝右折専用）
          ctx!.setLineDash([22, 16]);
          ctx!.lineWidth = 8;
          ctx!.beginPath();
          ctx!.moveTo(256, 24);
          ctx!.lineTo(256, 336);
          ctx!.stroke();
          ctx!.setLineDash([]);

          // 左レーン: 直進＋左折
          this.drawArrow(ctx!, 148, 300, 148, 75, "#ffffff", 18);
          this.drawTurnArrowLeft(ctx!, 148, 210, 68, 140, "#ffffff");

          // 右レーン: 右折専用
          this.drawTurnArrow(ctx!, 354, 300, 434, 145, "#ffffff");
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.name = "LaneDirectionSignFace";
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(width, height, 0.03);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    this.addBackMountingRibs(signGroup, width * 0.82);

    group.add(signGroup);
    return group;
  }

  /**
   * 12. 案内標識: 「交差点名標識（地点名標識 114-A）」
   * How: 信号機横や交差点角に設置される白地・青枠・青文字の交差点名プレート。
   */
  public createIntersectionNameSign(
    x: number,
    z: number,
    nameJa = "和田倉門",
    nameEn = "Wadakuramon",
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 看板上端 (y = 3.85 + 0.21 = 4.06m) より下で支柱を止める
    const pole = this.createPoleMesh(3.94);
    group.add(pole);

    const board = this.createIntersectionNamePlateMesh(nameJa, nameEn);
    board.position.set(0, 3.85, 0);
    this.addBackMountingRibs(board, 0.96);
    group.add(board);

    return group;
  }

  /**
   * 信号機アームにも取り付け可能な交差点名プレート単体メッシュ
   */
  public createIntersectionNamePlateMesh(
    nameJa = "行幸通り前",
    nameEn = "Gyoko-dori",
  ): THREE.Group {
    const signGroup = new THREE.Group();
    const width = 1.25;
    const height = 0.42;

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 172;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(0, 0, 512, 172);

        ctx!.strokeStyle = "#00428a";
        ctx!.lineWidth = 10;
        ctx!.strokeRect(8, 8, 496, 156);

        ctx!.fillStyle = "#00428a";
        ctx!.textAlign = "center";
        ctx!.font = "bold 52px sans-serif";
        ctx!.fillText(nameJa, 256, 76);
        ctx!.font = "bold 28px sans-serif";
        ctx!.fillText(nameEn, 256, 132);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      plane.position.z = 0.02;
      signGroup.add(plane);
    }

    const backGeo = new THREE.BoxGeometry(width, height, 0.02);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    signGroup.add(back);

    return signGroup;
  }

  /**
   * 13. 安全施設: 「視線誘導標（デリネーター）＆ 障害物表示ゼブラ標示板」
   * How: 中央分離帯端や交差点コーナーに設置される黄黒ゼブラ反射板とオレンジ反射器。
   */
  public createDelineatorPost(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 支柱（高さ1.22m）
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.22, 10);
    const pole = new THREE.Mesh(poleGeo, this.poleMat);
    pole.name = "DelineatorPole";
    pole.position.y = 0.61;
    group.add(pole);

    // 黄黒ゼブラ警戒板（幅0.26m, 高さ0.75m）＋ 裏板
    const zebraWidth = 0.26;
    const zebraHeight = 0.75;
    const zebraBack = new THREE.Mesh(
      new THREE.BoxGeometry(zebraWidth, zebraHeight, 0.016),
      this.signBackMat,
    );
    zebraBack.position.set(0, 0.68, 0.04);
    group.add(zebraBack);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 384;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#facc15";
        ctx!.fillRect(0, 0, 128, 384);

        ctx!.fillStyle = "#18181b";
        for (let y = -128; y < 384; y += 64) {
          ctx!.beginPath();
          ctx!.moveTo(0, y);
          ctx!.lineTo(128, y + 64);
          ctx!.lineTo(128, y + 96);
          ctx!.lineTo(0, y + 32);
          ctx!.closePath();
          ctx!.fill();
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissive: 0xd97706,
        emissiveMap: tex,
        emissiveIntensity: 0.45,
        roughness: 0.16,
        metalness: 0.32,
      });
      applyRoadProp3DTexture(mat, "retroreflector");
      const front = new THREE.Mesh(new THREE.PlaneGeometry(zebraWidth, zebraHeight), mat);
      front.name = "DelineatorZebraRetroPlate";
      front.position.set(0, 0.68, 0.05);
      group.add(front);
    } else {
      const fallbackMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xd97706,
        emissiveIntensity: 0.45,
        roughness: 0.16,
        metalness: 0.32,
      });
      applyRoadProp3DTexture(fallbackMat, "retroreflector");
      const front = new THREE.Mesh(new THREE.PlaneGeometry(zebraWidth, zebraHeight), fallbackMat);
      front.name = "DelineatorZebraRetroPlate";
      front.position.set(0, 0.68, 0.05);
      group.add(front);
    }

    // 上部オレンジ再帰反射デリネーターレンズ（支柱上端にブラケット一体で固定）
    const reflectorHousingGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.036, 16);
    reflectorHousingGeo.rotateX(Math.PI / 2);
    const reflectorHousing = new THREE.Mesh(reflectorHousingGeo, this.signBackMat);
    reflectorHousing.position.set(0, 1.18, 0.02);
    group.add(reflectorHousing);

    const reflectorGeo = new THREE.CylinderGeometry(0.088, 0.088, 0.042, 16);
    reflectorGeo.rotateX(Math.PI / 2);
    const reflector = new THREE.Mesh(reflectorGeo, this.delineatorRetroMat);
    reflector.name = "DelineatorTopRetroLens";
    reflector.position.set(0, 1.18, 0.024);
    group.add(reflector);

    return group;
  }

  /**
   * 補助標識プレート（501〜510系: 本標識の下に付く白長方形プレート）
   */
  public createAuxiliaryPlate(text: string): THREE.Group {
    const auxGroup = new THREE.Group();
    const width = 0.62;
    const height = 0.22;

    const backGeo = new THREE.BoxGeometry(width, height, 0.015);
    const back = new THREE.Mesh(backGeo, this.signBackMat);
    auxGroup.add(back);

    const clampGeo = new THREE.BoxGeometry(0.11, 0.04, 0.065);
    const clamp = new THREE.Mesh(clampGeo, this.poleMat);
    clamp.position.set(0, 0, -0.045);
    auxGroup.add(clamp);

    const hasDocument = typeof document !== "undefined";
    if (hasDocument) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      const hasCtx = Boolean(ctx);
      if (hasCtx) {
        ctx!.fillStyle = "#ffffff";
        ctx!.fillRect(0, 0, 256, 96);

        ctx!.strokeStyle = "#334155";
        ctx!.lineWidth = 4;
        ctx!.strokeRect(4, 4, 248, 88);

        ctx!.fillStyle = "#1e293b";
        ctx!.font = "bold 36px sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(text, 128, 48);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
      this.applyRoadSign3DTexture(mat, "sign-face");
      const front = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      front.position.z = 0.012;
      auxGroup.add(front);
    }

    return auxGroup;
  }
}

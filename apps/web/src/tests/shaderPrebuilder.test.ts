import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildUrlWithBoostOption,
  hasBoostPathSegment,
  parseBoostOption,
  prebuildSceneShaders,
  type ShaderCompileRenderer,
} from "../core/shaderPrebuilder";

describe("ShaderPrebuilder (/boost オプション & シェーダー事前プリビルド)", () => {
  it("pathname に /boost セグメントが含まれるかを大文字小文字やベースパスを問わず判定できることを保証する", () => {
    expect(hasBoostPathSegment("/boost")).toBe(true);
    expect(hasBoostPathSegment("/boost/")).toBe(true);
    expect(hasBoostPathSegment("/BOOST")).toBe(true);
    expect(hasBoostPathSegment("/antigravity-deep-drive/boost")).toBe(true);
    expect(hasBoostPathSegment("/antigravity-deep-drive/boost/")).toBe(true);

    expect(hasBoostPathSegment("/")).toBe(false);
    expect(hasBoostPathSegment("")).toBe(false);
    expect(hasBoostPathSegment("/antigravity-deep-drive/")).toBe(false);
    expect(hasBoostPathSegment("/booster")).toBe(false);
    expect(hasBoostPathSegment("/boost-mode")).toBe(false);
  });

  it("URL パス (/boost)、クエリ (?boost=1 / ?boost=0 / ?boost)、ハッシュ (#boost / #/boost) から /boost オプションを優先順位通りに解決できることを保証する", () => {
    // 1. パス指定
    expect(parseBoostOption({ pathname: "/boost" })).toBe(true);
    expect(parseBoostOption({ pathname: "/antigravity-deep-drive/boost/" })).toBe(true);

    // 2. クエリパラメータ指定
    expect(parseBoostOption({ pathname: "/", search: "?boost=1" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "?boost=true" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "?boost=on" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "?boost=yes" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "?boost" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "?area=shibuya&boost=" })).toBe(true);

    // 3. 明示的無効化クエリは /boost パスより優先して false になること
    expect(parseBoostOption({ pathname: "/boost", search: "?boost=0" })).toBe(false);
    expect(parseBoostOption({ pathname: "/boost", search: "?boost=false" })).toBe(false);
    expect(parseBoostOption({ pathname: "/boost", search: "?boost=off" })).toBe(false);
    expect(parseBoostOption({ pathname: "/boost", search: "?boost=no" })).toBe(false);

    // 4. ハッシュ指定 (#boost, #/boost, #boost=1, #boost=0 等)
    expect(parseBoostOption({ pathname: "/", search: "", hash: "#boost" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "", hash: "#/boost" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "", hash: "#section/boost" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "", hash: "#boost=1" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "", hash: "#boost=true" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "", hash: "#shaderBoost=1" })).toBe(true);
    expect(parseBoostOption({ pathname: "/boost", search: "", hash: "#boost=0" })).toBe(false);
    expect(parseBoostOption({ pathname: "/boost", search: "", hash: "#boost=false" })).toBe(false);

    // 5. 未指定および不正値フォールバック
    expect(parseBoostOption({ pathname: "/", search: "", hash: "" })).toBe(false);
    expect(parseBoostOption({ pathname: "/", search: "?area=tokyo", hash: "#top" })).toBe(false);
    expect(parseBoostOption({ pathname: "/boost", search: "?boost=invalid" })).toBe(true);
    expect(parseBoostOption({ pathname: "/", search: "?boost=invalid" })).toBe(false);
  });

  it("buildUrlWithBoostOption が既存のクエリパラメータやハッシュを保持したまま boost 状態を反映した相対 URL を生成することを保証する", () => {
    // ルートパスで ON にした場合: ?boost=1 が付与される
    expect(
      buildUrlWithBoostOption(
        { pathname: "/", search: "?area=shibuya&graphics=high", hash: "" },
        true,
      ),
    ).toBe("/?area=shibuya&graphics=high&boost=1");

    // 既に /boost パスにいる状態で ON にした場合: 重複して ?boost=1 を付けずクリーンに保つ
    expect(
      buildUrlWithBoostOption({ pathname: "/boost", search: "?area=shibuya", hash: "" }, true),
    ).toBe("/boost?area=shibuya");

    // /boost パスから OFF にした場合: パス末尾の /boost が除去され ?boost も削除される
    expect(
      buildUrlWithBoostOption(
        { pathname: "/antigravity-deep-drive/boost", search: "?area=tokyo&boost=1", hash: "#hud" },
        false,
      ),
    ).toBe("/antigravity-deep-drive?area=tokyo#hud");

    // ルートパス + #boost / #boost=1 ハッシュから OFF にした場合: boost ハッシュもクリアされ parseBoostOption と往復整合すること
    expect(
      buildUrlWithBoostOption({ pathname: "/", search: "?boost=1", hash: "#/boost" }, false),
    ).toBe("/");
    const disabledFromHashKeyVal = buildUrlWithBoostOption(
      { pathname: "/", search: "?area=shibuya", hash: "#boost=1" },
      false,
    );
    expect(disabledFromHashKeyVal).toBe("/?area=shibuya");
    expect(parseBoostOption(disabledFromHashKeyVal)).toBe(false);

    // 無関係なハッシュは OFF にしても保持されること
    expect(
      buildUrlWithBoostOption({ pathname: "/boost/", search: "", hash: "#camera" }, false),
    ).toBe("/#camera");
  });

  it("prebuildSceneShaders が非表示メッシュや frustumCulled メッシュを一時的に全強制展開して compileAsync を呼び、完了後に元の可視性・カリング設定を完全復元することを保証する", async () => {
    const scene = new THREE.Scene();

    const visibleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff0000 }),
    );
    visibleMesh.visible = true;
    visibleMesh.frustumCulled = true;
    scene.add(visibleMesh);

    // 距離カリングや雨パーティクル等で初期非表示になっているメッシュ
    const hiddenGroup = new THREE.Group();
    hiddenGroup.visible = false;
    const hiddenChildMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
    );
    hiddenChildMesh.visible = false;
    hiddenChildMesh.frustumCulled = true;
    hiddenGroup.add(hiddenChildMesh);
    scene.add(hiddenGroup);

    // 配列マテリアルを持つメッシュ
    const sharedMat = visibleMesh.material;
    const multiMatMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
      sharedMat,
      new THREE.ShaderMaterial(),
    ]);
    multiMatMesh.visible = true;
    multiMatMesh.frustumCulled = false;
    scene.add(multiMatMesh);

    const mainCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    const rearCamera = new THREE.PerspectiveCamera(50, 2, 0.1, 500);
    const postPassMat1 = new THREE.ShaderMaterial();
    const postPassMat2 = new THREE.ShaderMaterial();

    const compileCalls: Array<{
      targetScene: THREE.Object3D;
      cameraUuid: string;
      allVisibleDuringCompile: boolean;
      allUnCulledDuringCompile: boolean;
    }> = [];

    const mockRenderer: ShaderCompileRenderer = {
      compile: () => {},
      compileAsync: async (targetScene: THREE.Object3D, camera: THREE.Camera) => {
        let allVisible = true;
        let allUnCulled = true;
        targetScene.traverse((obj) => {
          if (!obj.visible) allVisible = false;
          if (obj.frustumCulled) allUnCulled = false;
        });
        compileCalls.push({
          targetScene,
          cameraUuid: camera.uuid,
          allVisibleDuringCompile: allVisible,
          allUnCulledDuringCompile: allUnCulled,
        });
      },
    };

    const report = await prebuildSceneShaders({
      renderer: mockRenderer,
      scene,
      cameras: [mainCamera, rearCamera],
      postProcessPasses: [{ material: postPassMat1 }, { material: postPassMat2 }],
    });

    // 1. レポート統計の検証
    expect(report.usedAsyncCompile).toBe(true);
    expect(report.compiledCamerasCount).toBe(2);
    expect(report.compiledPostProcessCount).toBe(2);
    expect(report.temporarilyRevealedObjectsCount).toBe(2); // hiddenGroup と hiddenChildMesh
    expect(report.compiledMaterialsCount).toBe(5); // Standard, Basic, Shader(mesh), postPass1, postPass2
    expect(report.durationMs).toBeGreaterThanOrEqual(0);

    // 2. コンパイル実行中は全オブジェクトが visible=true かつ frustumCulled=false になっていたこと
    // メインシーン x 2カメラ + ポストプロセス用シーン x 1 = 計3回
    expect(compileCalls.length).toBe(3);
    for (const call of compileCalls) {
      expect(call.allVisibleDuringCompile).toBe(true);
      expect(call.allUnCulledDuringCompile).toBe(true);
    }

    // 3. 完了後に各オブジェクトの visible / frustumCulled が元の値へ厳密に復元されていること
    expect(visibleMesh.visible).toBe(true);
    expect(visibleMesh.frustumCulled).toBe(true);
    expect(hiddenGroup.visible).toBe(false);
    expect(hiddenChildMesh.visible).toBe(false);
    expect(hiddenChildMesh.frustumCulled).toBe(true);
    expect(multiMatMesh.visible).toBe(true);
    expect(multiMatMesh.frustumCulled).toBe(false);
  });

  it("非表示ライト (SpotLight) が存在する場合に昼間(OFF)と夜間(ON)の2バリアントを両方コンパイルし、かつ permanentlyHiddenByGlb オブジェクトや非同期中の外部 visible 変更を保護することを保証する", async () => {
    const scene = new THREE.Scene();

    const activeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    scene.add(activeMesh);

    // GLB ロード完了によって恒久的に非表示化されたプロシージャルフォールバックグループ
    const glbHiddenGroup = new THREE.Group();
    glbHiddenGroup.visible = false;
    glbHiddenGroup.userData.permanentlyHiddenByGlb = true;
    const glbHiddenChild = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    glbHiddenGroup.add(glbHiddenChild);
    scene.add(glbHiddenGroup);

    // 非同期コンパイル中に外部コールバックで visible=false に切り替えられるオブジェクト
    const asyncHiddenLaterMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    asyncHiddenLaterMesh.visible = true;
    scene.add(asyncHiddenLaterMesh);

    // 昼間は visible = false になっている車両ヘッドライト SpotLight
    const headSpotLight = new THREE.SpotLight(0xffffff, 10);
    headSpotLight.visible = false;
    scene.add(headSpotLight);

    // 初回描画前で tColor / tDepth が null のポストプロセスマテリアル
    const postMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uIntensity: { value: 0.5 },
      },
    });

    const recordedSpotLightStates: boolean[] = [];
    let glbFallbackWasEverVisible = false;
    let postPassHadBoundTexturesDuringCompile = false;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const mockRenderer: ShaderCompileRenderer = {
      compileAsync: async (targetScene: THREE.Object3D) => {
        if (targetScene === scene) {
          recordedSpotLightStates.push(headSpotLight.visible);
          if (glbHiddenGroup.visible) {
            glbFallbackWasEverVisible = true;
          }
          // 1回目の非同期コンパイル中に外部から visible = false に変更されたケースをシミュレート
          asyncHiddenLaterMesh.visible = false;
        } else {
          // ポストプロセスシーンのコンパイル時: null だったテクスチャユニフォームに一時ダミーテクスチャが入っていること
          postPassHadBoundTexturesDuringCompile =
            postMat.uniforms.tColor.value instanceof THREE.DataTexture &&
            postMat.uniforms.tDepth.value instanceof THREE.DataTexture;
        }
      },
    };

    const report = await prebuildSceneShaders({
      renderer: mockRenderer,
      scene,
      cameras: [camera],
      postProcessPasses: [{ material: postMat }],
    });

    // 第1パス(SpotLight OFF) + 第2パス(SpotLight ON) の両方がコンパイルされていること
    expect(recordedSpotLightStates).toEqual([false, true]);
    expect(report.compiledScenesCount).toBe(3); // メインシーン x 2 (ライトOFF/ON) + ポストプロセス x 1

    // GLB で恒久非表示化されたフォールバックグループは一度も可視化されないこと
    expect(glbFallbackWasEverVisible).toBe(false);
    expect(glbHiddenGroup.visible).toBe(false);

    // 非同期コンパイル中に外部が visible = false に変更したオブジェクトが finally で true に上書きされないこと
    expect(asyncHiddenLaterMesh.visible).toBe(false);

    // 完了後に SpotLight の元の状態 (false) とポストプロセスの null ユニフォームが復元されていること
    expect(headSpotLight.visible).toBe(false);
    expect(postPassHadBoundTexturesDuringCompile).toBe(true);
    expect(postMat.uniforms.tColor.value).toBeNull();
    expect(postMat.uniforms.tDepth.value).toBeNull();
    expect(postMat.uniforms.uIntensity.value).toBe(0.5);
  });

  it("compileAsync 非対応または失敗時に同期 compile へフォールバックし、例外発生時にもオブジェクト状態が復元されることを保証する", async () => {
    const scene = new THREE.Scene();
    const hiddenMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    hiddenMesh.visible = false;
    hiddenMesh.frustumCulled = true;
    scene.add(hiddenMesh);

    const camera = new THREE.PerspectiveCamera();
    let syncCompileCount = 0;

    // compileAsync が reject しても同期 compile にフォールバックして完走すること
    const fallbackRenderer: ShaderCompileRenderer = {
      compile: () => {
        syncCompileCount += 1;
      },
      compileAsync: async () => {
        throw new Error("KHR_parallel_shader_compile failed");
      },
    };

    const report = await prebuildSceneShaders({
      renderer: fallbackRenderer,
      scene,
      cameras: [camera],
      postProcessPasses: [],
    });

    expect(report.usedAsyncCompile).toBe(false);
    expect(syncCompileCount).toBe(1);
    expect(hiddenMesh.visible).toBe(false);
    expect(hiddenMesh.frustumCulled).toBe(true);

    // 同期 compile 自体が例外を投げた場合でも finally で visible / frustumCulled が復元されること
    const throwingRenderer: ShaderCompileRenderer = {
      compile: () => {
        throw new Error("Fatal WebGL context lost");
      },
    };

    await expect(
      prebuildSceneShaders({
        renderer: throwingRenderer,
        scene,
        cameras: [camera],
      }),
    ).rejects.toThrow("Fatal WebGL context lost");

    expect(hiddenMesh.visible).toBe(false);
    expect(hiddenMesh.frustumCulled).toBe(true);
  });
});

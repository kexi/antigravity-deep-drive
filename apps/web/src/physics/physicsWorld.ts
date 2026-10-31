import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Rapier 3D 物理ワールド管理
 */
export class PhysicsWorld {
  private static instance: PhysicsWorld | null = null;
  public world!: RAPIER.World;
  public rapier!: typeof RAPIER;
  private initialized = false;

  public static async getInstance(): Promise<PhysicsWorld> {
    if (PhysicsWorld.instance) {
      return PhysicsWorld.instance;
    }
    const inst = new PhysicsWorld();
    await inst.init();
    PhysicsWorld.instance = inst;
    return inst;
  }

  private async init(): Promise<void> {
    await RAPIER.init();
    this.rapier = RAPIER;
    const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
    this.world = new RAPIER.World(gravity);
    this.initialized = true;
  }

  public step(deltaTime: number): void {
    const isReady = this.initialized && this.world !== undefined;
    if (!isReady) {
      return;
    }
    // 安定した物理更新のためdtをクランプ
    const fixedTimeStep = Math.min(deltaTime, 0.033);
    this.world.timestep = fixedTimeStep;
    this.world.step();
  }
}

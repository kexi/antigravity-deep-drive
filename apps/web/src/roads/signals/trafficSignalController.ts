import {
  IntersectionTimingConfigSchema,
  type IntersectionTimingConfig,
  type PedestrianSignalAspect,
  type SignalAxisGroup,
  type TrafficSignalHandle,
  type VehicleSignalAspect,
} from "./signalSchema";

export interface EvaluatedIntersectionAspects {
  phaseName: string;
  axisA: { vehicle: VehicleSignalAspect; pedestrian: PedestrianSignalAspect };
  axisB: { vehicle: VehicleSignalAspect; pedestrian: PedestrianSignalAspect };
  scramblePedestrian: PedestrianSignalAspect;
  pedBlinkLit: boolean;
}

interface ManagedIntersectionGroup {
  intersectionId: string;
  timing: IntersectionTimingConfig;
  isScramble: boolean;
  handles: TrafficSignalHandle[];
  manualOverride: EvaluatedIntersectionAspects | null;
}

/**
 * 交差点単位のリアルタイム信号フェーズ制御エンジン（排他インターロック付き）。
 *
 * How:
 * - 各交差点の「主軸 (axis_a)」「交差軸 (axis_b)」「スクランブル歩行者フェーズ」を単一時計から評価し、
 *   全赤クリアランス（allRedSec）を挟むことで、直交 2 方向が同時に青／黄／右折矢印になる衝突を数学的にゼロにする。
 * - 青信号終了前の pedBlinkSec 間は歩行者青を 2Hz で点滅させ、右折矢印装備交差点では
 *   赤＋右折青矢印（red_right_arrow）フェーズを実行する（青＋矢印の違法同時点灯は一切発生しない）。
 * - 毎フレームの update(dt) はフェーズ変化時のみマテリアル参照を差し替えるため O(1)・ゼロアロケーション。
 */
export class TrafficSignalController {
  private readonly groups = new Map<string, ManagedIntersectionGroup>();
  private elapsedSeconds = 0;
  private isPaused = false;

  public registerSignal(
    handle: TrafficSignalHandle,
    options?: {
      isScramble?: boolean;
      timing?: Partial<IntersectionTimingConfig>;
    },
  ): void {
    const id = handle.intersectionId;
    let group = this.groups.get(id);
    if (!group) {
      const isScramble = Boolean(options?.isScramble);
      const timing = IntersectionTimingConfigSchema.parse({
        greenSec: 16,
        pedBlinkSec: 4,
        yellowSec: 3,
        allRedSec: 2,
        rightArrowSec: handle.hasArrowUnit && !isScramble ? 5 : 0,
        scramblePedGreenSec: isScramble ? 14 : 0,
        phaseOffsetSec: 0,
        ...options?.timing,
      });
      group = {
        intersectionId: id,
        timing,
        isScramble,
        handles: [],
        manualOverride: null,
      };
      this.groups.set(id, group);
    } else if (handle.hasArrowUnit && !group.isScramble && group.timing.rightArrowSec === 0) {
      group.timing = { ...group.timing, rightArrowSec: 5 };
    }

    group.handles.push(handle);
    this.syncGroup(group, this.elapsedSeconds);
  }

  public getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  public setManualOverride(
    intersectionId: string,
    override: EvaluatedIntersectionAspects | null,
  ): boolean {
    const group = this.groups.get(intersectionId);
    if (!group) {
      return false;
    }
    group.manualOverride = override;
    this.syncGroup(group, this.elapsedSeconds);
    return true;
  }

  /**
   * 指定時刻における 1 交差点の主軸・交差軸・スクランブル歩行者フェーズを純粋関数として評価する。
   */
  public static evaluateCycleAt(
    timing: IntersectionTimingConfig,
    timeSec: number,
  ): EvaluatedIntersectionAspects {
    const arrowDur = timing.rightArrowSec;
    const arrowYellowDur = arrowDur > 0 ? Math.min(2, timing.yellowSec) : 0;
    const axisADur =
      timing.greenSec + timing.yellowSec + arrowDur + arrowYellowDur + timing.allRedSec;
    const scrambleDur =
      timing.scramblePedGreenSec > 0 ? timing.scramblePedGreenSec + timing.allRedSec : 0;
    const axisBDur =
      timing.greenSec + timing.yellowSec + arrowDur + arrowYellowDur + timing.allRedSec;
    const totalCycle = Math.max(1, axisADur + scrambleDur + axisBDur);

    const localT = (((timeSec + timing.phaseOffsetSec) % totalCycle) + totalCycle) % totalCycle;
    const pedBlinkLit = Math.floor(timeSec * 4) % 2 === 0; // 2Hz 点滅

    const evalPedDuringGreen = (inGreenT: number, greenDur: number): PedestrianSignalAspect => {
      const solidLimit = Math.max(2, greenDur - timing.pedBlinkSec);
      return inGreenT < solidLimit ? "green" : "green_blink";
    };

    // 1. Axis A フェーズ（主軸：青→黄→(赤+右折矢印→黄)→全赤 / 交差軸：常時赤）
    if (localT < axisADur) {
      if (localT < timing.greenSec) {
        return {
          phaseName: "axis_a_green",
          axisA: { vehicle: "green", pedestrian: evalPedDuringGreen(localT, timing.greenSec) },
          axisB: { vehicle: "red", pedestrian: "red" },
          scramblePedestrian: "red",
          pedBlinkLit,
        };
      }
      const afterGreen = localT - timing.greenSec;
      if (afterGreen < timing.yellowSec) {
        return {
          phaseName: "axis_a_yellow",
          axisA: { vehicle: "yellow", pedestrian: "red" },
          axisB: { vehicle: "red", pedestrian: "red" },
          scramblePedestrian: "red",
          pedBlinkLit,
        };
      }
      const afterYellow = afterGreen - timing.yellowSec;
      if (arrowDur > 0 && afterYellow < arrowDur) {
        return {
          phaseName: "axis_a_right_arrow",
          axisA: { vehicle: "red_right_arrow", pedestrian: "red" },
          axisB: { vehicle: "red", pedestrian: "red" },
          scramblePedestrian: "red",
          pedBlinkLit,
        };
      }
      if (arrowDur > 0 && afterYellow < arrowDur + arrowYellowDur) {
        return {
          phaseName: "axis_a_arrow_yellow",
          axisA: { vehicle: "yellow", pedestrian: "red" },
          axisB: { vehicle: "red", pedestrian: "red" },
          scramblePedestrian: "red",
          pedBlinkLit,
        };
      }
      return {
        phaseName: "all_red_a_to_b",
        axisA: { vehicle: "red", pedestrian: "red" },
        axisB: { vehicle: "red", pedestrian: "red" },
        scramblePedestrian: "red",
        pedBlinkLit,
      };
    }

    // 2. スクランブル交差点専用：全車両赤・全歩行者青フェーズ
    const afterA = localT - axisADur;
    if (scrambleDur > 0 && afterA < scrambleDur) {
      if (afterA < timing.scramblePedGreenSec) {
        const scrPed = evalPedDuringGreen(afterA, timing.scramblePedGreenSec);
        return {
          phaseName: "scramble_pedestrian_green",
          axisA: { vehicle: "red", pedestrian: scrPed },
          axisB: { vehicle: "red", pedestrian: scrPed },
          scramblePedestrian: scrPed,
          pedBlinkLit,
        };
      }
      return {
        phaseName: "scramble_all_red",
        axisA: { vehicle: "red", pedestrian: "red" },
        axisB: { vehicle: "red", pedestrian: "red" },
        scramblePedestrian: "red",
        pedBlinkLit,
      };
    }

    // 3. Axis B フェーズ（交差軸：青→黄→(赤+右折矢印→黄)→全赤 / 主軸：常時赤）
    const inB = afterA - scrambleDur;
    if (inB < timing.greenSec) {
      return {
        phaseName: "axis_b_green",
        axisA: { vehicle: "red", pedestrian: "red" },
        axisB: { vehicle: "green", pedestrian: evalPedDuringGreen(inB, timing.greenSec) },
        scramblePedestrian: "red",
        pedBlinkLit,
      };
    }
    const afterBGreen = inB - timing.greenSec;
    if (afterBGreen < timing.yellowSec) {
      return {
        phaseName: "axis_b_yellow",
        axisA: { vehicle: "red", pedestrian: "red" },
        axisB: { vehicle: "yellow", pedestrian: "red" },
        scramblePedestrian: "red",
        pedBlinkLit,
      };
    }
    const afterBYellow = afterBGreen - timing.yellowSec;
    if (arrowDur > 0 && afterBYellow < arrowDur) {
      return {
        phaseName: "axis_b_right_arrow",
        axisA: { vehicle: "red", pedestrian: "red" },
        axisB: { vehicle: "red_right_arrow", pedestrian: "red" },
        scramblePedestrian: "red",
        pedBlinkLit,
      };
    }
    if (arrowDur > 0 && afterBYellow < arrowDur + arrowYellowDur) {
      return {
        phaseName: "axis_b_arrow_yellow",
        axisA: { vehicle: "red", pedestrian: "red" },
        axisB: { vehicle: "yellow", pedestrian: "red" },
        scramblePedestrian: "red",
        pedBlinkLit,
      };
    }
    return {
      phaseName: "all_red_b_to_a",
      axisA: { vehicle: "red", pedestrian: "red" },
      axisB: { vehicle: "red", pedestrian: "red" },
      scramblePedestrian: "red",
      pedBlinkLit,
    };
  }

  private syncGroup(group: ManagedIntersectionGroup, timeSec: number): void {
    const state =
      group.manualOverride ?? TrafficSignalController.evaluateCycleAt(group.timing, timeSec);
    for (const h of group.handles) {
      const pair =
        h.axisGroup === "axis_b"
          ? state.axisB
          : h.axisGroup === "scramble_all"
            ? { vehicle: "red" as VehicleSignalAspect, pedestrian: state.scramblePedestrian }
            : state.axisA;

      const resolvedVehicle: VehicleSignalAspect =
        pair.vehicle === "red_right_arrow" && !h.hasArrowUnit ? "red" : pair.vehicle;

      const isUnchanged =
        h.currentVehicleAspect === resolvedVehicle &&
        h.currentPedAspect === pair.pedestrian &&
        (pair.pedestrian !== "green_blink" || h.currentPedBlinkLit === state.pedBlinkLit);
      if (isUnchanged) {
        continue;
      }
      h.applyAspect(resolvedVehicle, pair.pedestrian, state.pedBlinkLit);
    }
  }

  public update(deltaSeconds: number): void {
    if (this.isPaused || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      return;
    }
    this.elapsedSeconds += Math.min(deltaSeconds, 0.25);
    for (const group of this.groups.values()) {
      this.syncGroup(group, this.elapsedSeconds);
    }
  }

  public setElapsedSeconds(timeSec: number): void {
    this.elapsedSeconds = Math.max(0, timeSec);
    for (const group of this.groups.values()) {
      this.syncGroup(group, this.elapsedSeconds);
    }
  }

  public getAllSignalHandles(): TrafficSignalHandle[] {
    const all: TrafficSignalHandle[] = [];
    for (const group of this.groups.values()) {
      all.push(...group.handles);
    }
    return all;
  }

  public getIntersectionSummaries(): Array<{
    intersectionId: string;
    signalCount: number;
    isScramble: boolean;
    timing: IntersectionTimingConfig;
    currentState: EvaluatedIntersectionAspects;
    axes: SignalAxisGroup[];
  }> {
    const result: Array<{
      intersectionId: string;
      signalCount: number;
      isScramble: boolean;
      timing: IntersectionTimingConfig;
      currentState: EvaluatedIntersectionAspects;
      axes: SignalAxisGroup[];
    }> = [];
    for (const group of this.groups.values()) {
      const currentState =
        group.manualOverride ??
        TrafficSignalController.evaluateCycleAt(group.timing, this.elapsedSeconds);
      const axes = Array.from(new Set(group.handles.map((h) => h.axisGroup)));
      result.push({
        intersectionId: group.intersectionId,
        signalCount: group.handles.length,
        isScramble: group.isScramble,
        timing: group.timing,
        currentState,
        axes,
      });
    }
    return result;
  }
}

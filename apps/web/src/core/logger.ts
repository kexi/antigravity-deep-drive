import { z } from "zod";

/**
 * AIエージェントおよび開発者が grep / jq / 自動調査で処理横断トレースを行うための
 * Zod スキーマ検証付き構造化ロガー（1イベント1行 JSON 出力）。
 */
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const TraceContextSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  operation: z.string().min(1),
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

export const StructuredLogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  level: LogLevelSchema,
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  module: z.string().min(1),
  event: z.string().min(1),
  message: z.string().min(1),
  durationMs: z.number().nonnegative().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type StructuredLogEntry = z.infer<typeof StructuredLogEntrySchema>;

declare global {
  interface Window {
    __DEEP_DRIVE_LOGS__?: StructuredLogEntry[];
  }
}

export class StructuredLogger {
  private logs: StructuredLogEntry[] = [];
  private readonly maxBufferSize: number;
  private activeTrace: TraceContext;
  private spanCounter = 0;
  private consoleOutputEnabled: boolean;

  constructor(options?: { maxBufferSize?: number; consoleOutputEnabled?: boolean }) {
    this.maxBufferSize = options?.maxBufferSize ?? 500;
    this.consoleOutputEnabled = options?.consoleOutputEnabled ?? true;
    this.activeTrace = {
      traceId: this.generateId("trc"),
      spanId: this.generateId("spn"),
      operation: "session.root",
    };
    this.syncBrowserGlobal();
  }

  /**
   * 一意で時系列ソート・grep しやすいプレフィックス付きIDを生成する。
   * How: タイムスタンプ36進数表現とカウンタを組み合わせて衝突しない識別子を作る。
   */
  private generateId(prefix: "trc" | "spn"): string {
    this.spanCounter += 1;
    const timePart = Date.now().toString(36);
    const countPart = this.spanCounter.toString(36).padStart(4, "0");
    return `${prefix}_${timePart}_${countPart}`;
  }

  private syncBrowserGlobal(): void {
    const isMissingWindow = typeof window === "undefined";
    if (isMissingWindow) {
      return;
    }
    window.__DEEP_DRIVE_LOGS__ = this.logs;
  }

  /**
   * 現在のアクティブな TraceContext を取得する。
   */
  public getActiveTrace(): TraceContext {
    return { ...this.activeTrace };
  }

  /**
   * 新しいトレース（または親トレースを引き継いだ子スパン）を開始する。
   * How: inheritTrace=true の場合は現在の traceId を維持し parentSpanId に現 spanId を設定する。
   */
  public startTrace(
    operation: string,
    options?: { inheritTrace?: boolean; parentTrace?: TraceContext },
  ): TraceContext {
    const baseTrace = options?.parentTrace ?? this.activeTrace;
    const shouldInherit = options?.inheritTrace ?? false;
    const nextTrace: TraceContext = TraceContextSchema.parse({
      traceId: shouldInherit ? baseTrace.traceId : this.generateId("trc"),
      spanId: this.generateId("spn"),
      parentSpanId: shouldInherit ? baseTrace.spanId : undefined,
      operation,
    });
    this.activeTrace = nextTrace;
    return nextTrace;
  }

  /**
   * 同期処理に traceId / spanId を伝播させて実行し、開始・完了・所要時間を記録する。
   */
  public withTrace<T>(
    module: string,
    event: string,
    fn: (trace: TraceContext) => T,
    initialData?: Record<string, unknown>,
  ): T {
    const previousTrace = this.activeTrace;
    const trace = this.startTrace(`${module}.${event}`, {
      inheritTrace: true,
      parentTrace: previousTrace,
    });
    const startMs = performance.now();

    try {
      const result = fn(trace);
      const durationMs = Number((performance.now() - startMs).toFixed(3));
      this.info(module, event, `${module}.${event} completed`, initialData ?? {}, {
        trace,
        durationMs,
      });
      return result;
    } catch (error) {
      const durationMs = Number((performance.now() - startMs).toFixed(3));
      this.error(
        module,
        `${event}.error`,
        error instanceof Error ? error.message : String(error),
        { ...initialData, errorName: error instanceof Error ? error.name : "UnknownError" },
        { trace, durationMs },
      );
      throw error;
    } finally {
      this.activeTrace = previousTrace;
    }
  }

  /**
   * 非同期処理に traceId / spanId を伝播させて実行し、所要時間を構造化ログに記録する。
   */
  public async withAsyncTrace<T>(
    module: string,
    event: string,
    fn: (trace: TraceContext) => Promise<T>,
    initialData?: Record<string, unknown>,
  ): Promise<T> {
    const previousTrace = this.activeTrace;
    const trace = this.startTrace(`${module}.${event}`, {
      inheritTrace: true,
      parentTrace: previousTrace,
    });
    const startMs = performance.now();

    try {
      const result = await fn(trace);
      const durationMs = Number((performance.now() - startMs).toFixed(3));
      this.info(module, event, `${module}.${event} completed`, initialData ?? {}, {
        trace,
        durationMs,
      });
      return result;
    } catch (error) {
      const durationMs = Number((performance.now() - startMs).toFixed(3));
      this.error(
        module,
        `${event}.error`,
        error instanceof Error ? error.message : String(error),
        { ...initialData, errorName: error instanceof Error ? error.name : "UnknownError" },
        { trace, durationMs },
      );
      throw error;
    } finally {
      this.activeTrace = previousTrace;
    }
  }

  /**
   * Zod スキーマでログエントリを検証し、1イベント1行の JSON として出力・保存する。
   */
  public log(
    level: LogLevel,
    module: string,
    event: string,
    message: string,
    data: Record<string, unknown> = {},
    options?: { trace?: TraceContext; durationMs?: number },
  ): StructuredLogEntry {
    const trace = options?.trace ?? this.activeTrace;
    const rawEntry = {
      timestamp: new Date().toISOString(),
      level,
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
      module,
      event,
      message,
      durationMs: options?.durationMs,
      data,
    };

    const validatedEntry = StructuredLogEntrySchema.parse(rawEntry);
    this.logs.push(validatedEntry);

    const isOverflow = this.logs.length > this.maxBufferSize;
    if (isOverflow) {
      this.logs.shift();
    }
    this.syncBrowserGlobal();

    const shouldLogToConsole = this.consoleOutputEnabled;
    if (shouldLogToConsole) {
      const jsonLine = JSON.stringify(validatedEntry);
      const isErrorLevel = level === "error";
      const isWarnLevel = level === "warn";
      if (isErrorLevel) {
        console.error(jsonLine);
      } else if (isWarnLevel) {
        console.warn(jsonLine);
      } else {
        console.info(jsonLine);
      }
    }

    return validatedEntry;
  }

  public debug(
    module: string,
    event: string,
    message: string,
    data: Record<string, unknown> = {},
    options?: { trace?: TraceContext; durationMs?: number },
  ): StructuredLogEntry {
    return this.log("debug", module, event, message, data, options);
  }

  public info(
    module: string,
    event: string,
    message: string,
    data: Record<string, unknown> = {},
    options?: { trace?: TraceContext; durationMs?: number },
  ): StructuredLogEntry {
    return this.log("info", module, event, message, data, options);
  }

  public warn(
    module: string,
    event: string,
    message: string,
    data: Record<string, unknown> = {},
    options?: { trace?: TraceContext; durationMs?: number },
  ): StructuredLogEntry {
    return this.log("warn", module, event, message, data, options);
  }

  public error(
    module: string,
    event: string,
    message: string,
    data: Record<string, unknown> = {},
    options?: { trace?: TraceContext; durationMs?: number },
  ): StructuredLogEntry {
    return this.log("error", module, event, message, data, options);
  }

  /**
   * 蓄積された構造化ログ一覧を取得する。
   */
  public getLogs(): StructuredLogEntry[] {
    return [...this.logs];
  }

  /**
   * 指定した traceId に紐づく全スパンのログを時系列順で抽出する。
   */
  public queryByTraceId(traceId: string): StructuredLogEntry[] {
    return this.logs.filter((entry) => entry.traceId === traceId);
  }

  /**
   * 指定した event 名に一致する構造化ログを抽出する。
   */
  public queryByEvent(event: string): StructuredLogEntry[] {
    return this.logs.filter((entry) => entry.event === event);
  }

  /**
   * ログバッファをクリアする（テスト用）。
   */
  public clear(): void {
    this.logs = [];
    this.syncBrowserGlobal();
  }
}

export const logger = new StructuredLogger();

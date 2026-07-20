import type { BenchmarkReport } from "@ai-network-check/core";

export type AppPhase = "idle" | "running" | "result" | "error";

export interface AppConfiguration {
  readonly route: string;
  readonly selectedServiceIds: readonly string[];
  readonly primarySampleCount: number;
}

export interface AppProgress {
  readonly label: string;
  readonly completed: number;
  readonly total: number;
  readonly ratio: number;
}

export interface WebAppState {
  readonly phase: AppPhase;
  readonly configuration: AppConfiguration;
  readonly progress: AppProgress | null;
  readonly report: BenchmarkReport | null;
  readonly errorMessage: string | null;
}

export type WebAppAction =
  | { readonly type: "configure"; readonly configuration: Partial<AppConfiguration> }
  | { readonly type: "start" }
  | {
      readonly type: "progress";
      readonly label: string;
      readonly completed: number;
      readonly total: number;
    }
  | { readonly type: "complete"; readonly report: BenchmarkReport }
  | { readonly type: "fail"; readonly message: string }
  | { readonly type: "reset" };

export function createInitialWebAppState(
  configuration: Partial<AppConfiguration> = {}
): WebAppState {
  return {
    phase: "idle",
    configuration: {
      route: configuration.route ?? "",
      selectedServiceIds: configuration.selectedServiceIds ?? [],
      primarySampleCount: configuration.primarySampleCount ?? 20
    },
    progress: null,
    report: null,
    errorMessage: null
  };
}

function normalizeProgress(completed: number, total: number): AppProgress {
  if (!Number.isInteger(completed) || completed < 0) {
    throw new RangeError("completed must be a non-negative integer");
  }
  if (!Number.isInteger(total) || total <= 0) {
    throw new RangeError("total must be a positive integer");
  }

  const normalizedCompleted = Math.min(completed, total);
  return {
    label: "",
    completed: normalizedCompleted,
    total,
    ratio: normalizedCompleted / total
  };
}

export function reduceWebAppState(
  state: WebAppState,
  action: WebAppAction
): WebAppState {
  switch (action.type) {
    case "configure":
      if (state.phase === "running") {
        return state;
      }
      return {
        ...state,
        configuration: {
          ...state.configuration,
          ...action.configuration
        }
      };
    case "start":
      return {
        ...state,
        phase: "running",
        progress: {
          label: "准备检测",
          completed: 0,
          total: 1,
          ratio: 0
        },
        report: null,
        errorMessage: null
      };
    case "progress": {
      const progress = normalizeProgress(action.completed, action.total);
      return {
        ...state,
        phase: "running",
        progress: { ...progress, label: action.label },
        errorMessage: null
      };
    }
    case "complete":
      return {
        ...state,
        phase: "result",
        progress: null,
        report: action.report,
        errorMessage: null
      };
    case "fail":
      return {
        ...state,
        phase: "error",
        progress: null,
        report: null,
        errorMessage: action.message.trim() || "检测失败"
      };
    case "reset":
      return {
        ...state,
        phase: "idle",
        progress: null,
        report: null,
        errorMessage: null
      };
  }
}

export function averageServiceScore(report: BenchmarkReport): number | null {
  const scores = report.services
    .map((service) => service.score?.score ?? null)
    .filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

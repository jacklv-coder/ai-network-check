import type {
  AIServiceDefinition,
  BenchmarkReport,
  ServiceBenchmarkReport
} from "../../core/src/index.ts";
import type {
  BrowserBenchmarkProgress,
  BrowserEndpointBenchmarkInput,
  BrowserEndpointBenchmarkResult
} from "../../web-benchmark/src/index.ts";

export interface WebBenchmarkWorkflowOptions {
  readonly serviceIds?: readonly string[];
  readonly route?: string | null;
  readonly primarySampleCount?: number;
  readonly supportingSampleCount?: number;
  readonly timeoutMs?: number;
  readonly delayMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: WebBenchmarkWorkflowProgress) => void;
}

export interface WebBenchmarkWorkflowDependencies {
  readonly listServices: () => readonly AIServiceDefinition[];
  readonly runEndpointBenchmark: (
    input: BrowserEndpointBenchmarkInput
  ) => Promise<BrowserEndpointBenchmarkResult>;
  readonly now: () => Date;
}

export interface WorkflowStartProgress {
  readonly type: "workflow-start";
  readonly serviceCount: number;
}

export interface ServiceStartProgress {
  readonly type: "service-start";
  readonly serviceId: string;
  readonly serviceIndex: number;
  readonly serviceCount: number;
}

export interface EndpointStartProgress {
  readonly type: "endpoint-start";
  readonly serviceId: string;
  readonly endpointId: string;
  readonly endpointIndex: number;
  readonly endpointCount: number;
  readonly sampleCount: number;
}

export interface EndpointSampleProgress {
  readonly type: "endpoint-progress";
  readonly serviceId: string;
  readonly progress: BrowserBenchmarkProgress;
}

export interface EndpointCompleteProgress {
  readonly type: "endpoint-complete";
  readonly serviceId: string;
  readonly result: BrowserEndpointBenchmarkResult;
}

export interface ServiceCompleteProgress {
  readonly type: "service-complete";
  readonly service: ServiceBenchmarkReport;
}

export interface WorkflowCompleteProgress {
  readonly type: "workflow-complete";
  readonly report: BenchmarkReport;
}

export type WebBenchmarkWorkflowProgress =
  | WorkflowStartProgress
  | ServiceStartProgress
  | EndpointStartProgress
  | EndpointSampleProgress
  | EndpointCompleteProgress
  | ServiceCompleteProgress
  | WorkflowCompleteProgress;

export interface ResolvedWebBenchmarkWorkflowOptions {
  readonly services: readonly AIServiceDefinition[];
  readonly route: string | null;
  readonly primarySampleCount: number;
  readonly supportingSampleCount: number;
  readonly timeoutMs: number;
  readonly delayMs: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: WebBenchmarkWorkflowProgress) => void;
}

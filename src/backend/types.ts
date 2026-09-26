import type { DecisionRequest, DifficultyDecision } from "../decision/types.js";
import type { RouterErrorReason } from "../errors/errors.js";

/** A lightweight status returned by optional backend health checks. */
export interface HealthStatus {
  healthy: boolean;
  backend: string;
  latencyMs?: number;
  reason?: RouterErrorReason;
  model?: string;
}

/** Backend boundary shared by Ollaya and future decision backends. */
export interface DecisionBackend {
  decide(request: DecisionRequest): Promise<DifficultyDecision>;
  healthCheck?(): Promise<HealthStatus>;
}

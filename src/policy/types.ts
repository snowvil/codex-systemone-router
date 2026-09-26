import type {
  Decision,
  Difficulty,
  Probabilities,
  ReasoningEffort,
} from "../decision/types.js";

export type { ReasoningEffort };

/** A model and the amount of reasoning it should use. */
export interface RoutingTarget {
  model: string;
  reasoning_effort: ReasoningEffort;
}

/** Lower bounds for the medium, high, and xhigh score buckets. */
export interface PolicyThresholds {
  medium: number;
  high: number;
  xhigh: number;
}

/** The target to use for every difficulty bucket. */
export type PolicyRoutes = Record<Difficulty, RoutingTarget>;

/** The deterministic policy applied after a backend has produced probabilities. */
export interface RoutingPolicy {
  thresholds: PolicyThresholds;
  routes: PolicyRoutes;
  fallback: RoutingTarget;
}

/** A complete routing decision exposed to callers and the CLI. */
export interface RoutingResult {
  difficulty: Difficulty;
  score: number;
  target: RoutingTarget;
  decision: Decision;
  fallback: boolean;
  reason?: string;
}

/** Keep these imports part of the policy contract for downstream adapters. */
export type { Decision, Difficulty, Probabilities };

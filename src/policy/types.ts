import type {
  Decision,
  Difficulty,
  Probabilities,
  ReasoningEffort,
} from "../decision/types.js";

export type { ReasoningEffort };

/** Supported pure policies applied to a validated backend decision. */
export const POLICY_STRATEGIES = ["conservative", "ordinal", "argmax"] as const;
export type PolicyStrategy = (typeof POLICY_STRATEGIES)[number];

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
  strategy: PolicyStrategy;
  thresholds: PolicyThresholds;
  routes: PolicyRoutes;
  fallback: RoutingTarget;
}

/** A complete routing decision exposed to callers and the CLI. */
export interface RoutingResult {
  /** Effective logical difficulty strategy, independent of model mapping. */
  policy: PolicyStrategy;
  difficulty: Difficulty;
  score: number;
  target: RoutingTarget;
  decision: Decision;
  /** Null on fallback because the values below are synthetic placeholders. */
  declaredChoice: Difficulty | null;
  probabilityArgmax: Difficulty | null;
  choiceArgmaxDisagreement: boolean | null;
  fallback: boolean;
  reason?: string;
}

/** Keep these imports part of the policy contract for downstream adapters. */
export type { Decision, Difficulty, Probabilities };

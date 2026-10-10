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

/**
 * Agent hosts that can apply a routing decision. Each host has its own model
 * vocabulary (Codex model slugs, Claude Code model aliases), so targets are
 * kept per host while the difficulty estimate stays shared.
 */
export const HOSTS = ["codex", "claude"] as const;
export type Host = (typeof HOSTS)[number];

/** The host whose targets `policy.routes` and `policy.fallback` describe. */
export const DEFAULT_HOST: Host = "codex";

/** The complete target mapping for one host. */
export interface HostTargets {
  routes: PolicyRoutes;
  fallback: RoutingTarget;
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
  /** Targets for the default host (`codex`). Authoritative for that host. */
  routes: PolicyRoutes;
  /** Fallback for the default host (`codex`). Authoritative for that host. */
  fallback: RoutingTarget;
  /**
   * Per-host targets. `hosts.codex` mirrors `routes`/`fallback` after
   * `loadConfig`; other hosts are only reachable through this map. Optional
   * for callers that only route the default host.
   */
  hosts?: Partial<Record<Host, HostTargets>>;
}

/** Options accepted by `routeDecision` and `fallbackResult`. */
export interface RouteOptions {
  /** Host whose targets are applied. Defaults to `codex`. */
  host?: Host;
}

/** A complete routing decision exposed to callers and the CLI. */
export interface RoutingResult {
  /** Effective logical difficulty strategy, independent of model mapping. */
  policy: PolicyStrategy;
  /** Host whose target vocabulary `target` uses. */
  host: Host;
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

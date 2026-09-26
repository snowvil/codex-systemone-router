import type { RouterConfig } from "../config/types.js";
import { normalizeProbabilities, ordinalScore } from "./score.js";
import type { Difficulty, RoutingPolicy, RoutingResult } from "./types.js";
import type { Decision } from "../decision/types.js";

const DIFFICULTIES = new Set<Difficulty>(["low", "medium", "high", "xhigh"]);
const REASONING_EFFORTS = DIFFICULTIES;

export class PolicyValidationError extends Error {
  readonly code = "invalid_configuration" as const;

  constructor(message: string) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertFiniteScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 3) {
    throw new PolicyValidationError(
      `score must be between 0 and 3 (received ${score})`,
    );
  }
}

function assertTarget(
  value: unknown,
  label: string,
): asserts value is {
  model: string;
  reasoning_effort: "low" | "medium" | "high" | "xhigh";
} {
  if (!isRecord(value)) {
    throw new PolicyValidationError(`${label} must be an object`);
  }
  if (
    typeof value.model !== "string" ||
    value.model.trim().length === 0 ||
    value.model.length > 256
  ) {
    throw new PolicyValidationError(
      `${label}.model must be a non-empty string`,
    );
  }
  if (
    typeof value.reasoning_effort !== "string" ||
    !REASONING_EFFORTS.has(value.reasoning_effort as Difficulty)
  ) {
    throw new PolicyValidationError(
      `${label}.reasoning_effort must be low, medium, high, or xhigh`,
    );
  }
}

/** Validate a policy independently of the config loader. */
export function validateRoutingPolicy(
  value: unknown,
): asserts value is RoutingPolicy {
  if (!isRecord(value)) {
    throw new PolicyValidationError("policy must be an object");
  }
  if (!isRecord(value.thresholds)) {
    throw new PolicyValidationError("policy.thresholds must be an object");
  }
  const { medium, high, xhigh } = value.thresholds;
  if (
    typeof medium !== "number" ||
    !Number.isFinite(medium) ||
    typeof high !== "number" ||
    !Number.isFinite(high) ||
    typeof xhigh !== "number" ||
    !Number.isFinite(xhigh)
  ) {
    throw new PolicyValidationError("policy thresholds must be finite numbers");
  }
  if (medium < 0 || high > 3 || xhigh > 3 || !(medium < high && high < xhigh)) {
    throw new PolicyValidationError(
      "policy thresholds must be strictly increasing within 0..3",
    );
  }
  if (!isRecord(value.routes)) {
    throw new PolicyValidationError("policy.routes must be an object");
  }
  for (const difficulty of DIFFICULTIES) {
    assertTarget(value.routes[difficulty], `policy.routes.${difficulty}`);
  }
  assertTarget(value.fallback, "policy.fallback");
}

/** Select a bucket using score lower bounds, with exact boundaries stable. */
export function difficultyForScore(
  score: number,
  thresholds: RoutingPolicy["thresholds"],
): Difficulty {
  assertFiniteScore(score);
  if (score < thresholds.medium) return "low";
  if (score < thresholds.high) return "medium";
  if (score < thresholds.xhigh) return "high";
  return "xhigh";
}

function policyFromConfig(config: RouterConfig | RoutingPolicy): RoutingPolicy {
  if (isRecord(config) && "policy" in config) {
    return (config as RouterConfig).policy;
  }
  return config as RoutingPolicy;
}

/** Route a valid backend decision deterministically according to configuration. */
export function routeDecision(
  decision: Decision,
  config: RouterConfig | RoutingPolicy,
): RoutingResult {
  if (!isRecord(decision)) {
    throw new PolicyValidationError("decision must be an object");
  }
  const policy = policyFromConfig(config);
  validateRoutingPolicy(policy);

  const probabilities = normalizeProbabilities(decision.probabilities);
  const score = ordinalScore(probabilities);
  const difficulty = difficultyForScore(score, policy.thresholds);
  const normalizedDecision = {
    ...decision,
    probabilities,
    score,
  } as Decision;

  return {
    difficulty,
    score,
    target: { ...policy.routes[difficulty] },
    decision: normalizedDecision,
    fallback: false,
  };
}

/** Build a valid result when the decision backend is unavailable. */
export function fallbackResult(
  config: RouterConfig | RoutingPolicy,
  reason: string,
): RoutingResult {
  const policy = policyFromConfig(config);
  validateRoutingPolicy(policy);
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new PolicyValidationError(
      "fallback reason must be a non-empty string",
    );
  }
  const fallbackDecision: Decision = {
    choice: "high",
    confidence: 0,
    probabilities: { low: 0, medium: 0, high: 1, xhigh: 0 },
    score: 2,
    backend: "fallback",
  };
  const probabilities = normalizeProbabilities(fallbackDecision.probabilities);
  const score = ordinalScore(probabilities);
  return {
    difficulty: "high",
    score,
    target: { ...policy.fallback },
    decision: {
      ...fallbackDecision,
      probabilities,
      score,
    },
    fallback: true,
    reason,
  };
}

import type { RouterConfig } from "./types.js";

/**
 * Initial score cutoffs for v0.1. They are transparent heuristics, not a
 * calibrated claim about Kev's accuracy; callers can replace them in config.
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  medium: 0.75,
  high: 1.75,
  xhigh: 2.55,
});

export const DEFAULT_ROUTES = Object.freeze({
  low: Object.freeze({
    model: "gpt-6-luna",
    reasoning_effort: "low" as const,
  }),
  medium: Object.freeze({
    model: "gpt-6-luna",
    reasoning_effort: "medium" as const,
  }),
  high: Object.freeze({
    model: "gpt-6.1-sol",
    reasoning_effort: "high" as const,
  }),
  xhigh: Object.freeze({
    model: "gpt-6-astra",
    reasoning_effort: "xhigh" as const,
  }),
});

export const DEFAULT_FALLBACK = Object.freeze({
  model: "gpt-6.1-sol",
  reasoning_effort: "high" as const,
});

export const DEFAULT_CONFIG: RouterConfig = Object.freeze({
  backend: Object.freeze({
    type: "ollaya" as const,
    url: "http://127.0.0.1:11435/api/decide",
    model: "kev:latest",
    timeout_ms: 2000,
  }),
  policy: Object.freeze({
    strategy: "conservative" as const,
    thresholds: DEFAULT_THRESHOLDS,
    routes: DEFAULT_ROUTES,
    fallback: DEFAULT_FALLBACK,
  }),
});

/** Return mutable copies so one caller cannot alter process-wide defaults. */
export function cloneDefaultConfig(): RouterConfig {
  return {
    backend: { ...DEFAULT_CONFIG.backend },
    policy: {
      strategy: DEFAULT_CONFIG.policy.strategy,
      thresholds: { ...DEFAULT_CONFIG.policy.thresholds },
      routes: {
        low: { ...DEFAULT_CONFIG.policy.routes.low },
        medium: { ...DEFAULT_CONFIG.policy.routes.medium },
        high: { ...DEFAULT_CONFIG.policy.routes.high },
        xhigh: { ...DEFAULT_CONFIG.policy.routes.xhigh },
      },
      fallback: { ...DEFAULT_CONFIG.policy.fallback },
    },
  };
}

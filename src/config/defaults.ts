import type { Host, HostTargets } from "../policy/types.js";
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

/** Codex subagent targets. These are Codex model slugs. */
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

/**
 * Claude Code subagent targets. Claude Code's Agent tool accepts the model
 * aliases `haiku`, `sonnet`, `opus`, and `fable` (or a full model ID) and an
 * `effort` of low, medium, high, xhigh, or max. Aliases are used so the
 * mapping follows whatever Claude Code currently resolves them to.
 */
export const DEFAULT_CLAUDE_ROUTES = Object.freeze({
  low: Object.freeze({
    model: "haiku",
    reasoning_effort: "low" as const,
  }),
  medium: Object.freeze({
    model: "sonnet",
    reasoning_effort: "medium" as const,
  }),
  high: Object.freeze({
    model: "opus",
    reasoning_effort: "high" as const,
  }),
  xhigh: Object.freeze({
    model: "opus",
    reasoning_effort: "xhigh" as const,
  }),
});

export const DEFAULT_CLAUDE_FALLBACK = Object.freeze({
  model: "opus",
  reasoning_effort: "high" as const,
});

export const DEFAULT_HOSTS: Readonly<Record<Host, HostTargets>> = Object.freeze(
  {
    codex: Object.freeze({
      routes: DEFAULT_ROUTES,
      fallback: DEFAULT_FALLBACK,
    }),
    claude: Object.freeze({
      routes: DEFAULT_CLAUDE_ROUTES,
      fallback: DEFAULT_CLAUDE_FALLBACK,
    }),
  },
);

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
    hosts: DEFAULT_HOSTS,
  }),
});

function cloneHostTargets(value: HostTargets): HostTargets {
  return {
    routes: {
      low: { ...value.routes.low },
      medium: { ...value.routes.medium },
      high: { ...value.routes.high },
      xhigh: { ...value.routes.xhigh },
    },
    fallback: { ...value.fallback },
  };
}

/** Return mutable copies so one caller cannot alter process-wide defaults. */
export function cloneDefaultConfig(): RouterConfig {
  const hosts = {
    codex: cloneHostTargets(DEFAULT_HOSTS.codex),
    claude: cloneHostTargets(DEFAULT_HOSTS.claude),
  };
  return {
    backend: { ...DEFAULT_CONFIG.backend },
    policy: {
      strategy: DEFAULT_CONFIG.policy.strategy,
      thresholds: { ...DEFAULT_CONFIG.policy.thresholds },
      routes: hosts.codex.routes,
      fallback: hosts.codex.fallback,
      hosts,
    },
  };
}

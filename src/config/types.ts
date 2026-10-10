import type { Difficulty } from "../decision/types.js";
import type {
  Host,
  PolicyThresholds,
  PolicyStrategy,
  RoutingPolicy,
  RoutingTarget,
} from "../policy/types.js";

/** Backend settings used by the v0.1 Ollaya adapter. */
export interface BackendConfig {
  type: "ollaya";
  url: string;
  model: string;
  timeout_ms: number;
}

/** Complete router configuration after defaults and overrides are applied. */
export interface RouterConfig {
  backend: BackendConfig;
  policy: RoutingPolicy;
}

/** Partial per-host targets accepted from configuration sources. */
export interface HostTargetsOverrides {
  routes?: Partial<Record<Difficulty, Partial<RoutingTarget>>>;
  fallback?: Partial<RoutingTarget>;
}

/** Partial configuration accepted from YAML, environment, or CLI overrides. */
export interface ConfigOverrides {
  backend?: Partial<BackendConfig>;
  policy?: {
    strategy?: PolicyStrategy;
    thresholds?: Partial<PolicyThresholds>;
    /** Shorthand for `hosts.codex.routes`. */
    routes?: Partial<Record<Difficulty, Partial<RoutingTarget>>>;
    /** Shorthand for `hosts.codex.fallback`. */
    fallback?: Partial<RoutingTarget>;
    hosts?: Partial<Record<Host, HostTargetsOverrides>>;
  };
}

export interface LoadConfigOptions {
  /** Explicit config path, taking precedence over the config path env var. */
  configPath?: string;
  /** Environment source, injectable so precedence can be tested safely. */
  env?: Record<string, string | undefined>;
  /** Highest-precedence CLI values. */
  overrides?: ConfigOverrides;
}

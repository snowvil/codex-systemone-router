import type { Difficulty } from "../decision/types.js";
import type {
  PolicyThresholds,
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

/** Partial configuration accepted from YAML, environment, or CLI overrides. */
export interface ConfigOverrides {
  backend?: Partial<BackendConfig>;
  policy?: {
    thresholds?: Partial<PolicyThresholds>;
    routes?: Partial<Record<Difficulty, Partial<RoutingTarget>>>;
    fallback?: Partial<RoutingTarget>;
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

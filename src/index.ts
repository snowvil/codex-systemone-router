export type {
  Difficulty,
  DifficultyDecision,
  DifficultyProbabilities,
  DecisionRequest,
} from "./decision/types.js";
export type { DecisionBackend, HealthStatus } from "./backend/types.js";
export { OllayaBackend } from "./backend/ollaya.js";
export type { RouterConfig, ConfigOverrides } from "./config/types.js";
export { loadConfig } from "./config/loader.js";
export { cloneDefaultConfig } from "./config/defaults.js";
export type {
  RoutingResult,
  RoutingTarget,
  RoutingPolicy,
} from "./policy/types.js";
export { ordinalScore, normalizeProbabilities } from "./policy/score.js";
export { routeDecision, fallbackResult } from "./policy/default-policy.js";
export { installAgents, uninstallAgents } from "./codex/installer.js";

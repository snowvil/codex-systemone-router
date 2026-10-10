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
  Host,
  HostTargets,
  RouteOptions,
  RoutingResult,
  RoutingTarget,
  RoutingPolicy,
} from "./policy/types.js";
export { HOSTS, DEFAULT_HOST } from "./policy/types.js";
export { ordinalScore, normalizeProbabilities } from "./policy/score.js";
export {
  routeDecision,
  fallbackResult,
  targetsForHost,
} from "./policy/default-policy.js";
export { resolveHost } from "./host/detect.js";
export type { ResolvedHost, HostSource } from "./host/detect.js";
export {
  installAgents,
  uninstallAgents,
  globalInstructionLocations,
  projectInstructionLocations,
  HOST_INSTRUCTION_FILES,
} from "./codex/installer.js";
export type { InstructionLocation } from "./codex/installer.js";

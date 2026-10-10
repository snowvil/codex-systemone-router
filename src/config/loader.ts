import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { cloneDefaultConfig } from "./defaults.js";
import type {
  BackendConfig,
  ConfigOverrides,
  LoadConfigOptions,
  RouterConfig,
} from "./types.js";
import type {
  Host,
  HostTargets,
  PolicyRoutes,
  PolicyThresholds,
  ReasoningEffort,
  RoutingPolicy,
  RoutingTarget,
} from "../policy/types.js";
import { DEFAULT_HOST, HOSTS, POLICY_STRATEGIES } from "../policy/types.js";
import { validateRoutingPolicy } from "../policy/default-policy.js";

const CONFIG_ENV = "CODEX_SYSTEMONE_ROUTER_CONFIG";
const PREFIX = "CODEX_SYSTEMONE_ROUTER_";
const DIFFICULTIES = ["low", "medium", "high", "xhigh"] as const;
const REASONING_EFFORTS = new Set<ReasoningEffort>(DIFFICULTIES);
const ALLOWED_POLICY_STRATEGIES = new Set<string>(POLICY_STRATEGIES);
const ALLOWED_ROOT_KEYS = new Set(["backend", "policy"]);
const ALLOWED_BACKEND_KEYS = new Set(["type", "url", "model", "timeout_ms"]);
const ALLOWED_POLICY_KEYS = new Set([
  "strategy",
  "thresholds",
  "routes",
  "fallback",
  "hosts",
]);
const ALLOWED_HOST_KEYS = new Set(["routes", "fallback"]);
const ALLOWED_HOSTS = new Set<string>(HOSTS);
const ALLOWED_THRESHOLD_KEYS = new Set(["medium", "high", "xhigh"]);
const ALLOWED_TARGET_KEYS = new Set(["model", "reasoning_effort"]);
const CONFIG_FILE_MAX_BYTES = 1024 * 1024;

export class ConfigValidationError extends Error {
  readonly code = "invalid_configuration" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigValidationError(`${path} contains unknown key ${key}`);
    }
  }
}

function assertRecord(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ConfigValidationError(`${path} must be an object`);
  }
}

function assertNonEmptyString(
  value: unknown,
  path: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new ConfigValidationError(`${path} must be a non-empty string`);
  }
}

function assertFiniteNumber(
  value: unknown,
  path: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigValidationError(`${path} must be a finite number`);
  }
}

function validatePartialTarget(value: unknown, path: string): void {
  assertRecord(value, path);
  assertAllowedKeys(value, ALLOWED_TARGET_KEYS, path);
  if ("model" in value) assertNonEmptyString(value.model, `${path}.model`);
  if ("reasoning_effort" in value) {
    if (
      typeof value.reasoning_effort !== "string" ||
      !REASONING_EFFORTS.has(value.reasoning_effort as ReasoningEffort)
    ) {
      throw new ConfigValidationError(
        `${path}.reasoning_effort must be low, medium, high, or xhigh`,
      );
    }
  }
}

function validatePartialRoutes(value: unknown, path: string): void {
  assertRecord(value, path);
  for (const key of Object.keys(value)) {
    if (!(DIFFICULTIES as readonly string[]).includes(key)) {
      throw new ConfigValidationError(`${path} contains unknown key ${key}`);
    }
    validatePartialTarget(value[key], `${path}.${key}`);
  }
}

function validatePartialHosts(value: unknown, path: string): void {
  assertRecord(value, path);
  for (const host of Object.keys(value)) {
    if (!ALLOWED_HOSTS.has(host)) {
      throw new ConfigValidationError(
        `${path} contains unknown host ${host}; expected ${HOSTS.join(" or ")}`,
      );
    }
    const targets = value[host];
    assertRecord(targets, `${path}.${host}`);
    assertAllowedKeys(targets, ALLOWED_HOST_KEYS, `${path}.${host}`);
    if ("routes" in targets) {
      validatePartialRoutes(targets.routes, `${path}.${host}.routes`);
    }
    if ("fallback" in targets) {
      validatePartialTarget(targets.fallback, `${path}.${host}.fallback`);
    }
  }
}

/** Validate a partial object before it participates in a precedence merge. */
export function validateConfigOverrides(
  value: unknown,
  path = "config",
): asserts value is ConfigOverrides {
  assertRecord(value, path);
  assertAllowedKeys(value, ALLOWED_ROOT_KEYS, path);

  if ("backend" in value) {
    assertRecord(value.backend, `${path}.backend`);
    assertAllowedKeys(value.backend, ALLOWED_BACKEND_KEYS, `${path}.backend`);
    if ("type" in value.backend) {
      if (value.backend.type !== "ollaya") {
        throw new ConfigValidationError(`${path}.backend.type must be ollaya`);
      }
    }
    if ("url" in value.backend) {
      assertNonEmptyString(value.backend.url, `${path}.backend.url`);
    }
    if ("model" in value.backend) {
      assertNonEmptyString(value.backend.model, `${path}.backend.model`);
    }
    if ("timeout_ms" in value.backend) {
      assertFiniteNumber(
        value.backend.timeout_ms,
        `${path}.backend.timeout_ms`,
      );
      if (
        !Number.isInteger(value.backend.timeout_ms) ||
        value.backend.timeout_ms <= 0
      ) {
        throw new ConfigValidationError(
          `${path}.backend.timeout_ms must be a positive integer`,
        );
      }
    }
  }

  if ("policy" in value) {
    assertRecord(value.policy, `${path}.policy`);
    assertAllowedKeys(value.policy, ALLOWED_POLICY_KEYS, `${path}.policy`);
    if (
      "strategy" in value.policy &&
      (typeof value.policy.strategy !== "string" ||
        !ALLOWED_POLICY_STRATEGIES.has(value.policy.strategy))
    ) {
      throw new ConfigValidationError(
        `${path}.policy.strategy must be conservative, ordinal, or argmax`,
      );
    }
    if ("thresholds" in value.policy) {
      assertRecord(value.policy.thresholds, `${path}.policy.thresholds`);
      assertAllowedKeys(
        value.policy.thresholds,
        ALLOWED_THRESHOLD_KEYS,
        `${path}.policy.thresholds`,
      );
      for (const key of ALLOWED_THRESHOLD_KEYS) {
        if (key in value.policy.thresholds) {
          assertFiniteNumber(
            value.policy.thresholds[key],
            `${path}.policy.thresholds.${key}`,
          );
        }
      }
    }
    if ("routes" in value.policy) {
      validatePartialRoutes(value.policy.routes, `${path}.policy.routes`);
    }
    if ("fallback" in value.policy) {
      validatePartialTarget(value.policy.fallback, `${path}.policy.fallback`);
    }
    if ("hosts" in value.policy) {
      validatePartialHosts(value.policy.hosts, `${path}.policy.hosts`);
    }
  }
}

/**
 * Fold the `policy.routes` / `policy.fallback` shorthand into
 * `policy.hosts.codex` so every source merges through one shape. Within a
 * single source an explicit `hosts.codex` entry wins over the shorthand.
 */
function normalizeOverrides(value: ConfigOverrides): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (value.backend !== undefined) result.backend = { ...value.backend };
  if (value.policy === undefined) return result;
  const { routes, fallback, hosts, ...rest } = value.policy;
  const policy: Record<string, unknown> = { ...rest };
  const normalizedHosts: Record<string, unknown> = {};
  if (routes !== undefined || fallback !== undefined) {
    normalizedHosts[DEFAULT_HOST] = {
      ...(routes === undefined ? {} : { routes }),
      ...(fallback === undefined ? {} : { fallback }),
    };
  }
  if (hosts !== undefined) {
    for (const [host, targets] of Object.entries(hosts)) {
      if (targets === undefined) continue;
      const existing = normalizedHosts[host];
      normalizedHosts[host] = isRecord(existing)
        ? mergeRecords(existing, targets as Record<string, unknown>)
        : targets;
    }
  }
  if (Object.keys(normalizedHosts).length > 0) policy.hosts = normalizedHosts;
  if (Object.keys(policy).length > 0) result.policy = policy;
  return result;
}

function mergeRecords(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const copy = structuredClone(base);
  mergeInto(copy, extra);
  return copy;
}

function parseConfigFile(path: string): ConfigOverrides {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new ConfigValidationError("config path must be a non-empty string");
  }

  let source: string;
  try {
    const file = readFileSync(path);
    if (file.byteLength > CONFIG_FILE_MAX_BYTES) {
      throw new ConfigValidationError("config file exceeds the 1 MiB limit");
    }
    source = file.toString("utf8");
  } catch (error) {
    if (error instanceof ConfigValidationError) throw error;
    throw new ConfigValidationError(`unable to read config file ${path}`, {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new ConfigValidationError(`unable to parse config file ${path}`, {
      cause: error,
    });
  }

  // An empty YAML document is equivalent to an empty override object.
  if (parsed === null || parsed === undefined) return {};
  validateConfigOverrides(parsed, `config file ${path}`);
  return parsed;
}

function envValue(
  env: Record<string, string | undefined>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    if (env[name] !== undefined) return env[name];
  }
  return undefined;
}

function parseEnvNumber(value: string, path: string): number {
  if (value.trim().length === 0) {
    throw new ConfigValidationError(`${path} must be a number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ConfigValidationError(`${path} must be a finite number`);
  }
  return parsed;
}

function environmentOverrides(
  env: Record<string, string | undefined>,
): ConfigOverrides {
  const backend: Record<string, unknown> = {};
  const policy: Record<string, unknown> = {};
  const thresholds: Record<string, unknown> = {};
  const routes: Record<string, unknown> = {};

  const type = envValue(env, [`${PREFIX}BACKEND_TYPE`]);
  const url = envValue(env, [`${PREFIX}BACKEND_URL`]);
  const model = envValue(env, [`${PREFIX}BACKEND_MODEL`]);
  const timeout = envValue(env, [
    `${PREFIX}BACKEND_TIMEOUT_MS`,
    `${PREFIX}TIMEOUT_MS`,
  ]);
  if (type !== undefined) backend.type = type;
  if (url !== undefined) backend.url = url;
  if (model !== undefined) backend.model = model;
  if (timeout !== undefined) {
    backend.timeout_ms = parseEnvNumber(timeout, `${PREFIX}BACKEND_TIMEOUT_MS`);
  }

  for (const threshold of ["medium", "high", "xhigh"] as const) {
    const value = envValue(env, [
      `${PREFIX}POLICY_THRESHOLDS_${threshold.toUpperCase()}`,
      `${PREFIX}POLICY_THRESHOLD_${threshold.toUpperCase()}`,
    ]);
    if (value !== undefined)
      thresholds[threshold] = parseEnvNumber(
        value,
        `${PREFIX}POLICY_THRESHOLDS_${threshold.toUpperCase()}`,
      );
  }

  for (const difficulty of DIFFICULTIES) {
    const routeModel = envValue(env, [
      `${PREFIX}POLICY_ROUTES_${difficulty.toUpperCase()}_MODEL`,
      `${PREFIX}POLICY_ROUTE_${difficulty.toUpperCase()}_MODEL`,
    ]);
    const routeEffort = envValue(env, [
      `${PREFIX}POLICY_ROUTES_${difficulty.toUpperCase()}_REASONING_EFFORT`,
      `${PREFIX}POLICY_ROUTE_${difficulty.toUpperCase()}_REASONING_EFFORT`,
    ]);
    if (routeModel !== undefined || routeEffort !== undefined) {
      routes[difficulty] = {
        ...(routeModel === undefined ? {} : { model: routeModel }),
        ...(routeEffort === undefined ? {} : { reasoning_effort: routeEffort }),
      };
    }
  }

  const fallbackModel = envValue(env, [
    `${PREFIX}POLICY_FALLBACK_MODEL`,
    `${PREFIX}FALLBACK_MODEL`,
  ]);
  const fallbackEffort = envValue(env, [
    `${PREFIX}POLICY_FALLBACK_REASONING_EFFORT`,
    `${PREFIX}FALLBACK_REASONING_EFFORT`,
  ]);
  const fallback = {
    ...(fallbackModel === undefined ? {} : { model: fallbackModel }),
    ...(fallbackEffort === undefined
      ? {}
      : { reasoning_effort: fallbackEffort }),
  };

  // Per-host targets: CODEX_SYSTEMONE_ROUTER_POLICY_HOSTS_CLAUDE_ROUTES_HIGH_MODEL
  const hosts: Record<string, unknown> = {};
  for (const host of HOSTS) {
    const hostPrefix = `${PREFIX}POLICY_HOSTS_${host.toUpperCase()}_`;
    const hostRoutes: Record<string, unknown> = {};
    for (const difficulty of DIFFICULTIES) {
      const model = envValue(env, [
        `${hostPrefix}ROUTES_${difficulty.toUpperCase()}_MODEL`,
      ]);
      const effort = envValue(env, [
        `${hostPrefix}ROUTES_${difficulty.toUpperCase()}_REASONING_EFFORT`,
      ]);
      if (model !== undefined || effort !== undefined) {
        hostRoutes[difficulty] = {
          ...(model === undefined ? {} : { model }),
          ...(effort === undefined ? {} : { reasoning_effort: effort }),
        };
      }
    }
    const hostFallbackModel = envValue(env, [`${hostPrefix}FALLBACK_MODEL`]);
    const hostFallbackEffort = envValue(env, [
      `${hostPrefix}FALLBACK_REASONING_EFFORT`,
    ]);
    const hostTargets: Record<string, unknown> = {};
    if (Object.keys(hostRoutes).length > 0) hostTargets.routes = hostRoutes;
    if (hostFallbackModel !== undefined || hostFallbackEffort !== undefined) {
      hostTargets.fallback = {
        ...(hostFallbackModel === undefined
          ? {}
          : { model: hostFallbackModel }),
        ...(hostFallbackEffort === undefined
          ? {}
          : { reasoning_effort: hostFallbackEffort }),
      };
    }
    if (Object.keys(hostTargets).length > 0) hosts[host] = hostTargets;
  }

  const strategy = envValue(env, [`${PREFIX}POLICY_STRATEGY`]);
  if (strategy !== undefined) policy.strategy = strategy;

  if (Object.keys(thresholds).length > 0) policy.thresholds = thresholds;
  if (Object.keys(routes).length > 0) policy.routes = routes;
  if (fallbackModel !== undefined || fallbackEffort !== undefined) {
    policy.fallback = fallback;
  }
  if (Object.keys(hosts).length > 0) policy.hosts = hosts;

  const result: Record<string, unknown> = {};
  if (Object.keys(backend).length > 0) result.backend = backend;
  if (Object.keys(policy).length > 0) result.policy = policy;
  validateConfigOverrides(result, "environment");
  return result as ConfigOverrides;
}

function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(target[key])) {
      mergeInto(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

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

function cloneConfig(value: RouterConfig): RouterConfig {
  const hosts = {} as Record<Host, HostTargets>;
  for (const host of HOSTS) {
    const targets = value.policy.hosts?.[host];
    if (targets === undefined) {
      throw new ConfigValidationError(
        `resolved config policy.hosts.${host} is missing`,
      );
    }
    hosts[host] = cloneHostTargets(targets);
  }
  return {
    backend: { ...value.backend },
    policy: {
      strategy: value.policy.strategy,
      thresholds: { ...value.policy.thresholds },
      routes: hosts[DEFAULT_HOST].routes,
      fallback: hosts[DEFAULT_HOST].fallback,
      hosts,
    },
  };
}

function assertFinalConfig(value: RouterConfig): RouterConfig {
  // The shorthand aliases are derived from hosts.codex after the merge.
  const codex = value.policy.hosts?.[DEFAULT_HOST];
  if (codex === undefined) {
    throw new ConfigValidationError(
      `resolved config policy.hosts.${DEFAULT_HOST} is missing`,
    );
  }
  value.policy.routes = codex.routes;
  value.policy.fallback = codex.fallback;
  validateConfigOverrides(value, "resolved config");
  if (value.backend.type !== "ollaya") {
    throw new ConfigValidationError(
      "resolved config backend.type must be ollaya",
    );
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.backend.url);
  } catch (error) {
    throw new ConfigValidationError(
      "resolved config backend.url must be a valid URL",
      {
        cause: error,
      },
    );
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ConfigValidationError(
      "resolved config backend.url must use http or https",
    );
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new ConfigValidationError(
      "resolved config backend.url must not contain credentials",
    );
  }
  if (
    !Number.isInteger(value.backend.timeout_ms) ||
    value.backend.timeout_ms <= 0 ||
    value.backend.timeout_ms > 120_000
  ) {
    throw new ConfigValidationError(
      "resolved config backend.timeout_ms must be an integer from 1 to 120000",
    );
  }
  for (const threshold of Object.values(value.policy.thresholds)) {
    if (threshold < 0 || threshold > 3) {
      throw new ConfigValidationError(
        "resolved policy thresholds must be within 0..3",
      );
    }
  }
  validateRoutingPolicy(value.policy);
  return cloneConfig(value);
}

/**
 * Load and validate configuration synchronously.
 *
 * Precedence is defaults < YAML file < recognized environment variables < CLI
 * overrides. Synchronous loading keeps the CLI startup path deterministic and
 * avoids making every consumer await a local file read.
 */
export function loadConfig(options: LoadConfigOptions = {}): RouterConfig {
  if (!isRecord(options)) {
    throw new ConfigValidationError("loadConfig options must be an object");
  }
  const typedOptions = options as unknown as LoadConfigOptions;
  const env = (typedOptions.env ?? process.env) as Record<
    string,
    string | undefined
  >;
  const configPath = typedOptions.configPath ?? env[CONFIG_ENV];
  const fileOverrides =
    configPath === undefined ? {} : parseConfigFile(configPath);
  const envOverrides = environmentOverrides(env);
  const cliOverrides = typedOptions.overrides ?? {};
  validateConfigOverrides(cliOverrides, "CLI overrides");

  const merged = cloneDefaultConfig() as unknown as Record<string, unknown>;
  // Drop the alias properties so the merge works only through policy.hosts.
  delete (merged.policy as Record<string, unknown>).routes;
  delete (merged.policy as Record<string, unknown>).fallback;
  mergeInto(merged, normalizeOverrides(fileOverrides));
  mergeInto(merged, normalizeOverrides(envOverrides));
  mergeInto(merged, normalizeOverrides(cliOverrides));
  return assertFinalConfig(merged as unknown as RouterConfig);
}

export { CONFIG_ENV };

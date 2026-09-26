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
  PolicyRoutes,
  PolicyThresholds,
  ReasoningEffort,
  RoutingPolicy,
  RoutingTarget,
} from "../policy/types.js";
import { validateRoutingPolicy } from "../policy/default-policy.js";

const CONFIG_ENV = "CODEX_SYSTEMONE_ROUTER_CONFIG";
const PREFIX = "CODEX_SYSTEMONE_ROUTER_";
const DIFFICULTIES = ["low", "medium", "high", "xhigh"] as const;
const REASONING_EFFORTS = new Set<ReasoningEffort>(DIFFICULTIES);
const ALLOWED_ROOT_KEYS = new Set(["backend", "policy"]);
const ALLOWED_BACKEND_KEYS = new Set(["type", "url", "model", "timeout_ms"]);
const ALLOWED_POLICY_KEYS = new Set(["thresholds", "routes", "fallback"]);
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
      assertRecord(value.policy.routes, `${path}.policy.routes`);
      for (const key of Object.keys(value.policy.routes)) {
        if (!(DIFFICULTIES as readonly string[]).includes(key)) {
          throw new ConfigValidationError(
            `${path}.policy.routes contains unknown key ${key}`,
          );
        }
        validatePartialTarget(
          value.policy.routes[key],
          `${path}.policy.routes.${key}`,
        );
      }
    }
    if ("fallback" in value.policy) {
      validatePartialTarget(value.policy.fallback, `${path}.policy.fallback`);
    }
  }
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

  if (Object.keys(thresholds).length > 0) policy.thresholds = thresholds;
  if (Object.keys(routes).length > 0) policy.routes = routes;
  if (fallbackModel !== undefined || fallbackEffort !== undefined) {
    policy.fallback = fallback;
  }

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

function cloneConfig(value: RouterConfig): RouterConfig {
  return {
    backend: { ...value.backend },
    policy: {
      thresholds: { ...value.policy.thresholds },
      routes: {
        low: { ...value.policy.routes.low },
        medium: { ...value.policy.routes.medium },
        high: { ...value.policy.routes.high },
        xhigh: { ...value.policy.routes.xhigh },
      },
      fallback: { ...value.policy.fallback },
    },
  };
}

function assertFinalConfig(value: RouterConfig): RouterConfig {
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
  mergeInto(merged, fileOverrides as unknown as Record<string, unknown>);
  mergeInto(merged, envOverrides as unknown as Record<string, unknown>);
  mergeInto(merged, cliOverrides as unknown as Record<string, unknown>);
  return assertFinalConfig(merged as unknown as RouterConfig);
}

export { CONFIG_ENV };

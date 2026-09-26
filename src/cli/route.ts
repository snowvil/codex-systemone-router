import { OllayaBackend } from "../backend/ollaya.js";
import { cloneDefaultConfig } from "../config/defaults.js";
import { loadConfig } from "../config/loader.js";
import type { ConfigOverrides } from "../config/types.js";
import { isRouterError, type RouterErrorReason } from "../errors/errors.js";
import { fallbackResult, routeDecision } from "../policy/default-policy.js";
import type { ReasoningEffort, RoutingResult } from "../policy/types.js";
import { parseOptions, stringFlag } from "./options.js";

const VALUE_OPTIONS = [
  "--config",
  "--backend-url",
  "--backend-model",
  "--timeout-ms",
  "--fallback-model",
  "--fallback-reasoning-effort",
] as const;
const MAX_TASK_LENGTH = 100_000;

function effort(value: string | undefined): ReasoningEffort | undefined {
  if (value === undefined) return undefined;
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  )
    return value;
  throw new Error(
    "Fallback reasoning effort must be low, medium, high, or xhigh",
  );
}

function overrides(flags: Record<string, string | boolean>): ConfigOverrides {
  const url = stringFlag(flags, "--backend-url");
  const model = stringFlag(flags, "--backend-model");
  const timeout = stringFlag(flags, "--timeout-ms");
  const fallbackModel = stringFlag(flags, "--fallback-model");
  const fallbackEffort = effort(
    stringFlag(flags, "--fallback-reasoning-effort"),
  );
  const timeoutMs = timeout === undefined ? undefined : Number(timeout);
  return {
    ...(url !== undefined || model !== undefined || timeoutMs !== undefined
      ? {
          backend: {
            ...(url === undefined ? {} : { url }),
            ...(model === undefined ? {} : { model }),
            ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
          },
        }
      : {}),
    ...(fallbackModel !== undefined || fallbackEffort !== undefined
      ? {
          policy: {
            fallback: {
              ...(fallbackModel === undefined ? {} : { model: fallbackModel }),
              ...(fallbackEffort === undefined
                ? {}
                : { reasoning_effort: fallbackEffort }),
            },
          },
        }
      : {}),
  };
}

async function stdinTask(): Promise<string> {
  let task = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    task += chunk.toString();
    if (task.length > MAX_TASK_LENGTH) throw new Error("Task is too long");
  }
  return task;
}

function jsonResult(result: RoutingResult): Record<string, unknown> {
  return {
    difficulty: result.difficulty,
    score: result.score,
    model: result.target.model,
    reasoning_effort: result.target.reasoning_effort,
    probabilities: result.decision.probabilities,
    backend: result.decision.backend,
    decision_model: result.decision.decisionModel ?? null,
    latency_ms: result.decision.latencyMs ?? null,
    fallback: result.fallback,
    reason: result.reason ?? null,
  };
}

function reasonFor(error: unknown): RouterErrorReason {
  return isRouterError(error) ? error.reason : "backend_unavailable";
}

export async function runRoute(args: string[]): Promise<number> {
  const { flags, positionals } = parseOptions(
    args,
    ["--json", "--stdin"],
    VALUE_OPTIONS,
  );
  const useStdin = flags["--stdin"] === true;
  if (
    (useStdin && positionals.length > 0) ||
    (!useStdin && positionals.length !== 1)
  ) {
    throw new Error("Provide exactly one task argument, or use --stdin");
  }
  const task = useStdin ? await stdinTask() : (positionals[0] ?? "");
  if (task.trim().length === 0) throw new Error("Task must not be empty");
  if (task.length > MAX_TASK_LENGTH) throw new Error("Task is too long");

  let result: RoutingResult;
  let config;
  try {
    config = await loadConfig({
      configPath: stringFlag(flags, "--config"),
      overrides: overrides(flags),
    });
  } catch {
    process.stderr.write(
      "Warning: invalid configuration; using built-in fallback.\n",
    );
    result = fallbackResult(cloneDefaultConfig(), "invalid_configuration");
    emit(result, flags["--json"] === true);
    return 0;
  }

  try {
    const backend = new OllayaBackend({
      url: config.backend.url,
      model: config.backend.model,
      timeoutMs: config.backend.timeout_ms,
    });
    result = routeDecision(await backend.decide({ task }), config);
  } catch (error) {
    const reason = reasonFor(error);
    process.stderr.write(`Warning: routing used fallback (${reason}).\n`);
    result = fallbackResult(config, reason);
  }
  emit(result, flags["--json"] === true);
  return 0;
}

function emit(result: RoutingResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(jsonResult(result))}\n`);
    return;
  }
  process.stdout.write(
    `Difficulty: ${result.difficulty} (score ${result.score.toFixed(3)})\n` +
      `Model: ${result.target.model}\n` +
      `Reasoning effort: ${result.target.reasoning_effort}\n` +
      (result.fallback ? `Fallback: ${result.reason}\n` : ""),
  );
}

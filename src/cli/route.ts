import { OllayaBackend } from "../backend/ollaya.js";
import { ConfigValidationError, loadConfig } from "../config/loader.js";
import type { ConfigOverrides } from "../config/types.js";
import { isExpectedBackendError } from "../errors/errors.js";
import {
  fallbackResult,
  PolicyValidationError,
  routeDecision,
} from "../policy/default-policy.js";
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
  throw new ConfigValidationError(
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
    policy: result.policy,
    difficulty: result.difficulty,
    score: result.score,
    model: result.target.model,
    reasoning_effort: result.target.reasoning_effort,
    declared_choice: result.declaredChoice,
    probability_argmax: result.probabilityArgmax,
    choice_argmax_disagreement: result.choiceArgmaxDisagreement,
    probabilities: result.decision.probabilities,
    backend: result.decision.backend,
    decision_model: result.decision.decisionModel ?? null,
    latency_ms: result.decision.latencyMs ?? null,
    fallback: result.fallback,
    reason: result.reason ?? null,
  };
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
  } catch (error) {
    if (
      error instanceof ConfigValidationError ||
      error instanceof PolicyValidationError
    ) {
      process.stderr.write("Configuration is invalid or unavailable.\n");
      return 2;
    }
    throw new Error("Configuration could not be loaded");
  }

  try {
    const backend = new OllayaBackend({
      url: config.backend.url,
      model: config.backend.model,
      timeoutMs: config.backend.timeout_ms,
    });
    result = routeDecision(await backend.decide({ task }), config);
  } catch (error) {
    if (!isExpectedBackendError(error)) {
      throw new Error("Routing failed internally");
    }
    const reason = error.reason;
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
      `Policy: ${result.policy}\n` +
      `Model: ${result.target.model}\n` +
      `Reasoning effort: ${result.target.reasoning_effort}\n` +
      (result.fallback ? `Fallback: ${result.reason}\n` : ""),
  );
}

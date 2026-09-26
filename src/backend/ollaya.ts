import { normalizeProbabilities, ordinalScore } from "../policy/score.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { DecisionBackend, HealthStatus } from "./types.js";
import type {
  DecisionRequest,
  Difficulty,
  DifficultyDecision,
} from "../decision/types.js";
import {
  isRouterError,
  RouterError,
  type RouterErrorReason,
} from "../errors/errors.js";

export const DEFAULT_OLLAYA_URL = DEFAULT_CONFIG.backend.url;
export const DEFAULT_OLLAYA_MODEL = DEFAULT_CONFIG.backend.model;
export const DEFAULT_OLLAYA_TIMEOUT_MS = DEFAULT_CONFIG.backend.timeout_ms;

export const OLLAYA_QUESTION_NAME = "reasoning_effort";
export const OLLAYA_QUESTION_INSTRUCTIONS =
  "How much reasoning effort should a Codex software engineering agent use to complete this task reliably?";

export const OLLAYA_QUESTION_CRITERIA = {
  low: "Simple mechanical or highly predictable change requiring little investigation.",
  medium:
    "Normal software engineering task requiring understanding of existing code and localized changes.",
  high: "Complex task requiring substantial investigation, debugging, cross-module reasoning, concurrency analysis, or architecture-sensitive decisions.",
  xhigh:
    "Exceptionally difficult or ambiguous task requiring deep investigation, multiple competing hypotheses, or architectural reasoning where mistakes are costly.",
} as const;

/** Ollaya adapter settings. All fields are optional because v0.1 has defaults. */
export interface OllayaBackendOptions {
  url?: string;
  model?: string;
  timeoutMs?: number;
}

interface OllayaChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: typeof OLLAYA_QUESTION_CRITERIA;
}

interface OllayaRequestBody {
  model: string;
  state: string;
  questions: {
    reasoning_effort: OllayaChoiceQuestion;
  };
}

const DIFFICULTIES: readonly Difficulty[] = ["low", "medium", "high", "xhigh"];
const MAX_RESPONSE_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDifficulty(value: unknown): value is Difficulty {
  return (
    typeof value === "string" &&
    DIFFICULTIES.some((difficulty) => difficulty === value)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invalidResponse(message: string): RouterError {
  return new RouterError("malformed_response", `Ollaya response ${message}`);
}

function parseLatencyMs(value: unknown, elapsedMs: number): number {
  if (value === undefined) {
    return elapsedMs;
  }
  if (!isFiniteNumber(value) || value < 0) {
    throw invalidResponse(
      "total_duration must be a non-negative finite number",
    );
  }
  return value / 1_000_000;
}

/**
 * Parse the stable subset of Ollaya's response into the backend-neutral type.
 * Exported for focused tests and for callers that need to validate fixtures.
 */
export function parseOllayaResponse(
  value: unknown,
  elapsedMs: number,
  model: string,
): DifficultyDecision {
  if (!isRecord(value)) {
    throw invalidResponse("must be a JSON object");
  }

  if (
    value.state_truncated !== undefined &&
    typeof value.state_truncated !== "boolean"
  ) {
    throw invalidResponse("state_truncated must be a boolean");
  }
  if (value.state_truncated === true) {
    throw new RouterError(
      "input_truncated",
      "Ollaya could not evaluate the complete task",
    );
  }

  const answers = value.answers;
  if (!isRecord(answers)) {
    throw invalidResponse("is missing answers");
  }

  const answer = answers[OLLAYA_QUESTION_NAME];
  if (!isRecord(answer)) {
    throw invalidResponse("is missing the reasoning_effort answer");
  }

  const choice = answer.choice;
  if (!isDifficulty(choice)) {
    throw invalidResponse("has an unknown reasoning_effort choice");
  }

  const probabilities = normalizeProbabilities(answer.probabilities);
  const confidence = answer.confidence;
  if (
    confidence !== undefined &&
    (!isFiniteNumber(confidence) || confidence < 0 || confidence > 1)
  ) {
    throw invalidResponse(
      "confidence must be a finite number in the range 0..1",
    );
  }

  const latencyMs = parseLatencyMs(value.total_duration, elapsedMs);
  return {
    choice,
    ...(confidence === undefined ? {} : { confidence }),
    probabilities,
    score: ordinalScore(probabilities),
    latencyMs,
    backend: "ollaya",
    decisionModel: model,
  };
}

function validateOptions(options: {
  url: string;
  model: string;
  timeoutMs: number;
}): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(options.url);
  } catch {
    throw new RouterError(
      "invalid_configuration",
      "Ollaya URL must be a valid URL",
    );
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new RouterError(
      "invalid_configuration",
      "Ollaya URL must use http or https",
    );
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new RouterError(
      "invalid_configuration",
      "Ollaya URL must not contain credentials",
    );
  }
  if (
    typeof options.model !== "string" ||
    options.model.trim().length === 0 ||
    options.model.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(options.model)
  ) {
    throw new RouterError(
      "invalid_configuration",
      "Ollaya model must not be empty",
    );
  }
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > 120_000
  ) {
    throw new RouterError(
      "invalid_configuration",
      "Ollaya timeoutMs must be an integer from 1 to 120000",
    );
  }
}

function errorReason(
  error: unknown,
  fallback: RouterErrorReason,
): RouterErrorReason {
  return isRouterError(error) ? error.reason : fallback;
}

export class OllayaBackend implements DecisionBackend {
  readonly url: string;
  readonly model: string;
  readonly timeoutMs: number;

  constructor(options: OllayaBackendOptions = {}) {
    this.url = options.url ?? DEFAULT_OLLAYA_URL;
    this.model = options.model ?? DEFAULT_OLLAYA_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OLLAYA_TIMEOUT_MS;
    validateOptions({
      url: this.url,
      model: this.model,
      timeoutMs: this.timeoutMs,
    });
  }

  async decide(request: DecisionRequest): Promise<DifficultyDecision> {
    if (
      !isRecord(request) ||
      typeof request.task !== "string" ||
      request.task.trim().length === 0
    ) {
      throw new RouterError(
        "invalid_configuration",
        "Decision request task must be a non-empty string",
      );
    }

    const body: OllayaRequestBody = {
      model: this.model,
      state: request.task,
      questions: {
        [OLLAYA_QUESTION_NAME]: {
          type: "choice",
          instructions: OLLAYA_QUESTION_INSTRUCTIONS,
          criteria: OLLAYA_QUESTION_CRITERIA,
        },
      },
    };
    const controller = new AbortController();
    const startedAt = performance.now();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      clearTimeout(timeoutHandle);
      if (timedOut || (isRecord(error) && error.name === "AbortError")) {
        throw new RouterError("timeout", "Ollaya request timed out");
      }
      throw new RouterError(
        "backend_unavailable",
        "Ollaya backend is unavailable",
      );
    }

    if (!response.ok) {
      controller.abort();
      clearTimeout(timeoutHandle);
      throw new RouterError(
        "backend_unavailable",
        `Ollaya returned HTTP ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      if (!response.body) throw invalidResponse("has no body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let byteCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteCount += value.byteLength;
        if (byteCount > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw invalidResponse("exceeds the 1 MiB size limit");
        }
        chunks.push(value);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch (error) {
      if (isRouterError(error)) throw error;
      if (timedOut || (isRecord(error) && error.name === "AbortError")) {
        throw new RouterError("timeout", "Ollaya request timed out");
      }
      throw new RouterError(
        "malformed_response",
        "Ollaya returned malformed JSON",
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    try {
      return parseOllayaResponse(
        payload,
        performance.now() - startedAt,
        this.model,
      );
    } catch (error) {
      if (isRouterError(error)) {
        throw error;
      }
      throw new RouterError(
        errorReason(error, "malformed_response"),
        "Ollaya returned an invalid response",
      );
    }
  }

  /** Run one typed-choice request so doctor can verify reachability and schema. */
  async healthCheck(): Promise<HealthStatus> {
    const startedAt = performance.now();
    try {
      await this.decide({
        task: "Classify this health check as a simple local operation.",
      });
      return {
        healthy: true,
        backend: "ollaya",
        latencyMs: performance.now() - startedAt,
        model: this.model,
      };
    } catch (error) {
      return {
        healthy: false,
        backend: "ollaya",
        latencyMs: performance.now() - startedAt,
        reason: isRouterError(error) ? error.reason : "backend_unavailable",
        model: this.model,
      };
    }
  }
}

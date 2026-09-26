import { RouterError } from "../errors/errors.js";
import type { Probabilities } from "../decision/types.js";

const DIFFICULTIES = ["low", "medium", "high", "xhigh"] as const;
const PROBABILITY_SUM_TOLERANCE = 0.01;

/** Thrown when a backend supplies a probability distribution we cannot trust. */
export class ProbabilityValidationError extends RouterError {
  constructor(message: string) {
    super("invalid_probabilities", message);
    this.name = "ProbabilityValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validate and normalize a difficulty distribution.
 *
 * Kev responses are JSON data and therefore untrusted. Small floating point
 * drift around a sum of one is harmless, so it is normalized; a materially
 * inconsistent distribution is rejected instead of silently changing policy.
 */
export function normalizeProbabilities(value: unknown): Probabilities {
  if (!isRecord(value)) {
    throw new ProbabilityValidationError("probabilities must be an object");
  }

  const values = DIFFICULTIES.map((difficulty) => {
    const probability = value[difficulty];
    if (typeof probability !== "number" || !Number.isFinite(probability)) {
      throw new ProbabilityValidationError(
        `probability ${difficulty} must be a finite number`,
      );
    }
    if (probability < 0 || probability > 1) {
      throw new ProbabilityValidationError(
        `probability ${difficulty} must be between 0 and 1`,
      );
    }
    return probability;
  });

  const sum = values.reduce((total, probability) => total + probability, 0);
  if (
    sum <= 0 ||
    Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE + Number.EPSILON * 4
  ) {
    throw new ProbabilityValidationError(
      `probabilities must sum to 1 (received ${sum})`,
    );
  }

  return {
    low: values[0] / sum,
    medium: values[1] / sum,
    high: values[2] / sum,
    xhigh: values[3] / sum,
  };
}

/** Return the expected ordinal difficulty (low=0 through xhigh=3). */
export function ordinalScore(probabilities: Probabilities): number {
  const normalized = normalizeProbabilities(probabilities);
  return normalized.medium + normalized.high * 2 + normalized.xhigh * 3;
}

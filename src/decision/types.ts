/** The four ordinal difficulty levels understood by the v0.1 router. */
export type Difficulty = "low" | "medium" | "high" | "xhigh";

/** Reasoning effort values accepted by Codex subagent targets. */
export type ReasoningEffort = Difficulty;

/** A probability distribution over the ordinal difficulty levels. */
export interface DifficultyProbabilities {
  low: number;
  medium: number;
  high: number;
  xhigh: number;
}

/** The only input a decision backend receives. */
export interface DecisionRequest {
  task: string;
}

/**
 * A backend's normalized estimate.
 *
 * Backends expose probabilities and the ordinal score together so policies can
 * make a deterministic choice without depending on backend-specific response
 * shapes. The score is the expected ordinal value in the range 0..3.
 */
export interface DifficultyDecision {
  choice: Difficulty;
  confidence?: number;
  probabilities: DifficultyProbabilities;
  score: number;
  latencyMs?: number;
  backend: string;
  decisionModel?: string;
}

/** Backwards-compatible concise names used by policy modules and adapters. */
export type Probabilities = DifficultyProbabilities;
export type Decision = DifficultyDecision;

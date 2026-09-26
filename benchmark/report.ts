#!/usr/bin/env node
/**
 * Run representative fixtures through the same backend and policy as the CLI
 * and print an evidence-oriented report. This is intentionally a thin
 * validation tool rather than runtime coupling or a calibration service.
 */
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OllayaBackend } from "../src/backend/ollaya.js";
import { loadConfig } from "../src/config/loader.js";
import { routeDecision } from "../src/policy/default-policy.js";
import { isRouterError } from "../src/errors/errors.js";

type Difficulty = "low" | "medium" | "high" | "xhigh";
const difficulties: readonly Difficulty[] = ["low", "medium", "high", "xhigh"];

interface Fixture {
  id: string;
  difficulty: Difficulty;
  task: string;
}

interface FixtureFile {
  name?: string;
  canonical?: boolean;
  description?: string;
  tasks: Fixture[];
}

interface Observation {
  fixture: Fixture;
  predicted: Difficulty;
  score: number | undefined;
  probabilities: Partial<Record<Difficulty, number>> | undefined;
  latencyMs: number;
  fallback: boolean;
  reason?: string;
}

function isDifficulty(value: unknown): value is Difficulty {
  return (
    typeof value === "string" && difficulties.includes(value as Difficulty)
  );
}

export function parseFixtureFile(value: unknown): FixtureFile {
  const raw = Array.isArray(value) ? { tasks: value } : value;
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { tasks?: unknown }).tasks)
  ) {
    throw new Error(
      "benchmark fixture must be an array or an object with a tasks array",
    );
  }
  const tasks = (raw as { tasks: unknown[] }).tasks.map(
    (item, index): Fixture => {
      if (!item || typeof item !== "object")
        throw new Error(`fixture ${index + 1} is not an object`);
      const fixture = item as Partial<Fixture>;
      if (
        typeof fixture.id !== "string" ||
        typeof fixture.task !== "string" ||
        !isDifficulty(fixture.difficulty)
      ) {
        throw new Error(
          `fixture ${index + 1} must contain id, task, and a known difficulty`,
        );
      }
      return {
        id: fixture.id,
        task: fixture.task,
        difficulty: fixture.difficulty,
      };
    },
  );
  return { ...(raw as Omit<FixtureFile, "tasks">), tasks };
}

export function quantile(
  values: readonly number[],
  percentile: number,
): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] as number;
  const fraction = index - lower;
  return (
    (sorted[lower] as number) +
    ((sorted[upper] as number) - (sorted[lower] as number)) * fraction
  );
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

export function renderReport(
  fixtures: FixtureFile,
  observations: readonly Observation[],
): string {
  const evaluated = observations.filter((item) => !item.fallback);
  const exact = evaluated.filter(
    (item) => item.predicted === item.fixture.difficulty,
  ).length;
  const withinOne = evaluated.filter(
    (item) =>
      Math.abs(
        difficulties.indexOf(item.predicted) -
          difficulties.indexOf(item.fixture.difficulty),
      ) <= 1,
  ).length;
  const latencies = observations.map((item) => item.latencyMs);
  const fallbackCount = observations.filter((item) => item.fallback).length;
  const matrix = new Map<Difficulty, Map<Difficulty, number>>();
  for (const actual of difficulties)
    matrix.set(
      actual,
      new Map(difficulties.map((predicted) => [predicted, 0])),
    );
  for (const item of evaluated) {
    const row = matrix.get(item.fixture.difficulty);
    row?.set(item.predicted, (row.get(item.predicted) ?? 0) + 1);
  }
  const scoreValues = evaluated
    .map((item) => item.score)
    .filter((value): value is number => value !== undefined);
  const scoreMean = scoreValues.length
    ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length
    : Number.NaN;
  const lines = [
    `Benchmark: ${fixtures.name ?? "fixtures"}${fixtures.canonical === false ? " (representative; not canonical)" : ""}`,
    `Tasks: ${observations.length}`,
    "Predictions below are policy routes; labels are heuristic references.",
    `Evaluated backend decisions: ${evaluated.length}/${observations.length}`,
    `Exact accuracy: ${formatNumber((exact / evaluated.length) * 100)}% (${exact}/${evaluated.length})`,
    `Within ±1 ordinal class: ${formatNumber((withinOne / evaluated.length) * 100)}% (${withinOne}/${evaluated.length})`,
    `Fallbacks: ${fallbackCount}/${observations.length}`,
    "",
    "Confusion matrix (actual rows, predicted columns):",
    `actual\\predicted\t${difficulties.join("\t")}`,
    ...difficulties.map(
      (actual) =>
        `${actual}\t${difficulties.map((predicted) => matrix.get(actual)?.get(predicted) ?? 0).join("\t")}`,
    ),
    "",
    "End-to-end latency including fallback attempts (ms):",
    `avg=${formatNumber(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)} p50=${formatNumber(quantile(latencies, 0.5))} p95=${formatNumber(quantile(latencies, 0.95))} p99=${formatNumber(quantile(latencies, 0.99))}`,
    "",
    `Score distribution: n=${scoreValues.length} avg=${formatNumber(scoreMean)} p50=${formatNumber(quantile(scoreValues, 0.5))} p95=${formatNumber(quantile(scoreValues, 0.95))} min=${formatNumber(scoreValues.length ? Math.min(...scoreValues) : Number.NaN)} max=${formatNumber(scoreValues.length ? Math.max(...scoreValues) : Number.NaN)}`,
  ];
  if (fixtures.description) lines.push(`Note: ${fixtures.description}`);
  return `${lines.join("\n")}\n`;
}

export async function runBenchmark(
  path = resolve(process.cwd(), "benchmark/tasks.json"),
): Promise<string> {
  const fixtures = parseFixtureFile(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );
  const config = loadConfig();
  const backend = new OllayaBackend({
    url: config.backend.url,
    model: config.backend.model,
    timeoutMs: config.backend.timeout_ms,
  });
  const observations: Observation[] = [];
  for (const fixture of fixtures.tasks) {
    const started = performance.now();
    try {
      const result = routeDecision(
        await backend.decide({ task: fixture.task }),
        config,
      );
      observations.push({
        fixture,
        predicted: result.difficulty,
        score: result.score,
        probabilities: result.decision.probabilities,
        latencyMs: performance.now() - started,
        fallback: false,
      });
    } catch (error) {
      observations.push({
        fixture,
        predicted: "high",
        score: undefined,
        probabilities: undefined,
        latencyMs: performance.now() - started,
        fallback: true,
        reason: isRouterError(error) ? error.reason : "backend_unavailable",
      });
    }
  }
  return renderReport(fixtures, observations);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(await runBenchmark());
  } catch (error) {
    process.stderr.write(
      `Benchmark error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

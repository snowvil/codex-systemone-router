#!/usr/bin/env node
/** Offline replay of historical difficulty probabilities; no backend calls. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DIFFICULTIES = ["low", "medium", "high", "xhigh"] as const;
const REQUIRED_COLUMNS = [
  "id",
  "expected",
  "actual",
  "p_low",
  "p_medium",
  "p_high",
  "p_xhigh",
] as const;
const LEGACY_THRESHOLDS = [0.75, 1.75, 2.55] as const;
const PROBABILITY_SUM_TOLERANCE = 0.01;

export type Difficulty = (typeof DIFFICULTIES)[number];
export type Distribution = Record<Difficulty, number>;

export interface ReplayRow {
  id: string;
  expected: Difficulty;
  actual: Difficulty;
  probabilities: Distribution;
  historicalEvalMs?: number;
}

export interface ReplayCase {
  id: string;
  label: Difficulty;
  recordedChoice: Difficulty;
  argmax: Difficulty;
  legacyScore: number;
  legacyBucket: Difficulty;
  candidateBucket: Difficulty;
}

export interface PolicyMetrics {
  exact: number;
  withinOne: number;
  under: number;
  over: number;
  severeUnder: number;
  confusion: number[][];
  perClassRecall: Record<Difficulty, number | null>;
  targetDistribution: Distribution;
  policyInducedDowngradeCount: number;
  policyInducedDowngradeIds: string[];
}

export interface ReplayAnalysis {
  rows: number;
  labelDistribution: Distribution;
  cases: ReplayCase[];
  policies: {
    recorded: PolicyMetrics;
    argmax: PolicyMetrics;
    legacy: PolicyMetrics;
    candidate: PolicyMetrics;
  };
  choiceArgmaxDisagreements: { count: number; ids: string[] };
  historicalEvalMs: { count: number; average: number | null };
}

function isDifficulty(value: string): value is Difficulty {
  return DIFFICULTIES.some((difficulty) => difficulty === value);
}

function emptyDistribution(): Distribution {
  return { low: 0, medium: 0, high: 0, xhigh: 0 };
}

/** Parse standard quoted CSV fields and reject malformed quote placement. */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let fieldStarted = false;

  function endField(): void {
    record.push(field);
    field = "";
    closedQuote = false;
    fieldStarted = false;
  }

  function endRecord(): void {
    endField();
    records.push(record);
    record = [];
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      if (fieldStarted || closedQuote) {
        throw new Error(`malformed CSV quote near character ${index + 1}`);
      }
      quoted = true;
      fieldStarted = true;
    } else if (character === ",") {
      endField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      endRecord();
    } else {
      if (closedQuote) {
        throw new Error(
          `unexpected character after CSV quote near ${index + 1}`,
        );
      }
      field += character;
      fieldStarted = true;
    }
  }
  if (quoted) throw new Error("unterminated CSV quote");
  if (fieldStarted || closedQuote || field.length > 0 || record.length > 0) {
    endRecord();
  }
  return records;
}

function finiteNumber(value: string, name: string, row: number): number {
  if (value.trim() === "")
    throw new Error(`row ${row}: ${name} must be a finite number`);
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`row ${row}: ${name} must be a finite number`);
  }
  return number;
}

/** Parse any size replay dataset, rejecting every malformed data row. */
export function parseReplayCsv(text: string): ReplayRow[] {
  const records = csvRecords(text.replace(/^\uFEFF/, ""));
  if (records.length < 2)
    throw new Error("replay CSV requires a header and data rows");
  const columns = records[0]!.map((column) => column.trim());
  if (new Set(columns).size !== columns.length) {
    throw new Error("replay CSV has duplicate columns");
  }
  for (const column of REQUIRED_COLUMNS) {
    if (!columns.includes(column))
      throw new Error(`missing required column ${column}`);
  }
  const columnIndex = new Map(columns.map((column, index) => [column, index]));
  const ids = new Set<string>();
  const rows: ReplayRow[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]!;
    const rowNumber = index + 1;
    if (record.length !== columns.length) {
      throw new Error(
        `row ${rowNumber}: expected ${columns.length} columns, got ${record.length}`,
      );
    }
    const get = (name: string): string =>
      record[columnIndex.get(name)!]!.trim();
    const id = get("id");
    if (!id) throw new Error(`row ${rowNumber}: empty id`);
    if (ids.has(id)) throw new Error(`row ${rowNumber}: duplicate id ${id}`);
    ids.add(id);
    const expected = get("expected");
    const actual = get("actual");
    if (!isDifficulty(expected))
      throw new Error(`row ${rowNumber}: invalid expected label`);
    if (!isDifficulty(actual))
      throw new Error(`row ${rowNumber}: invalid actual choice`);
    const probabilities = {} as Distribution;
    for (const difficulty of DIFFICULTIES) {
      const probability = finiteNumber(
        get(`p_${difficulty}`),
        `p_${difficulty}`,
        rowNumber,
      );
      if (probability < 0 || probability > 1) {
        throw new Error(
          `row ${rowNumber}: p_${difficulty} must be between 0 and 1`,
        );
      }
      probabilities[difficulty] = probability;
    }
    const sum = DIFFICULTIES.reduce(
      (total, difficulty) => total + probabilities[difficulty],
      0,
    );
    if (
      sum <= 0 ||
      Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE + Number.EPSILON * 4
    ) {
      throw new Error(
        `row ${rowNumber}: probabilities must sum to 1 (received ${sum})`,
      );
    }
    let historicalEvalMs: number | undefined;
    if (columnIndex.has("eval_ms")) {
      historicalEvalMs = finiteNumber(get("eval_ms"), "eval_ms", rowNumber);
      if (historicalEvalMs < 0)
        throw new Error(`row ${rowNumber}: eval_ms must be nonnegative`);
    }
    rows.push({
      id,
      expected,
      actual,
      probabilities,
      ...(historicalEvalMs === undefined ? {} : { historicalEvalMs }),
    });
  }
  return rows;
}

function rank(difficulty: Difficulty): number {
  return DIFFICULTIES.indexOf(difficulty);
}

function argmax(probabilities: Distribution): Difficulty {
  // First maximum wins, so tied classes choose the lower ordinal difficulty.
  return DIFFICULTIES.reduce((best, current) =>
    probabilities[current] > probabilities[best] ? current : best,
  );
}

function legacyBucket(score: number): Difficulty {
  if (score < LEGACY_THRESHOLDS[0]) return "low";
  if (score < LEGACY_THRESHOLDS[1]) return "medium";
  if (score < LEGACY_THRESHOLDS[2]) return "high";
  return "xhigh";
}

function metrics(
  cases: readonly ReplayCase[],
  select: (item: ReplayCase) => Difficulty,
): PolicyMetrics {
  const confusion = DIFFICULTIES.map(() => DIFFICULTIES.map(() => 0));
  const targetDistribution = emptyDistribution();
  const policyInducedDowngradeIds: string[] = [];
  let exact = 0;
  let withinOne = 0;
  let under = 0;
  let over = 0;
  let severeUnder = 0;
  for (const item of cases) {
    const target = select(item);
    const difference = rank(target) - rank(item.label);
    confusion[rank(item.label)]![rank(target)]! += 1;
    targetDistribution[target] += 1;
    if (difference === 0) exact += 1;
    if (Math.abs(difference) <= 1) withinOne += 1;
    if (difference < 0) under += 1;
    if (difference > 0) over += 1;
    if (difference <= -2) severeUnder += 1;
    if (rank(target) < rank(item.recordedChoice))
      policyInducedDowngradeIds.push(item.id);
  }
  const perClassRecall = {} as Record<Difficulty, number | null>;
  for (const difficulty of DIFFICULTIES) {
    const labelCount = confusion[rank(difficulty)]!.reduce(
      (sum, count) => sum + count,
      0,
    );
    perClassRecall[difficulty] =
      labelCount === 0
        ? null
        : confusion[rank(difficulty)]![rank(difficulty)]! / labelCount;
  }
  return {
    exact,
    withinOne,
    under,
    over,
    severeUnder,
    confusion,
    perClassRecall,
    targetDistribution,
    policyInducedDowngradeCount: policyInducedDowngradeIds.length,
    policyInducedDowngradeIds,
  };
}

/** Recompute all comparisons from CSV values; no baseline result is imported. */
export function analyzeReplay(rows: readonly ReplayRow[]): ReplayAnalysis {
  const labelDistribution = emptyDistribution();
  const cases = rows.map((row): ReplayCase => {
    labelDistribution[row.expected] += 1;
    const sum = DIFFICULTIES.reduce(
      (total, difficulty) => total + row.probabilities[difficulty],
      0,
    );
    const legacyScore =
      (row.probabilities.medium +
        2 * row.probabilities.high +
        3 * row.probabilities.xhigh) /
      sum;
    const bucket = legacyBucket(legacyScore);
    return {
      id: row.id,
      label: row.expected,
      recordedChoice: row.actual,
      argmax: argmax(row.probabilities),
      legacyScore,
      legacyBucket: bucket,
      candidateBucket: rank(row.actual) > rank(bucket) ? row.actual : bucket,
    };
  });
  const disagreementIds = cases
    .filter((item) => item.recordedChoice !== item.argmax)
    .map((item) => item.id);
  const historical = rows
    .map((row) => row.historicalEvalMs)
    .filter((value): value is number => value !== undefined);
  return {
    rows: rows.length,
    labelDistribution,
    cases,
    policies: {
      recorded: metrics(cases, (item) => item.recordedChoice),
      argmax: metrics(cases, (item) => item.argmax),
      legacy: metrics(cases, (item) => item.legacyBucket),
      candidate: metrics(cases, (item) => item.candidateBucket),
    },
    choiceArgmaxDisagreements: {
      count: disagreementIds.length,
      ids: disagreementIds,
    },
    historicalEvalMs: {
      count: historical.length,
      average: historical.length
        ? historical.reduce((sum, value) => sum + value, 0) / historical.length
        : null,
    },
  };
}

function distributionText(distribution: Distribution): string {
  return DIFFICULTIES.map(
    (difficulty) => `${difficulty}=${distribution[difficulty]}`,
  ).join(" ");
}

function formatPolicy(
  name: string,
  policy: PolicyMetrics,
  rows: number,
): string[] {
  return [
    `${name}: exact=${policy.exact}/${rows} within-one=${policy.withinOne}/${rows} under=${policy.under} over=${policy.over} severe-under=${policy.severeUnder}`,
    `  policy-induced downgrade versus recorded choice: ${policy.policyInducedDowngradeCount} [${policy.policyInducedDowngradeIds.join(", ")}]`,
    `  target distribution: ${distributionText(policy.targetDistribution)}`,
    `  per-class recall: ${DIFFICULTIES.map((difficulty) => `${difficulty}=${policy.perClassRecall[difficulty] === null ? "n/a" : (100 * policy.perClassRecall[difficulty]!).toFixed(2) + "%"}`).join(" ")}`,
    "  confusion (label rows, target columns low medium high xhigh):",
    ...policy.confusion.map(
      (row, index) => `    ${DIFFICULTIES[index]}: ${row.join(" ")}`,
    ),
  ];
}

export function renderReplay(
  analysis: ReplayAnalysis,
  sha256: string,
  replayRuntimeMs: number,
): string {
  const lines = [
    "Offline historical probability replay (no Ollaya or Codex execution)",
    `Dataset SHA-256: ${sha256}`,
    `Rows: ${analysis.rows}; label distribution: ${distributionText(analysis.labelDistribution)}`,
    "Labels are heuristic difficulty labels, not Codex success ground truth or task outcomes.",
    "Question identifier: reasoning_effort; historical exact question wording: unknown",
    "Historical model digest: unknown; historical runtime version: unknown",
    "Config identifier: offline-replay-fixed-v1 (logical difficulty only; model/effort targets unavailable)",
    "Policy identifiers: recorded-choice; low-first-probability-argmax; legacy-ordinal-[0.75,1.75,2.55]; candidate-max(recorded-choice,legacy-bucket)",
    "Legacy score: (p_medium + 2*p_high + 3*p_xhigh) / sum(probabilities); boundaries are lower-inclusive.",
    "Argmax ties choose the lowest difficulty. Choice/probability disagreements are preserved and reported.",
    `Choice/argmax disagreements: ${analysis.choiceArgmaxDisagreements.count} [${analysis.choiceArgmaxDisagreements.ids.join(", ")}]`,
    `Historical eval_ms (original inference timing): count=${analysis.historicalEvalMs.count} average=${analysis.historicalEvalMs.average === null ? "n/a" : analysis.historicalEvalMs.average.toFixed(3)} ms`,
    `Replay runtime (local parse and analysis): ${replayRuntimeMs.toFixed(3)} ms`,
    "",
    ...formatPolicy(
      "Recorded choice",
      analysis.policies.recorded,
      analysis.rows,
    ),
    "",
    ...formatPolicy(
      "Low-first probability argmax",
      analysis.policies.argmax,
      analysis.rows,
    ),
    "",
    ...formatPolicy("Legacy ordinal", analysis.policies.legacy, analysis.rows),
    "",
    ...formatPolicy(
      "Candidate max(recorded choice, legacy bucket)",
      analysis.policies.candidate,
      analysis.rows,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

/** Read a local CSV only. The default path is the checked-in numeric fixture. */
export async function runReplay(
  path: string | URL = new URL(
    "./fixtures/kev-benchmark-20260926-083316.csv",
    import.meta.url,
  ),
): Promise<string> {
  const started = performance.now();
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const analysis = analyzeReplay(parseReplayCsv(bytes.toString("utf8")));
  return renderReplay(analysis, sha256, performance.now() - started);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(await runReplay(process.argv[2]));
  } catch (error) {
    process.stderr.write(
      `Replay error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

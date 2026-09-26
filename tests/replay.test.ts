import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  analyzeReplay,
  parseReplayCsv,
  runReplay,
  type ReplayRow,
} from "../benchmark/replay.ts";

const header = "id,expected,actual,p_low,p_medium,p_high,p_xhigh,eval_ms";
const synthetic = [
  header,
  "one,high,high,0.1,0.4,0.4,0.1,12.5",
  "two,low,medium,0.6,0.2,0.1,0.1,15",
].join("\n");

describe("offline replay", () => {
  it("parses rows and keeps the original probabilities and historical timing", () => {
    const rows = parseReplayCsv(synthetic);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      id: "one",
      expected: "high",
      actual: "high",
      probabilities: { low: 0.1, medium: 0.4, high: 0.4, xhigh: 0.1 },
      historicalEvalMs: 12.5,
    });
  });

  it("uses low-first argmax ties and the fixed legacy bucket boundaries", () => {
    const rows = parseReplayCsv(synthetic);
    const report = analyzeReplay(rows);
    assert.equal(report.cases[0]?.argmax, "medium");
    assert.ok(Math.abs(report.cases[0]!.legacyScore - 1.5) < 1e-12);
    assert.equal(report.cases[0]?.legacyBucket, "medium");
    assert.equal(report.cases[0]?.candidateBucket, "high");
    assert.equal(report.policies.legacy.policyInducedDowngradeCount, 2);
    assert.equal(report.choiceArgmaxDisagreements.count, 2);

    const boundaryRows: ReplayRow[] = [
      {
        id: "a",
        expected: "medium",
        actual: "low",
        probabilities: { low: 0.25, medium: 0.75, high: 0, xhigh: 0 },
      },
      {
        id: "b",
        expected: "high",
        actual: "low",
        probabilities: { low: 0, medium: 0.25, high: 0.75, xhigh: 0 },
      },
      {
        id: "c",
        expected: "xhigh",
        actual: "low",
        probabilities: { low: 0, medium: 0, high: 0.45, xhigh: 0.55 },
      },
    ];
    const boundaries = analyzeReplay(boundaryRows).cases;
    assert.deepEqual(
      boundaries.map((item) => item.legacyBucket),
      ["medium", "high", "xhigh"],
    );
  });

  it("rejects malformed CSV, missing columns, duplicate IDs and invalid rows", () => {
    assert.throws(
      () => parseReplayCsv("id,expected,actual,p_low\na,low,low,1"),
      /required column.*p_medium/i,
    );
    assert.throws(
      () =>
        parseReplayCsv(`${header}\na,low,low,1,0,0,0,1\na,low,low,1,0,0,0,1`),
      /duplicate id/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\n,low,low,1,0,0,0,1`),
      /empty id/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\na,unknown,low,1,0,0,0,1`),
      /expected/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\na,low,unknown,1,0,0,0,1`),
      /actual/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\na,low,low,NaN,0,0,0,1`),
      /finite/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\na,low,low,1.1,0,0,0,1`),
      /range|between/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\na,low,low,0.2,0.2,0.2,0.2,1`),
      /sum/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\na,low,low,1,0,0,0,-1`),
      /eval_ms/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\n"unterminated,low,low,1,0,0,0,1`),
      /quote/i,
    );
    assert.throws(
      () => parseReplayCsv(`${header}\na,low,low,1,0,0,0,1\nb,low,low,1,0,0`),
      /column/i,
    );
  });

  it("reproduces the fixed 100-row evidence without treating labels as task outcomes", async () => {
    const path = new URL(
      "../benchmark/fixtures/kev-benchmark-20260926-083316.csv",
      import.meta.url,
    );
    const csv = await readFile(path, "utf8");
    const rows = parseReplayCsv(csv);
    const report = analyzeReplay(rows);
    assert.equal(rows.length, 100);
    assert.deepEqual(report.labelDistribution, {
      low: 25,
      medium: 30,
      high: 30,
      xhigh: 15,
    });
    assert.equal(report.policies.recorded.exact, 61);
    assert.equal(report.policies.recorded.withinOne, 100);
    assert.deepEqual(report.policies.argmax, report.policies.recorded);
    assert.equal(report.policies.legacy.exact, 49);
    assert.equal(report.policies.legacy.withinOne, 99);
    assert.equal(report.policies.legacy.under, 42);
    assert.equal(report.policies.legacy.over, 9);
    assert.equal(report.policies.legacy.severeUnder, 1);
    assert.deepEqual(report.policies.legacy.confusion, [
      [16, 9, 0, 0],
      [8, 22, 0, 0],
      [0, 19, 11, 0],
      [0, 1, 14, 0],
    ]);
    assert.equal(report.policies.legacy.policyInducedDowngradeCount, 21);
    assert.equal(report.policies.candidate.exact, 63);
    assert.equal(report.policies.candidate.withinOne, 100);
    assert.equal(report.policies.candidate.under, 25);
    assert.equal(report.policies.candidate.over, 12);
    assert.equal(report.policies.candidate.severeUnder, 0);
    assert.equal(report.policies.candidate.policyInducedDowngradeCount, 0);
    assert.deepEqual(report.policies.candidate.targetDistribution, {
      low: 16,
      medium: 46,
      high: 38,
      xhigh: 0,
    });
    assert.equal(
      report.cases.find((item) => item.id === "56")?.legacyScore.toFixed(4),
      "1.5347",
    );
    assert.equal(
      report.cases.find((item) => item.id === "56")?.recordedChoice,
      "high",
    );
    assert.equal(
      report.cases.find((item) => item.id === "56")?.legacyBucket,
      "medium",
    );
    const max = report.cases.reduce((left, right) =>
      left.legacyScore > right.legacyScore ? left : right,
    );
    assert.equal(max.id, "92");
    assert.equal(max.legacyScore.toFixed(4), "2.1345");

    const text = await runReplay(path);
    assert.match(
      text,
      /44fadbdeb47912333a66ed704c68fe8bd9fd1e276d1a2eb8d3c355281fdc1659/,
    );
    assert.match(text, /heuristic difficulty labels.*not Codex success/i);
    assert.match(text, /historical eval_ms/i);
    assert.match(text, /replay runtime/i);
    assert.match(text, /model digest.*unknown/i);
    assert.match(text, /runtime version.*unknown/i);
    assert.match(text, /question identifier/i);
    assert.match(text, /per-class recall/i);
    assert.match(text, /target distribution/i);
    assert.match(text, /choice\/argmax disagreements/i);
    const defaultText = await runReplay();
    assert.match(defaultText, /Rows: 100/);
    assert.match(
      defaultText,
      new RegExp(createHash("sha256").update(csv).digest("hex")),
    );
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  parseFixtureFile,
  quantile,
  renderReport,
} from "../benchmark/report.ts";

const difficulties = ["low", "medium", "high", "xhigh"] as const;

describe("benchmark fixtures and report", () => {
  it("keeps a representative, balanced fixture set with complete task descriptions", async () => {
    const raw: unknown = JSON.parse(
      await readFile(
        new URL("../benchmark/tasks.json", import.meta.url),
        "utf8",
      ),
    );
    const fixtures = parseFixtureFile(raw);

    assert.equal(fixtures.canonical, false);
    assert.equal(fixtures.tasks.length, 24);
    for (const difficulty of difficulties) {
      assert.equal(
        fixtures.tasks.filter((task) => task.difficulty === difficulty).length,
        6,
      );
    }
    for (const task of fixtures.tasks) {
      assert.ok(task.id);
      assert.ok(task.task.length > 40, `${task.id} should be self-contained`);
      assert.match(task.task, /[A-Za-z]/);
    }
  });

  it("computes interpolated percentiles deterministically", () => {
    assert.equal(quantile([1, 2, 3, 4], 0), 1);
    assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(quantile([1, 2, 3, 4], 1), 4);
    assert.ok(Number.isNaN(quantile([], 0.5)));
  });

  it("reports exact, ordinal, confusion, latency, and score evidence", () => {
    const fixtures = parseFixtureFile({
      name: "test",
      canonical: false,
      tasks: difficulties.map((difficulty, index) => ({
        id: String(index),
        difficulty,
        task: `Task ${difficulty}`,
      })),
    });
    const report = renderReport(fixtures, [
      {
        fixture: fixtures.tasks[0]!,
        predicted: "low",
        score: 0.1,
        probabilities: { low: 0.9 },
        latencyMs: 10,
        fallback: false,
      },
      {
        fixture: fixtures.tasks[1]!,
        predicted: "high",
        score: 1.8,
        probabilities: { high: 0.8 },
        latencyMs: 20,
        fallback: true,
        reason: "timeout",
      },
      {
        fixture: fixtures.tasks[2]!,
        predicted: "high",
        score: 2.0,
        probabilities: { high: 1 },
        latencyMs: 30,
        fallback: false,
      },
      {
        fixture: fixtures.tasks[3]!,
        predicted: "high",
        score: 2.3,
        probabilities: { high: 0.7 },
        latencyMs: 40,
        fallback: false,
      },
    ]);

    assert.match(report, /Evaluated backend decisions: 3\/4/);
    assert.match(report, /Exact accuracy: 66\.67% \(2\/3\)/);
    assert.match(report, /Within ±1 ordinal class: 100\.00% \(3\/3\)/);
    assert.match(report, /Fallbacks: 1\/4/);
    assert.match(report, /actual\\predicted\tlow\tmedium\thigh\txhigh/);
    assert.match(report, /avg=25\.00 p50=25\.00 p95=38\.50 p99=39\.70/);
    assert.match(
      report,
      /Score distribution: n=3 avg=1\.47 p50=2\.00 p95=2\.27 min=0\.10 max=2\.30/,
    );
  });
});

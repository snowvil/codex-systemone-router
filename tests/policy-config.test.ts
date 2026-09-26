import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { cloneDefaultConfig } from "../src/config/defaults.js";
import { ConfigValidationError, loadConfig } from "../src/config/loader.js";
import {
  difficultyForScore,
  fallbackResult,
  routeDecision,
} from "../src/policy/default-policy.js";
import { normalizeProbabilities, ordinalScore } from "../src/policy/score.js";
import type { Decision } from "../src/decision/types.js";

function decision(probabilities: Decision["probabilities"]): Decision {
  return {
    choice: "high",
    probabilities,
    score: 0,
    backend: "test",
  };
}

describe("ordinal probability score", () => {
  it("normalizes small sum drift before computing the expected ordinal", () => {
    const probabilities = normalizeProbabilities({
      low: 0.100001,
      medium: 0.199999,
      high: 0.500001,
      xhigh: 0.200001,
    });
    assert.ok(
      Math.abs(
        probabilities.low +
          probabilities.medium +
          probabilities.high +
          probabilities.xhigh -
          1,
      ) < 1e-12,
    );
    assert.ok(Math.abs(ordinalScore(probabilities) - 1.8) < 1e-6);
  });

  it("rejects missing, out-of-range, and grossly inconsistent probabilities", () => {
    assert.throws(
      () => normalizeProbabilities({ low: 1 }),
      /probability medium/,
    );
    assert.throws(
      () =>
        normalizeProbabilities({
          low: -0.1,
          medium: 0.5,
          high: 0.4,
          xhigh: 0.2,
        }),
      /between 0 and 1/,
    );
    assert.throws(
      () =>
        normalizeProbabilities({
          low: 0.2,
          medium: 0.2,
          high: 0.2,
          xhigh: 0.2,
        }),
      /sum to 1/,
    );
  });
});

describe("deterministic routing policy", () => {
  it("defaults every route and fallback to a gpt-6 model", () => {
    const config = cloneDefaultConfig();
    const targets = [
      ...Object.values(config.policy.routes),
      config.policy.fallback,
    ];

    assert.deepEqual(targets, [
      { model: "gpt-6-luna", reasoning_effort: "low" },
      { model: "gpt-6-luna", reasoning_effort: "medium" },
      { model: "gpt-6-sol", reasoning_effort: "high" },
      { model: "gpt-6-astra", reasoning_effort: "xhigh" },
      { model: "gpt-6-sol", reasoning_effort: "high" },
    ]);
    assert.equal(config.policy.strategy, "conservative");
  });

  it("uses lower-bound thresholds and keeps exact boundaries stable", () => {
    const thresholds = { medium: 0.75, high: 1.5, xhigh: 2.25 };
    assert.equal(difficultyForScore(0, thresholds), "low");
    assert.equal(difficultyForScore(0.749999, thresholds), "low");
    assert.equal(difficultyForScore(0.75, thresholds), "medium");
    assert.equal(difficultyForScore(1.5, thresholds), "high");
    assert.equal(difficultyForScore(2.25, thresholds), "xhigh");
  });

  it("routes from probabilities instead of trusting the backend argmax", () => {
    const config = cloneDefaultConfig();
    const result = routeDecision(
      decision({ low: 0.05, medium: 0.1, high: 0.55, xhigh: 0.3 }),
      config,
    );
    assert.equal(result.difficulty, "high");
    assert.equal(result.target.model, "gpt-6-sol");
    assert.equal(result.fallback, false);
    assert.equal(result.score, 2.1);
  });

  it("can reach the configured xhigh target on a synthetic one-hot decision", () => {
    const result = routeDecision(
      {
        choice: "xhigh",
        probabilities: { low: 0, medium: 0, high: 0, xhigh: 1 },
        score: 3,
        backend: "test",
      },
      cloneDefaultConfig(),
    );

    assert.equal(result.difficulty, "xhigh");
    assert.deepEqual(result.target, {
      model: "gpt-6-astra",
      reasoning_effort: "xhigh",
    });
  });

  it("uses the configured capable fallback and reason", () => {
    const config = cloneDefaultConfig();
    config.policy.fallback = {
      model: "custom-safe",
      reasoning_effort: "xhigh",
    };
    const result = fallbackResult(config, "timeout");
    assert.equal(result.fallback, true);
    assert.equal(result.reason, "timeout");
    assert.deepEqual(result.target, {
      model: "custom-safe",
      reasoning_effort: "xhigh",
    });
  });
});

describe("configuration precedence and validation", () => {
  it("applies defaults < YAML < env < CLI overrides", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "codex-systemone-router-config-"),
    );
    const path = join(directory, "router.yaml");
    writeFileSync(
      path,
      [
        "backend:",
        "  url: http://config.example.test/api/decide",
        "  timeout_ms: 1500",
        "policy:",
        "  strategy: ordinal",
        "  thresholds:",
        "    medium: 0.6",
        "  fallback:",
        "    model: config-fallback",
      ].join("\n"),
      "utf8",
    );

    const config = loadConfig({
      configPath: path,
      env: {
        CODEX_SYSTEMONE_ROUTER_BACKEND_URL:
          "http://env.example.test/api/decide",
        CODEX_SYSTEMONE_ROUTER_BACKEND_TIMEOUT_MS: "1750",
        CODEX_SYSTEMONE_ROUTER_POLICY_THRESHOLDS_MEDIUM: "0.7",
        CODEX_SYSTEMONE_ROUTER_POLICY_STRATEGY: "conservative",
        CODEX_SYSTEMONE_ROUTER_POLICY_FALLBACK_MODEL: "env-fallback",
      },
      overrides: {
        backend: { timeout_ms: 2200 },
        policy: { strategy: "argmax", fallback: { model: "cli-fallback" } },
      },
    });

    assert.equal(config.backend.url, "http://env.example.test/api/decide");
    assert.equal(config.backend.timeout_ms, 2200);
    assert.equal(config.policy.thresholds.medium, 0.7);
    assert.equal(config.policy.strategy, "argmax");
    assert.equal(config.policy.fallback.model, "cli-fallback");
  });

  it("validates unknown keys and unsafe backend URLs", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "codex-systemone-router-config-"),
    );
    const unknownPath = join(directory, "unknown.yaml");
    writeFileSync(unknownPath, "unexpected: true\n", "utf8");
    assert.throws(
      () => loadConfig({ configPath: unknownPath, env: {} }),
      (error: unknown) => error instanceof ConfigValidationError,
    );

    assert.throws(
      () =>
        loadConfig({
          env: { CODEX_SYSTEMONE_ROUTER_BACKEND_URL: "file:///tmp/decide" },
        }),
      (error: unknown) => error instanceof ConfigValidationError,
    );
    assert.throws(
      () =>
        loadConfig({
          env: { CODEX_SYSTEMONE_ROUTER_BACKEND_TIMEOUT_MS: "not-a-number" },
        }),
      (error: unknown) => error instanceof ConfigValidationError,
    );
    assert.throws(
      () =>
        loadConfig({
          env: { CODEX_SYSTEMONE_ROUTER_POLICY_STRATEGY: "guess" },
        }),
      /policy.strategy must be conservative, ordinal, or argmax/,
    );
  });
});

describe("score and policy edge cases", () => {
  it("accepts the documented one-percent tolerance boundary", () => {
    assert.deepEqual(
      normalizeProbabilities({ low: 0.99, medium: 0, high: 0, xhigh: 0 }),
      { low: 1, medium: 0, high: 0, xhigh: 0 },
    );
  });
  it("scores pure classes at 0, 1, 2, 3 and rejects invalid numbers", () => {
    for (const [index, key] of ["low", "medium", "high", "xhigh"].entries()) {
      assert.equal(
        ordinalScore({ low: 0, medium: 0, high: 0, xhigh: 0, [key]: 1 }),
        index,
      );
    }
    for (const value of [NaN, Infinity, -Infinity, "1", null, -0.01, 1.01]) {
      assert.throws(() =>
        normalizeProbabilities({ low: value, medium: 0, high: 0, xhigh: 0 }),
      );
    }
  });
  it("routes a medium argmax to high from the full distribution", () => {
    const result = routeDecision(
      {
        ...decision({ low: 0, medium: 0.4, high: 0.3, xhigh: 0.3 }),
        choice: "medium",
      },
      cloneDefaultConfig(),
    );
    assert.equal(result.difficulty, "high");
    assert.ok(Math.abs(result.score - 1.9) < 1e-12);
  });
  it("tests both sides of every default threshold and rejects invalid ordering", () => {
    const config = cloneDefaultConfig();
    for (const [score, expected] of [
      [0.749999, "low"],
      [0.75, "medium"],
      [1.749999, "medium"],
      [1.75, "high"],
      [2.549999, "high"],
      [2.55, "xhigh"],
      [3, "xhigh"],
    ] as const) {
      assert.equal(
        difficultyForScore(score, config.policy.thresholds),
        expected,
      );
    }
    for (const thresholds of [
      { medium: 1, high: 1, xhigh: 2 },
      { medium: 2, high: 1, xhigh: 3 },
      { medium: -1 },
      { xhigh: 4 },
      { high: NaN },
    ]) {
      assert.throws(() =>
        loadConfig({ env: {}, overrides: { policy: { thresholds } } }),
      );
    }
  });
});

it("merges a model-only route override while retaining the default effort", () => {
  const overrides: import("../src/config/types.js").ConfigOverrides = {
    policy: { routes: { low: { model: "custom-low" } } },
  };
  const config = loadConfig({ env: {}, overrides });
  assert.deepEqual(config.policy.routes.low, {
    model: "custom-low",
    reasoning_effort: "low",
  });
});

it("does not downgrade a backend-declared high choice from the lower ordinal score", () => {
  const result = routeDecision(
    {
      choice: "high",
      probabilities: {
        low: 0.1278,
        medium: 0.3565,
        high: 0.3689,
        xhigh: 0.1468,
      },
      score: 1.5347,
      backend: "replay",
    },
    cloneDefaultConfig(),
  );

  assert.equal(result.difficulty, "high");
  assert.equal(result.target.model, "gpt-6-sol");
  assert.equal(result.score, 1.5347);
});

it("does not downgrade a backend-declared xhigh choice when the mean is lower", () => {
  const result = routeDecision(
    {
      choice: "xhigh",
      probabilities: { low: 0, medium: 0.9, high: 0.09, xhigh: 0.01 },
      score: 1.11,
      backend: "test",
    },
    cloneDefaultConfig(),
  );

  assert.equal(result.difficulty, "xhigh");
  assert.equal(result.probabilityArgmax, "medium");
  assert.equal(result.choiceArgmaxDisagreement, true);
});

it("retains the historical ordinal policy as an explicit configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "router-policy-strategy-"));
  const path = join(directory, "router.yaml");
  writeFileSync(path, "policy:\n  strategy: ordinal\n", "utf8");
  const result = routeDecision(
    decision({ low: 0.1278, medium: 0.3565, high: 0.3689, xhigh: 0.1468 }),
    loadConfig({ configPath: path, env: {} }),
  );

  assert.equal(result.difficulty, "medium");
});

it("allows probability argmax as an explicit environment-selected policy", () => {
  const config = loadConfig({
    env: { CODEX_SYSTEMONE_ROUTER_POLICY_STRATEGY: "argmax" },
  });
  const result = routeDecision(
    {
      choice: "low",
      probabilities: { low: 0.4, medium: 0.35, high: 0.25, xhigh: 0 },
      score: 0.85,
      backend: "test",
    },
    config,
  );

  assert.equal(result.difficulty, "low");
  assert.equal(result.policy, "argmax");
});

it("reports choice and argmax disagreement while preserving the default choice floor", () => {
  const result = routeDecision(
    {
      choice: "high",
      probabilities: { low: 0.1, medium: 0.6, high: 0.2, xhigh: 0.1 },
      score: 1.3,
      backend: "test",
    },
    cloneDefaultConfig(),
  );

  assert.equal(result.difficulty, "high");
  assert.equal(result.declaredChoice, "high");
  assert.equal(result.probabilityArgmax, "medium");
  assert.equal(result.choiceArgmaxDisagreement, true);
});

it("breaks probability argmax ties toward the lower ordinal difficulty", () => {
  const config = loadConfig({
    env: { CODEX_SYSTEMONE_ROUTER_POLICY_STRATEGY: "argmax" },
  });
  const result = routeDecision(
    {
      choice: "high",
      probabilities: { low: 0.5, medium: 0, high: 0.5, xhigh: 0 },
      score: 1,
      backend: "test",
    },
    config,
  );

  assert.equal(result.difficulty, "low");
  assert.equal(result.probabilityArgmax, "low");
});

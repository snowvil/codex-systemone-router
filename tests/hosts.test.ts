import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { cloneDefaultConfig } from "../src/config/defaults.js";
import { ConfigValidationError, loadConfig } from "../src/config/loader.js";
import { resolveHost, HostResolutionError } from "../src/host/detect.js";
import {
  fallbackResult,
  PolicyValidationError,
  routeDecision,
  targetsForHost,
} from "../src/policy/default-policy.js";
import type { Decision } from "../src/decision/types.js";
import type { RoutingPolicy } from "../src/policy/types.js";

const HIGH_DECISION: Decision = {
  choice: "high",
  probabilities: { low: 0.05, medium: 0.1, high: 0.55, xhigh: 0.3 },
  score: 0,
  backend: "test",
};

function tempConfig(contents: string): string {
  const directory = mkdtempSync(
    join(tmpdir(), "codex-systemone-router-hosts-"),
  );
  const path = join(directory, "config.yaml");
  writeFileSync(path, contents);
  return path;
}

describe("per-host routing targets", () => {
  it("ships Claude Code aliases next to the Codex defaults", () => {
    const config = cloneDefaultConfig();
    assert.deepEqual(config.policy.hosts?.claude, {
      routes: {
        low: { model: "haiku", reasoning_effort: "low" },
        medium: { model: "sonnet", reasoning_effort: "medium" },
        high: { model: "opus", reasoning_effort: "high" },
        xhigh: { model: "opus", reasoning_effort: "xhigh" },
      },
      fallback: { model: "opus", reasoning_effort: "high" },
    });
    assert.deepEqual(config.policy.hosts?.codex, {
      routes: config.policy.routes,
      fallback: config.policy.fallback,
    });
  });

  it("routes the same decision to each host's vocabulary", () => {
    const config = cloneDefaultConfig();
    const codex = routeDecision(HIGH_DECISION, config);
    const claude = routeDecision(HIGH_DECISION, config, { host: "claude" });
    assert.equal(codex.host, "codex");
    assert.equal(claude.host, "claude");
    assert.equal(codex.difficulty, claude.difficulty);
    assert.equal(codex.score, claude.score);
    assert.deepEqual(codex.target, {
      model: "gpt-6.1-sol",
      reasoning_effort: "high",
    });
    assert.deepEqual(claude.target, {
      model: "opus",
      reasoning_effort: "high",
    });
  });

  it("uses the selected host's fallback", () => {
    const config = cloneDefaultConfig();
    const result = fallbackResult(config, "timeout", { host: "claude" });
    assert.equal(result.host, "claude");
    assert.equal(result.fallback, true);
    assert.deepEqual(result.target, {
      model: "opus",
      reasoning_effort: "high",
    });
  });

  it("keeps routing a bare policy for codex and rejects unknown hosts", () => {
    const { hosts: _hosts, ...bare } = cloneDefaultConfig().policy;
    const policy: RoutingPolicy = bare;
    assert.equal(
      routeDecision(HIGH_DECISION, policy).target.model,
      "gpt-6.1-sol",
    );
    assert.throws(
      () => routeDecision(HIGH_DECISION, policy, { host: "claude" }),
      (error: unknown) =>
        error instanceof PolicyValidationError &&
        /no targets for host claude/.test(error.message),
    );
    assert.throws(
      () => targetsForHost(policy, "gemini" as never),
      PolicyValidationError,
    );
    assert.throws(
      () =>
        routeDecision(HIGH_DECISION, {
          ...policy,
          hosts: { gemini: policy.hosts } as never,
        }),
      /unknown host gemini/,
    );
  });

  it("merges policy.hosts from YAML and keeps the codex shorthand in sync", () => {
    const path = tempConfig(
      [
        "policy:",
        "  routes:",
        "    low: { model: gpt-6-mini }",
        "  hosts:",
        "    codex:",
        "      fallback: { model: gpt-6-safe, reasoning_effort: xhigh }",
        "    claude:",
        "      routes:",
        "        xhigh: { model: fable }",
        "      fallback: { model: sonnet }",
        "",
      ].join("\n"),
    );
    const config = loadConfig({ configPath: path, env: {} });
    assert.deepEqual(config.policy.routes.low, {
      model: "gpt-6-mini",
      reasoning_effort: "low",
    });
    assert.deepEqual(config.policy.fallback, {
      model: "gpt-6-safe",
      reasoning_effort: "xhigh",
    });
    assert.deepEqual(config.policy.hosts?.codex, {
      routes: config.policy.routes,
      fallback: config.policy.fallback,
    });
    assert.deepEqual(config.policy.hosts?.claude?.routes.xhigh, {
      model: "fable",
      reasoning_effort: "xhigh",
    });
    assert.deepEqual(config.policy.hosts?.claude?.fallback, {
      model: "sonnet",
      reasoning_effort: "high",
    });
    assert.deepEqual(config.policy.hosts?.claude?.routes.low, {
      model: "haiku",
      reasoning_effort: "low",
    });
  });

  it("applies per-host environment overrides above the file", () => {
    const path = tempConfig(
      "policy:\n  hosts:\n    claude:\n      routes:\n        high: { model: file-high }\n",
    );
    const config = loadConfig({
      configPath: path,
      env: {
        CODEX_SYSTEMONE_ROUTER_POLICY_HOSTS_CLAUDE_ROUTES_HIGH_MODEL:
          "env-high",
        CODEX_SYSTEMONE_ROUTER_POLICY_HOSTS_CLAUDE_FALLBACK_REASONING_EFFORT:
          "xhigh",
        CODEX_SYSTEMONE_ROUTER_POLICY_HOSTS_CODEX_ROUTES_LOW_MODEL: "env-low",
      },
      overrides: {
        policy: { hosts: { claude: { fallback: { model: "cli-fallback" } } } },
      },
    });
    assert.deepEqual(config.policy.hosts?.claude?.routes.high, {
      model: "env-high",
      reasoning_effort: "high",
    });
    assert.deepEqual(config.policy.hosts?.claude?.fallback, {
      model: "cli-fallback",
      reasoning_effort: "xhigh",
    });
    assert.equal(config.policy.routes.low.model, "env-low");
  });

  it("rejects unknown hosts, keys, and invalid host targets", () => {
    for (const contents of [
      "policy:\n  hosts:\n    gemini:\n      routes: {}\n",
      "policy:\n  hosts:\n    claude:\n      extra: true\n",
      "policy:\n  hosts:\n    claude:\n      routes:\n        severe: { model: x }\n",
      "policy:\n  hosts:\n    claude:\n      fallback:\n        reasoning_effort: max\n",
      "policy:\n  hosts: []\n",
    ]) {
      const path = tempConfig(contents);
      assert.throws(
        () => loadConfig({ configPath: path, env: {} }),
        ConfigValidationError,
        contents,
      );
    }
    assert.throws(
      () =>
        loadConfig({
          env: {
            CODEX_SYSTEMONE_ROUTER_POLICY_HOSTS_CLAUDE_ROUTES_LOW_REASONING_EFFORT:
              "extreme",
          },
        }),
      ConfigValidationError,
    );
  });
});

describe("host detection", () => {
  it("prefers the flag, then the env pin, then the Claude Code marker", () => {
    assert.deepEqual(resolveHost(undefined, {}), {
      host: "codex",
      source: "default",
    });
    assert.deepEqual(resolveHost(undefined, { CLAUDECODE: "1" }), {
      host: "claude",
      source: "detected",
    });
    assert.deepEqual(resolveHost(undefined, { CLAUDECODE: "true" }), {
      host: "codex",
      source: "default",
    });
    assert.deepEqual(
      resolveHost(undefined, {
        CLAUDECODE: "1",
        CODEX_SYSTEMONE_ROUTER_HOST: "codex",
      }),
      { host: "codex", source: "env" },
    );
    assert.deepEqual(
      resolveHost("claude", { CODEX_SYSTEMONE_ROUTER_HOST: "codex" }),
      { host: "claude", source: "flag" },
    );
    assert.deepEqual(
      resolveHost("auto", {
        CODEX_SYSTEMONE_ROUTER_HOST: "auto",
        CLAUDECODE: "1",
      }),
      { host: "claude", source: "detected" },
    );
    assert.deepEqual(resolveHost(" Claude ", {}), {
      host: "claude",
      source: "flag",
    });
    assert.throws(() => resolveHost("gemini", {}), HostResolutionError);
    assert.throws(
      () => resolveHost(undefined, { CODEX_SYSTEMONE_ROUTER_HOST: "gemini" }),
      HostResolutionError,
    );
  });
});

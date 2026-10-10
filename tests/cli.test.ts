import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { after, before, describe, it } from "node:test";

const CLI = resolve("node_modules/.bin/tsx");
const SOURCE = resolve("src/cli/index.ts");
const RESPONSE = {
  answers: {
    reasoning_effort: {
      choice: "high",
      confidence: 0.71,
      probabilities: { low: 0.05, medium: 0.1, high: 0.7, xhigh: 0.15 },
    },
  },
  total_duration: 210_000_000,
};

async function run(
  args: string[],
  input?: string | Buffer[],
  envOverrides: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((done, reject) => {
    const child = spawn(CLI, [SOURCE, ...args], {
      timeout: 10000,
      cwd: resolve(),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) =>
              !key.startsWith("CODEX_SYSTEMONE_ROUTER_") &&
              key !== "CLAUDECODE",
          ),
        ),
        ...envOverrides,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.on("error", () => {});
    if (Array.isArray(input)) {
      void (async () => {
        for (const chunk of input) {
          child.stdin.write(chunk);
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        child.stdin.end();
      })();
    } else child.stdin.end(input);
  });
}

describe("CLI", () => {
  let server: Server;
  let directory: string;
  let configPath: string;
  let receivedTask: string;
  let requestCount = 0;
  let responseMode = "valid";

  before(async () => {
    server = createServer(async (request, response) => {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/api/decide");
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      const parsed = JSON.parse(body) as { state: string };
      assert.ok(parsed.state.length > 0);
      requestCount += 1;
      receivedTask = parsed.state;
      if (responseMode === "truncated") {
        response.end(JSON.stringify({ ...RESPONSE, state_truncated: true }));
        return;
      }
      if (responseMode === "timeout") return;
      if (responseMode === "http") {
        response.writeHead(500);
        response.write("failure");
        return;
      }
      if (responseMode === "malformed") {
        response.end("not json");
        return;
      }
      if (responseMode === "missing") {
        response.end("{}");
        return;
      }
      if (responseMode === "choice") {
        response.end(
          JSON.stringify({
            answers: {
              reasoning_effort: {
                ...RESPONSE.answers.reasoning_effort,
                choice: "unknown",
              },
            },
          }),
        );
        return;
      }
      if (responseMode === "probabilities") {
        response.end(
          JSON.stringify({
            answers: {
              reasoning_effort: {
                choice: "high",
                probabilities: { low: 0, medium: 0, high: -1, xhigh: 2 },
              },
            },
          }),
        );
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(RESPONSE));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    directory = await mkdtemp(join(tmpdir(), "router-cli-"));
    configPath = join(directory, "config.yaml");
    await writeFile(
      configPath,
      `backend:\n  url: http://127.0.0.1:${address.port}/api/decide\n`,
    );
  });

  after(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  });

  it("routes an argument and emits stable JSON", async () => {
    const result = await run([
      "route",
      "--json",
      "--config",
      configPath,
      "Investigate duplicate records",
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const json = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(json.difficulty, "high");
    assert.equal(json.host, "codex");
    assert.equal(json.model, "gpt-6.1-sol");
    assert.equal(json.reasoning_effort, "high");
    assert.equal(json.score, 1.95);
    assert.equal(json.fallback, false);
    assert.equal(json.policy, "conservative");
    assert.equal(json.declared_choice, "high");
    assert.equal(json.probability_argmax, "high");
    assert.equal(json.choice_argmax_disagreement, false);
    assert.equal(json.latency_ms, 210);
  });

  it("selects Claude Code targets with --host claude", async () => {
    const result = await run([
      "route",
      "--json",
      "--host",
      "claude",
      "--config",
      configPath,
      "Investigate duplicate records",
    ]);
    assert.equal(result.code, 0);
    const json = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(json.host, "claude");
    assert.equal(json.difficulty, "high");
    assert.equal(json.model, "opus");
    assert.equal(json.reasoning_effort, "high");
    assert.equal(json.fallback, false);
  });

  it("detects Claude Code from CLAUDECODE=1 and lets the host env pin it", async () => {
    const detected = await run(
      ["route", "--json", "--config", configPath, "Review a module"],
      undefined,
      { CLAUDECODE: "1" },
    );
    assert.equal(detected.code, 0);
    assert.equal(
      (JSON.parse(detected.stdout) as { host: string }).host,
      "claude",
    );

    const pinned = await run(
      ["route", "--json", "--config", configPath, "Review a module"],
      undefined,
      { CLAUDECODE: "1", CODEX_SYSTEMONE_ROUTER_HOST: "codex" },
    );
    assert.equal(pinned.code, 0);
    assert.equal((JSON.parse(pinned.stdout) as { host: string }).host, "codex");

    const explicit = await run(
      [
        "route",
        "--json",
        "--host",
        "claude",
        "--config",
        configPath,
        "Review a module",
      ],
      undefined,
      { CODEX_SYSTEMONE_ROUTER_HOST: "codex" },
    );
    assert.equal(explicit.code, 0);
    assert.equal(
      (JSON.parse(explicit.stdout) as { host: string }).host,
      "claude",
    );

    const auto = await run(
      [
        "route",
        "--json",
        "--host",
        "auto",
        "--config",
        configPath,
        "Review a module",
      ],
      undefined,
      { CLAUDECODE: "1" },
    );
    assert.equal(auto.code, 0);
    assert.equal((JSON.parse(auto.stdout) as { host: string }).host, "claude");

    const invalid = await run([
      "route",
      "--json",
      "--host",
      "gemini",
      "--config",
      configPath,
      "Review a module",
    ]);
    assert.equal(invalid.code, 2);
    assert.equal(invalid.stdout, "");
  });

  it("applies fallback overrides and per-host config to the selected host", async () => {
    const hostConfig = join(directory, "hosts.yaml");
    await writeFile(
      hostConfig,
      [
        "policy:",
        "  hosts:",
        "    claude:",
        "      routes:",
        "        xhigh: { model: fable, reasoning_effort: xhigh }",
        "      fallback: { model: sonnet, reasoning_effort: high }",
        "",
      ].join("\n"),
    );
    const claudeFallback = await run([
      "route",
      "--json",
      "--host",
      "claude",
      "--config",
      hostConfig,
      "--backend-url",
      "http://127.0.0.1:1/api/decide",
      "Review code",
    ]);
    assert.equal(claudeFallback.code, 0);
    const claudeJson = JSON.parse(claudeFallback.stdout) as Record<
      string,
      unknown
    >;
    assert.equal(claudeJson.fallback, true);
    assert.equal(claudeJson.host, "claude");
    assert.equal(claudeJson.model, "sonnet");

    const codexFallback = await run([
      "route",
      "--json",
      "--host",
      "codex",
      "--config",
      hostConfig,
      "--backend-url",
      "http://127.0.0.1:1/api/decide",
      "--fallback-model",
      "gpt-6-custom",
      "Review code",
    ]);
    assert.equal(codexFallback.code, 0);
    const codexJson = JSON.parse(codexFallback.stdout) as Record<
      string,
      unknown
    >;
    assert.equal(codexJson.host, "codex");
    assert.equal(codexJson.model, "gpt-6-custom");

    const overridden = await run([
      "route",
      "--json",
      "--host",
      "claude",
      "--config",
      hostConfig,
      "--backend-url",
      "http://127.0.0.1:1/api/decide",
      "--fallback-model",
      "haiku",
      "Review code",
    ]);
    assert.equal(overridden.code, 0);
    assert.equal(
      (JSON.parse(overridden.stdout) as { model: string }).model,
      "haiku",
    );
  });

  it("routes stdin without shell interpolation", async () => {
    const task = "Inspect `$(touch /tmp/no-router-execution)` literally";
    const result = await run(
      ["route", "--stdin", "--json", "--config", configPath],
      task,
    );
    assert.equal(result.code, 0);
    assert.equal(
      (JSON.parse(result.stdout) as { fallback: boolean }).fallback,
      false,
    );
  });

  it("prints human output", async () => {
    const result = await run([
      "route",
      "--config",
      configPath,
      "Review a module",
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Difficulty: high/);
    assert.match(result.stdout, /Host: codex/);
    assert.match(result.stdout, /Model: gpt-6.1-sol/);
  });

  it("uses a parseable fallback when the backend is unreachable", async () => {
    const result = await run([
      "route",
      "--json",
      "--backend-url",
      "http://127.0.0.1:1/api/decide",
      "Review code",
    ]);
    assert.equal(result.code, 0);
    const json = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(json.fallback, true);
    assert.equal(json.reason, "backend_unavailable");
    assert.equal(json.reasoning_effort, "high");
    assert.equal(json.policy, "conservative");
    assert.equal(json.declared_choice, null);
    assert.equal(json.probability_argmax, null);
    assert.equal(json.choice_argmax_disagreement, null);
    assert.match(result.stderr, /fallback/);
  });

  it("reports doctor success and failure", async () => {
    const success = await run(["doctor", "--config", configPath]);
    assert.equal(success.code, 0);
    assert.match(success.stdout, /PASS runtime: Node/);
    assert.match(success.stdout, /PASS configuration/);
    assert.match(success.stdout, /PASS policy: conservative/);
    assert.match(success.stdout, /INFO host: codex \(default\)/);
    assert.match(success.stdout, /INFO targets \[codex\]: low=gpt-6-luna\/low/);
    assert.match(success.stdout, /INFO targets \[claude\]: low=haiku\/low/);
    assert.match(success.stdout, /PASS backend typed response/);
    assert.match(success.stdout, /INFO managed block: absent/);
    assert.match(success.stdout, /UNVERIFIED Codex instruction loading/);
    assert.match(success.stdout, /UNVERIFIED Claude Code instruction loading/);
    assert.match(success.stdout, /UNVERIFIED child runtime settings/);

    const detectedHost = await run(
      ["doctor", "--config", configPath],
      undefined,
      { CLAUDECODE: "1" },
    );
    assert.equal(detectedHost.code, 0);
    assert.match(
      detectedHost.stdout,
      /INFO host: claude \(detected from CLAUDECODE=1\)/,
    );

    const globalHome = join(directory, "global-home");
    const globalDoctor = await run(
      ["doctor", "--config", configPath, "--global"],
      undefined,
      {
        CODEX_HOME: join(globalHome, "codex"),
        CLAUDE_CONFIG_DIR: join(globalHome, "claude"),
      },
    );
    assert.equal(globalDoctor.code, 0);
    assert.match(
      globalDoctor.stdout,
      /INFO managed block \[codex\] .*codex[\\/]AGENTS\.md: absent/,
    );
    assert.match(
      globalDoctor.stdout,
      /INFO managed block \[claude\] .*claude[\\/]CLAUDE\.md: absent/,
    );

    const currentPath = join(directory, "current-template.md");
    const template = await readFile(
      new URL("../templates/AGENTS.md", import.meta.url),
      "utf8",
    );
    await writeFile(currentPath, template);
    const current = await run([
      "doctor",
      "--config",
      configPath,
      "--agents-path",
      currentPath,
    ]);
    assert.equal(current.code, 0);
    assert.match(
      current.stdout,
      /INFO managed block: present \(matches current template\)/,
    );

    const stalePath = join(directory, "stale-template.md");
    await writeFile(
      stalePath,
      template.replace("Use subagents", "Use helpers"),
    );
    const stale = await run([
      "doctor",
      "--config",
      configPath,
      "--agents-path",
      stalePath,
    ]);
    assert.equal(stale.code, 0);
    assert.match(
      stale.stdout,
      /INFO managed block: present \(template update available\)/,
    );

    const failureConfig = join(directory, "missing.yaml");
    const failure = await run(["doctor", "--config", failureConfig]);
    assert.equal(failure.code, 1);
    assert.match(failure.stdout, /FAIL configuration/);

    const invalidPolicyPath = join(directory, "invalid-policy.yaml");
    await writeFile(
      invalidPolicyPath,
      "policy:\n  thresholds:\n    medium: 2\n    high: 1\n    xhigh: 3\n",
    );
    const invalidPolicy = await run(["doctor", "--config", invalidPolicyPath]);
    assert.equal(invalidPolicy.code, 1);
    assert.match(invalidPolicy.stdout, /FAIL policy/);
    assert.match(invalidPolicy.stdout, /SKIP backend typed response/);
    const agentsPath = join(directory, "AGENTS.md");
    await writeFile(
      agentsPath,
      "<!-- codex-systemone-router:end -->\n<!-- codex-systemone-router:start -->",
    );
    const malformed = await run([
      "doctor",
      "--config",
      configPath,
      "--agents-path",
      agentsPath,
    ]);
    assert.equal(malformed.code, 1);
    assert.match(malformed.stdout, /FAIL managed block: malformed markers/);
  });
  it("preserves UTF-8 split across stdin chunks", async () => {
    const result = await run(
      ["route", "--stdin", "--json", "--config", configPath],
      [
        Buffer.from("Inspect "),
        Buffer.from([0xed]),
        Buffer.from([0x95]),
        Buffer.from([0x9c]),
        Buffer.from(" and 🧪"),
      ],
    );
    assert.equal(result.code, 0);
    assert.equal(receivedTask, "Inspect 한 and 🧪");
  });

  it("documents all route overrides and supports command help", async () => {
    const result = await run(["route", "--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /--fallback-model/);
    assert.match(result.stdout, /--timeout-ms/);
    assert.match(result.stdout, /--host codex\|claude\|auto/);
    assert.equal(result.stderr, "");
  });

  it("installs the managed block globally for both hosts and uninstalls it", async () => {
    const home = join(directory, `home-${Math.random()}`);
    const env = {
      CODEX_HOME: join(home, "codex-home"),
      CLAUDE_CONFIG_DIR: join(home, "claude-config"),
    };
    const dry = await run(["install", "--global", "--dry-run"], undefined, env);
    assert.equal(dry.code, 0);
    assert.match(dry.stdout, /AGENTS\.md \[codex\]: Would be created/);
    assert.match(dry.stdout, /CLAUDE\.md \[claude\]: Would be created/);
    await assert.rejects(readFile(join(env.CODEX_HOME, "AGENTS.md")));

    const installed = await run(["install", "--global"], undefined, env);
    assert.equal(installed.code, 0);
    assert.match(installed.stdout, /AGENTS\.md \[codex\]: Was created/);
    assert.match(installed.stdout, /CLAUDE\.md \[claude\]: Was created/);
    const template = await readFile(
      new URL("../templates/AGENTS.md", import.meta.url),
      "utf8",
    );
    assert.equal(
      await readFile(join(env.CODEX_HOME, "AGENTS.md"), "utf8"),
      template,
    );
    assert.equal(
      await readFile(join(env.CLAUDE_CONFIG_DIR, "CLAUDE.md"), "utf8"),
      template,
    );

    const onlyClaude = await run(
      ["install", "--global", "--host", "claude"],
      undefined,
      env,
    );
    assert.equal(onlyClaude.code, 0);
    assert.doesNotMatch(onlyClaude.stdout, /\[codex\]/);
    assert.match(onlyClaude.stdout, /CLAUDE\.md \[claude\]: Was unchanged/);

    const removed = await run(["uninstall", "--global"], undefined, env);
    assert.equal(removed.code, 0);
    assert.equal(await readFile(join(env.CODEX_HOME, "AGENTS.md"), "utf8"), "");
    assert.equal(
      await readFile(join(env.CLAUDE_CONFIG_DIR, "CLAUDE.md"), "utf8"),
      "",
    );

    const conflicting = await run(
      ["install", "--global", "--path", "AGENTS.md"],
      undefined,
      env,
    );
    assert.notEqual(conflicting.code, 0);
    const badHost = await run(["install", "--host", "gemini"], undefined, env);
    assert.notEqual(badHost.code, 0);
  });

  it("rejects empty input, invalid flags, ambiguous tasks and overlong input", async () => {
    for (const args of [
      ["route", "--json", ""],
      ["route", "--json", "--unknown", "task"],
      ["route", "--json", "-z"],
      ["route", "--stdin", "task"],
      ["route", "one", "two"],
      ["route", "--json", "--json", "task"],
      ["route", "--config"],
    ]) {
      const result = await run(args);
      assert.notEqual(result.code, 0, args.join(" "));
      assert.equal(result.stdout, "");
      assert.ok(result.stderr);
    }
    const long = await run(["route", "--stdin", "--json"], "a".repeat(100001));
    assert.notEqual(long.code, 0);
    assert.equal(long.stdout, "");
  });

  it("preserves quoted and long tasks exactly", async () => {
    const task =
      "--literal 'quoted' \"text\" `code` $VARIABLE\n" + "a".repeat(90000);
    const result = await run(
      ["route", "--json", "--stdin", "--config", configPath],
      task,
    );
    assert.equal(result.code, 0);
    assert.equal(receivedTask, task);
    const literal = await run([
      "route",
      "--json",
      "--config",
      configPath,
      "--",
      "--literal",
    ]);
    assert.equal(literal.code, 0);
    assert.equal(receivedTask, "--literal");
  });

  it("rejects invalid explicit configuration without routing or leaking details", async () => {
    const invalidConfigs = [
      `backend:\n  url: http://user:secret@127.0.0.1\n`,
      `unknown: true\n`,
      `policy:\n  thresholds:\n    high: 4\n`,
      `policy:\n  thresholds:\n    medium: 2\n    high: 1\n    xhigh: 3\n`,
      `policy:\n  routes:\n    high:\n      model: ''\n`,
      `policy:\n  fallback:\n    reasoning_effort: impossible\n`,
      `backend: [malformed\n`,
    ];
    for (const contents of invalidConfigs) {
      const invalidPath = join(directory, `invalid-${Math.random()}.yaml`);
      await writeFile(invalidPath, contents);
      const before = requestCount;
      const result = await run([
        "route",
        "--json",
        "--config",
        invalidPath,
        "sensitive task text",
      ]);
      assert.equal(result.code, 2);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr);
      assert.doesNotMatch(
        result.stderr,
        /sensitive task text|user|secret|127\.0\.0\.1/,
      );
      assert.equal(requestCount, before);
    }

    const beforeMissing = requestCount;
    const missing = await run([
      "route",
      "--json",
      "--config",
      join(directory, "does-not-exist.yaml"),
      "task",
    ]);
    assert.equal(missing.code, 2);
    assert.equal(missing.stdout, "");
    assert.equal(requestCount, beforeMissing);

    const beforeUnreadable = requestCount;
    const unreadable = await run([
      "route",
      "--json",
      "--config",
      directory,
      "task",
    ]);
    assert.equal(unreadable.code, 2);
    assert.equal(unreadable.stdout, "");
    assert.equal(requestCount, beforeUnreadable);

    const beforeTimeout = requestCount;
    const invalidTimeout = await run([
      "route",
      "--json",
      "--config",
      configPath,
      "--timeout-ms",
      "bad",
      "task",
    ]);
    assert.equal(invalidTimeout.code, 2);
    assert.equal(invalidTimeout.stdout, "");
    assert.equal(requestCount, beforeTimeout);
  });

  it("rejects invalid configuration from environment without routing", async () => {
    const before = requestCount;
    const result = await run(
      ["route", "--json", "--config", configPath, "task"],
      undefined,
      { CODEX_SYSTEMONE_ROUTER_BACKEND_TIMEOUT_MS: "bad" },
    );
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.equal(requestCount, before);
  });

  it("retains configured fallback for backend errors", async () => {
    const invalid = await run([
      "route",
      "--json",
      "--timeout-ms",
      "bad",
      "task",
    ]);
    assert.equal(invalid.code, 2);
    assert.equal(invalid.stdout, "");
    const configured = await run([
      "route",
      "--json",
      "--backend-url",
      "http://127.0.0.1:1/",
      "--fallback-model",
      "safe-custom",
      "--fallback-reasoning-effort",
      "xhigh",
      "task",
    ]);
    assert.equal(JSON.parse(configured.stdout).model, "safe-custom");
    assert.equal(JSON.parse(configured.stdout).reasoning_effort, "xhigh");
  });
  it("returns parseable fallback for every backend failure category", async () => {
    for (const [mode, reason] of [
      ["http", "backend_unavailable"],
      ["timeout", "timeout"],
      ["truncated", "input_truncated"],
      ["malformed", "malformed_response"],
      ["missing", "malformed_response"],
      ["choice", "malformed_response"],
      ["probabilities", "invalid_probabilities"],
    ]) {
      responseMode = mode;
      try {
        const result = await run([
          "route",
          "--json",
          "--config",
          configPath,
          "--timeout-ms",
          "100",
          "task",
        ]);
        assert.equal(result.code, 0, mode);
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.fallback, true, mode);
        assert.equal(parsed.reason, reason, mode);
        assert.match(result.stderr, /fallback/);
      } finally {
        responseMode = "valid";
      }
    }
  });

  it("doctor fails on backend outage and unreadable AGENTS paths", async () => {
    responseMode = "missing";
    try {
      const result = await run(["doctor", "--config", configPath]);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /FAIL backend typed response/);
    } finally {
      responseMode = "valid";
    }
    const result = await run([
      "doctor",
      "--config",
      configPath,
      "--agents-path",
      directory,
    ]);
    assert.equal(result.code, 1);
    assert.match(
      result.stdout,
      /FAIL managed block: requested path is unreadable/,
    );
  });
});

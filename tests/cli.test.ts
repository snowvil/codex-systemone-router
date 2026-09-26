import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((done, reject) => {
    const child = spawn(CLI, [SOURCE, ...args], {
      timeout: 10000,
      cwd: resolve(),
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith("CODEX_SYSTEMONE_ROUTER_"),
        ),
      ),
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
  let responseMode = "valid";

  before(async () => {
    server = createServer(async (request, response) => {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/api/decide");
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      const parsed = JSON.parse(body) as { state: string };
      assert.ok(parsed.state.length > 0);
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
    assert.equal(json.model, "gpt-5.6-sol");
    assert.equal(json.reasoning_effort, "high");
    assert.equal(json.score, 1.95);
    assert.equal(json.fallback, false);
    assert.equal(json.latency_ms, 210);
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
    assert.match(result.stdout, /Model: gpt-5\.6-sol/);
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
    assert.match(result.stderr, /fallback/);
  });

  it("reports doctor success and failure", async () => {
    const success = await run(["doctor", "--config", configPath]);
    assert.equal(success.code, 0);
    assert.match(success.stdout, /PASS Ollaya/);
    const failureConfig = join(directory, "missing.yaml");
    const failure = await run(["doctor", "--config", failureConfig]);
    assert.equal(failure.code, 1);
    assert.match(failure.stdout, /FAIL configuration/);
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
    assert.match(malformed.stdout, /FAIL AGENTS integration/);
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
    assert.equal(result.stderr, "");
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

  it("returns built-in fallback for invalid config and configured fallback for backend errors", async () => {
    const invalid = await run([
      "route",
      "--json",
      "--timeout-ms",
      "bad",
      "task",
    ]);
    assert.equal(invalid.code, 0);
    assert.equal(JSON.parse(invalid.stdout).reason, "invalid_configuration");
    assert.match(invalid.stderr, /fallback/);
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
      assert.match(result.stdout, /FAIL Ollaya/);
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
    assert.match(result.stderr, /AGENTS integration could not be read/);
  });
});

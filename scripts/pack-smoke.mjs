#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(join(repo, "package.json"), "utf8"),
);
const temp = await mkdtemp(
  join(tmpdir(), "codex-systemone-router-pack-smoke-"),
);
const packDir = join(temp, "pack");
const prefix = join(temp, "prefix");
const project = join(temp, "separate-project");
let server;

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? project,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    });
    child.stdin.end(options.input);
  });
}

function checkRun(result, status = 0) {
  assert.equal(
    result.status,
    status,
    `expected exit ${status}, got ${result.status}\n${result.stderr}`,
  );
}

try {
  await Promise.all([
    import("node:fs/promises").then(({ mkdir }) => mkdir(packDir)),
    import("node:fs/promises").then(({ mkdir }) => mkdir(project)),
  ]);

  const packed = await run(
    "npm",
    ["pack", "--json", "--pack-destination", packDir],
    { cwd: repo },
  );
  checkRun(packed);
  const packInfo = JSON.parse(packed.stdout)[0];
  const tarball = join(packDir, packInfo.filename);
  const tarBytes = await readFile(tarball);
  const runtimeDependencyPack = await run(
    "npm",
    ["pack", "--json", "--pack-destination", packDir],
    { cwd: join(repo, "node_modules", "yaml") },
  );
  checkRun(runtimeDependencyPack);
  const runtimeDependencyTarball = join(
    packDir,
    JSON.parse(runtimeDependencyPack.stdout)[0].filename,
  );
  const files = new Set(packInfo.files.map(({ path }) => path));
  for (const required of [
    "CHANGELOG.md",
    "config.example.yaml",
    "templates/AGENTS.md",
  ])
    assert(files.has(required), `tarball missing ${required}`);
  assert(
    [...files].some((path) => path.startsWith("dist/")),
    "tarball missing dist",
  );
  for (const path of files) {
    assert(
      !/(^|\/)evidence\//.test(path),
      `tarball contains evidence: ${path}`,
    );
    assert(
      !/(^|\/)WORK_PROMPT\.md$/.test(path),
      `tarball contains WORK_PROMPT.md`,
    );
    assert(
      !/(^|\/)benchmark\/results\//.test(path),
      `tarball contains benchmark results: ${path}`,
    );
    assert(
      !/(^|\/)node_modules\//.test(path),
      `tarball contains node_modules: ${path}`,
    );
    assert(
      !/(^|\/)(coverage|\.cache|output|generated-local-output)(\/|$)/.test(
        path,
      ),
      `tarball contains generated local output: ${path}`,
    );
  }

  const isolatedNpmConfig = join(temp, "empty.npmrc");
  await writeFile(isolatedNpmConfig, "");
  const install = await run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      prefix,
      tarball,
      runtimeDependencyTarball,
    ],
    {
      cwd: project,
      env: {
        NPM_CONFIG_USERCONFIG: isolatedNpmConfig,
        NPM_CONFIG_ALLOW_SCRIPTS: "",
        npm_config_allow_scripts: "",
      },
    },
  );
  checkRun(install);
  const bin = join(prefix, "node_modules", ".bin", "codex-systemone-router");

  const help = await run(bin, ["--help"]);
  checkRun(help);
  assert.match(help.stdout, /Usage: codex-systemone-router/);

  const successServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        answers: {
          reasoning_effort: {
            choice: "high",
            confidence: 0.8,
            probabilities: { low: 0.05, medium: 0.1, high: 0.8, xhigh: 0.05 },
          },
        },
        total_duration: 4_000_000,
      }),
    );
  });
  await new Promise((resolveListen, reject) => {
    successServer.once("error", reject);
    successServer.listen(0, "127.0.0.1", resolveListen);
  });
  server = successServer;
  const address = successServer.address();
  assert(address && typeof address !== "string");
  const configPath = join(temp, "success.yaml");
  await writeFile(
    configPath,
    `backend:\n  url: http://127.0.0.1:${address.port}/decide\n`,
  );
  const argResult = await run(bin, [
    "route",
    "--json",
    "--config",
    configPath,
    "packaged argument task",
  ]);
  checkRun(argResult);
  assert.equal(
    JSON.parse(argResult.stdout).fallback,
    false,
    `${argResult.stdout}${argResult.stderr}`,
  );
  const stdinResult = await run(
    bin,
    ["route", "--stdin", "--json", "--config", configPath],
    { input: "packaged stdin task" },
  );
  checkRun(stdinResult);
  assert.equal(JSON.parse(stdinResult.stdout).fallback, false);
  await new Promise((resolveClose, reject) =>
    successServer.close((error) => (error ? reject(error) : resolveClose())),
  );
  server = undefined;

  const fallback = await run(bin, [
    "route",
    "--json",
    "--backend-url",
    "http://127.0.0.1:1/unavailable",
    "expected backend failure",
  ]);
  checkRun(fallback);
  assert.equal(JSON.parse(fallback.stdout).fallback, true);
  assert.equal(JSON.parse(fallback.stdout).reason, "backend_unavailable");

  const invalidConfig = join(temp, "invalid.yaml");
  await writeFile(
    invalidConfig,
    "policy:\n  fallback:\n    reasoning_effort: impossible\n",
  );
  const invalid = await run(bin, [
    "route",
    "--json",
    "--config",
    invalidConfig,
    "invalid config task",
  ]);
  checkRun(invalid, 2);
  assert.equal(invalid.stdout, "");

  const agentsPath = join(project, "AGENTS.md");
  const userStart = "# Existing user instructions\nKeep this text.\n";
  await writeFile(agentsPath, userStart);
  const dryInstall = await run(bin, [
    "install",
    "--path",
    agentsPath,
    "--dry-run",
  ]);
  checkRun(dryInstall);
  assert.equal(await readFile(agentsPath, "utf8"), userStart);
  const installed = await run(bin, ["install", "--path", agentsPath]);
  checkRun(installed);
  assert.match(
    await readFile(agentsPath, "utf8"),
    /codex-systemone-router:start/,
  );
  await writeFile(
    agentsPath,
    `${await readFile(agentsPath, "utf8")}# Added after install\nPreserve this too.\n`,
  );
  const updated = await run(bin, ["install", "--path", agentsPath]);
  checkRun(updated);
  const updatedText = await readFile(agentsPath, "utf8");
  assert.match(updatedText, /Added after install/);
  assert.match(updatedText, /Preserve this too/);
  const dryUninstall = await run(bin, [
    "uninstall",
    "--path",
    agentsPath,
    "--dry-run",
  ]);
  checkRun(dryUninstall);
  assert.equal(await readFile(agentsPath, "utf8"), updatedText);
  const uninstalled = await run(bin, ["uninstall", "--path", agentsPath]);
  checkRun(uninstalled);
  const finalText = await readFile(agentsPath, "utf8");
  assert(finalText.includes(userStart));
  assert.match(finalText, /Added after install/);
  assert.doesNotMatch(finalText, /codex-systemone-router:start/);

  console.log(`pack smoke passed: ${packageJson.name}@${packageJson.version}`);
  console.log(`tarball: ${packInfo.filename}`);
  console.log(`sha256: ${createHash("sha256").update(tarBytes).digest("hex")}`);
  console.log(`tarball files: ${packInfo.files.length}`);
} finally {
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OllayaBackend } from "../backend/ollaya.js";
import { ConfigValidationError, loadConfig } from "../config/loader.js";
import {
  globalInstructionLocations,
  inspectManagedAgentsMarkers,
  ManagedAgentsMarkerError,
  type InstructionLocation,
} from "../codex/installer.js";
import { MANAGED_AGENTS_BLOCK } from "../codex/agents-template.js";
import {
  targetsForHost,
  validateRoutingPolicy,
  PolicyValidationError,
} from "../policy/default-policy.js";
import { HOSTS, type RoutingTarget } from "../policy/types.js";
import {
  CLAUDE_CODE_MARKER_ENV,
  HOST_ENV,
  HostResolutionError,
  resolveHost,
  type ResolvedHost,
} from "../host/detect.js";
import { parseOptions, stringFlag } from "./options.js";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function reportUnverifiedCodexEvidence(): void {
  process.stdout.write(
    "UNVERIFIED Codex instruction loading: this check cannot determine which AGENTS.md Codex loaded; an AGENTS.override.md or nearer project file may change the active instructions.\n",
  );
  process.stdout.write(
    "UNVERIFIED Claude Code instruction loading: this check cannot determine which CLAUDE.md or AGENTS.md Claude Code loaded; by default Claude Code reads a project AGENTS.md only when no CLAUDE.md exists in the project tree.\n",
  );
  process.stdout.write(
    "UNVERIFIED child runtime settings: this check cannot observe the model or reasoning effort actually used after a subagent spawn.\n",
  );
}

function describeHostSource(resolved: ResolvedHost): string {
  switch (resolved.source) {
    case "flag":
      return "from --host";
    case "env":
      return `from ${HOST_ENV}`;
    case "detected":
      return `detected from ${CLAUDE_CODE_MARKER_ENV}=1`;
    case "default":
      return "default";
  }
}

function formatTarget(target: RoutingTarget): string {
  return `${target.model}/${target.reasoning_effort}`;
}

async function checkManagedBlock(
  location: InstructionLocation | { path: string },
): Promise<boolean> {
  const label =
    "host" in location
      ? `managed block [${location.host}] ${location.path}`
      : "managed block";
  try {
    const contents = await readFile(location.path, "utf8");
    const markerState = inspectManagedAgentsMarkers(contents, location.path);
    if (markerState === "complete") {
      const isCurrent = normalizeLineEndings(contents).includes(
        normalizeLineEndings(MANAGED_AGENTS_BLOCK),
      );
      process.stdout.write(
        `INFO ${label}: present (${isCurrent ? "matches current template" : "template update available"})\n`,
      );
    } else {
      process.stdout.write(`INFO ${label}: absent at the requested path\n`);
    }
    return true;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (error instanceof ManagedAgentsMarkerError) {
      process.stdout.write(`FAIL ${label}: malformed markers\n`);
      return false;
    }
    if (code === "ENOENT") {
      process.stdout.write(`INFO ${label}: absent at the requested path\n`);
      return true;
    }
    process.stdout.write(`FAIL ${label}: requested path is unreadable\n`);
    return false;
  }
}

export async function runDoctor(args: string[]): Promise<number> {
  const { flags, positionals } = parseOptions(
    args,
    ["--global"],
    ["--config", "--agents-path", "--host"],
  );
  if (positionals.length > 0) throw new Error("doctor does not take a task");
  const checkGlobal = flags["--global"] === true;
  const agentsPathFlag = stringFlag(flags, "--agents-path");
  if (checkGlobal && agentsPathFlag !== undefined) {
    throw new Error("--agents-path cannot be combined with --global");
  }

  let failed = false;
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) {
    process.stdout.write(`PASS runtime: Node.js ${process.version}\n`);
  } else {
    process.stdout.write(
      `FAIL runtime: Node.js ${process.version}; install Node.js 22 or newer\n`,
    );
    failed = true;
  }

  let config: ReturnType<typeof loadConfig> | undefined;
  try {
    config = loadConfig({
      configPath: stringFlag(flags, "--config"),
    });
    process.stdout.write("PASS configuration: resolved settings are valid\n");
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      process.stdout.write("FAIL policy: resolved routing policy is invalid\n");
    } else if (error instanceof ConfigValidationError) {
      process.stdout.write("FAIL configuration: invalid or unavailable\n");
    } else {
      process.stdout.write("FAIL configuration: could not be validated\n");
    }
    failed = true;
  }

  let resolvedHost: ResolvedHost | undefined;
  try {
    resolvedHost = resolveHost(stringFlag(flags, "--host"));
    process.stdout.write(
      `INFO host: ${resolvedHost.host} (${describeHostSource(resolvedHost)})\n`,
    );
  } catch (error) {
    if (!(error instanceof HostResolutionError)) throw error;
    process.stdout.write("FAIL host: --host must be codex, claude, or auto\n");
    failed = true;
  }

  if (config) {
    try {
      validateRoutingPolicy(config.policy);
      process.stdout.write(
        `PASS policy: ${config.policy.strategy} strategy and route mapping\n`,
      );
      for (const host of HOSTS) {
        const targets = targetsForHost(config.policy, host);
        const routes = (["low", "medium", "high", "xhigh"] as const)
          .map((d) => `${d}=${formatTarget(targets.routes[d])}`)
          .join(" ");
        process.stdout.write(
          `INFO targets [${host}]: ${routes} fallback=${formatTarget(targets.fallback)}\n`,
        );
      }
    } catch {
      process.stdout.write("FAIL policy: resolved routing policy is invalid\n");
      failed = true;
      config = undefined;
    }
  }

  if (config) {
    const backend = new OllayaBackend({
      url: config.backend.url,
      model: config.backend.model,
      timeoutMs: config.backend.timeout_ms,
    });
    const health = await backend.healthCheck();
    if (health.healthy) {
      process.stdout.write(
        `PASS backend typed response: ${config.backend.model} (${Math.round(health.latencyMs ?? 0)} ms)\n`,
      );
    } else {
      process.stdout.write(
        `FAIL backend typed response: ${health.reason ?? "backend_unavailable"}\n`,
      );
      failed = true;
    }
  } else {
    process.stdout.write(
      "SKIP backend typed response: configuration or policy failed\n",
    );
  }

  if (checkGlobal) {
    for (const location of globalInstructionLocations()) {
      if (!(await checkManagedBlock(location))) failed = true;
    }
  } else {
    const agentsPath = resolve(agentsPathFlag ?? "AGENTS.md");
    if (!(await checkManagedBlock({ path: agentsPath }))) failed = true;
  }

  reportUnverifiedCodexEvidence();
  return failed ? 1 : 0;
}

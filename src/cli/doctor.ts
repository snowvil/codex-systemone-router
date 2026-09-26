import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OllayaBackend } from "../backend/ollaya.js";
import { ConfigValidationError, loadConfig } from "../config/loader.js";
import {
  inspectManagedAgentsMarkers,
  ManagedAgentsMarkerError,
} from "../codex/installer.js";
import { MANAGED_AGENTS_BLOCK } from "../codex/agents-template.js";
import {
  validateRoutingPolicy,
  PolicyValidationError,
} from "../policy/default-policy.js";
import { parseOptions, stringFlag } from "./options.js";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function reportUnverifiedCodexEvidence(): void {
  process.stdout.write(
    "UNVERIFIED Codex instruction loading: this check cannot determine which AGENTS.md Codex loaded; an AGENTS.override.md or nearer project file may change the active instructions.\n",
  );
  process.stdout.write(
    "UNVERIFIED child runtime settings: this check cannot observe the model or reasoning effort actually used after a subagent spawn.\n",
  );
}

export async function runDoctor(args: string[]): Promise<number> {
  const { flags, positionals } = parseOptions(
    args,
    [],
    ["--config", "--agents-path"],
  );
  if (positionals.length > 0) throw new Error("doctor does not take a task");

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

  if (config) {
    try {
      validateRoutingPolicy(config.policy);
      process.stdout.write(
        `PASS policy: ${config.policy.strategy} strategy and route mapping\n`,
      );
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

  const agentsPath = resolve(stringFlag(flags, "--agents-path") ?? "AGENTS.md");
  try {
    const contents = await readFile(agentsPath, "utf8");
    const markerState = inspectManagedAgentsMarkers(contents, agentsPath);
    if (markerState === "complete") {
      const isCurrent = normalizeLineEndings(contents).includes(
        normalizeLineEndings(MANAGED_AGENTS_BLOCK),
      );
      process.stdout.write(
        `INFO managed block: present (${isCurrent ? "matches current template" : "template update available"})\n`,
      );
    } else {
      process.stdout.write(
        "INFO managed block: absent at the requested path\n",
      );
    }
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (error instanceof ManagedAgentsMarkerError) {
      process.stdout.write("FAIL managed block: malformed markers\n");
      failed = true;
    } else if (code === "ENOENT") {
      process.stdout.write(
        "INFO managed block: absent at the requested path\n",
      );
    } else {
      process.stdout.write(
        "FAIL managed block: requested path is unreadable\n",
      );
      failed = true;
    }
  }

  reportUnverifiedCodexEvidence();
  return failed ? 1 : 0;
}

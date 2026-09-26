import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OllayaBackend } from "../backend/ollaya.js";
import { loadConfig } from "../config/loader.js";
import { validateRoutingPolicy } from "../policy/default-policy.js";
import {
  inspectManagedAgentsMarkers,
  ManagedAgentsMarkerError,
} from "../codex/installer.js";
import { parseOptions, stringFlag } from "./options.js";

export async function runDoctor(args: string[]): Promise<number> {
  const { flags, positionals } = parseOptions(
    args,
    [],
    ["--config", "--agents-path"],
  );
  if (positionals.length > 0) throw new Error("doctor does not take a task");
  let failed = false;
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) process.stdout.write(`PASS Node.js ${process.version}\n`);
  else {
    process.stdout.write(
      `FAIL Node.js ${process.version}; install Node.js 22 or newer\n`,
    );
    failed = true;
  }

  try {
    const config = await loadConfig({
      configPath: stringFlag(flags, "--config"),
    });
    process.stdout.write("PASS configuration\n");
    validateRoutingPolicy(config.policy);
    process.stdout.write("PASS routing policy\n");
    const backend = new OllayaBackend({
      url: config.backend.url,
      model: config.backend.model,
      timeoutMs: config.backend.timeout_ms,
    });
    const health = await backend.healthCheck();
    if (health.healthy) {
      process.stdout.write(
        `PASS Ollaya ${config.backend.model} response/schema (${Math.round(health.latencyMs ?? 0)} ms)\n`,
      );
    } else {
      process.stdout.write(
        `FAIL Ollaya ${config.backend.model}: ${health.reason ?? "backend_unavailable"}; check the service, model, and endpoint\n`,
      );
      failed = true;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown configuration error";
    process.stdout.write(`FAIL configuration or policy: ${message}\n`);
    failed = true;
  }

  const agentsPath = resolve(stringFlag(flags, "--agents-path") ?? "AGENTS.md");
  try {
    const contents = await readFile(agentsPath, "utf8");
    if (inspectManagedAgentsMarkers(contents, agentsPath) === "complete") {
      process.stdout.write(`PASS AGENTS integration (${agentsPath})\n`);
    } else {
      process.stdout.write(
        `INFO AGENTS integration absent (${agentsPath}); run install to enable instruction-driven routing\n`,
      );
    }
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (error instanceof ManagedAgentsMarkerError) {
      process.stdout.write(`FAIL AGENTS integration: ${error.message}\n`);
      failed = true;
    } else if (code === "ENOENT") {
      process.stdout.write(
        `INFO AGENTS integration absent (${agentsPath}); run install to enable instruction-driven routing\n`,
      );
    } else {
      process.stderr.write(
        `FAIL AGENTS integration could not be read (${agentsPath})\n`,
      );
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

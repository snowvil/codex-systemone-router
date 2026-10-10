#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { runRoute } from "./route.js";
import { runDoctor } from "./doctor.js";
import { runInstall, runUninstall } from "./install.js";

export async function main(
  args: string[] = process.argv.slice(2),
): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (
      ["route", "doctor", "install", "uninstall"].includes(command ?? "") &&
      rest.length === 1 &&
      (rest[0] === "--help" || rest[0] === "-h")
    ) {
      process.stdout.write(usage);
      return 0;
    }
    switch (command) {
      case "route":
        return await runRoute(rest);
      case "doctor":
        return await runDoctor(rest);
      case "install":
        return await runInstall(rest);
      case "uninstall":
        return await runUninstall(rest);
      case "--help":
      case "-h":
      case undefined:
        process.stdout.write(usage);
        return 0;
      default:
        process.stderr.write(`Unknown command: ${command}\n${usage}`);
        return 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

const usage = `Usage: codex-systemone-router <command> [options]

Commands:
  route [--json] [--stdin] [--host codex|claude|auto] [--config PATH] <task>
  doctor [--config PATH] [--host codex|claude|auto] [--agents-path FILE] [--global]
  install [--global] [--host codex|claude|all] [--path FILE] [--dry-run]
  uninstall [--global] [--host codex|claude|all] [--path FILE] [--dry-run]

Hosts:
  codex   Codex subagents (default). Targets from policy.hosts.codex, also
          written as the policy.routes / policy.fallback shorthand.
  claude  Claude Code subagents (Agent tool model alias + effort). Targets
          from policy.hosts.claude. Selected automatically when CLAUDECODE=1.
  auto    Use CODEX_SYSTEMONE_ROUTER_HOST, then CLAUDECODE detection, then codex.

Install locations:
  (default)  AGENTS.md in the current directory (read by Codex, and by Claude
             Code when the project has no CLAUDE.md).
  --host claude  CLAUDE.md in the current directory.
  --global   $CODEX_HOME/AGENTS.md (default ~/.codex) and
             $CLAUDE_CONFIG_DIR/CLAUDE.md (default ~/.claude); --host limits
             this to one of them.

Route overrides:
  --backend-url URL              Decision endpoint
  --backend-model MODEL          Decision model
  --timeout-ms MS                Timeout (1..120000)
  --fallback-model MODEL         Safe execution model for the selected host
  --fallback-reasoning-effort low|medium|high|xhigh

Use -- before a task beginning with -. Stdin accepts up to 100000 UTF-16 code
units. Use --help or -h for help. Configuration: CLI > env > file > defaults.
Route returns exit 0 for backend fallback; inspect fallback and reason in JSON.
Invalid configuration exits 2 without a route; unexpected internal errors exit 1.
Doctor failures exit 1; unknown commands exit 2.
`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  process.exitCode = await main();
}

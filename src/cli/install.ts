import {
  globalInstructionLocations,
  installAgents,
  projectInstructionLocations,
  uninstallAgents,
  type AgentsOperationResult,
  type InstallOptions,
  type InstructionLocation,
} from "../codex/installer.js";
import { HOSTS, type Host } from "../policy/types.js";
import { parseOptions, stringFlag } from "./options.js";

interface Plan {
  targets: InstructionLocation[] | string[];
  dryRun: boolean;
  global: boolean;
}

function hostsFromFlag(value: string | undefined, fallback: Host[]): Host[] {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "all") return [...HOSTS];
  if ((HOSTS as readonly string[]).includes(normalized)) {
    return [normalized as Host];
  }
  throw new Error(`--host must be ${HOSTS.join(", ")}, or all`);
}

function plan(args: string[]): Plan {
  const parsed = parseOptions(
    args,
    ["--dry-run", "--global"],
    ["--path", "--host"],
  );
  if (parsed.positionals.length > 0)
    throw new Error("Unexpected positional argument");
  const path = stringFlag(parsed.flags, "--path");
  const hostFlag = stringFlag(parsed.flags, "--host");
  const global = parsed.flags["--global"] === true;
  const dryRun = parsed.flags["--dry-run"] === true;
  if (path !== undefined && (global || hostFlag !== undefined)) {
    throw new Error("--path cannot be combined with --global or --host");
  }
  if (path !== undefined) return { targets: [path], dryRun, global };
  // Global installs cover both hosts by default: one install, every project.
  // Project installs keep the historical AGENTS.md default.
  const hosts = hostsFromFlag(hostFlag, global ? [...HOSTS] : ["codex"]);
  return {
    targets: global
      ? globalInstructionLocations(process.env, hosts)
      : projectInstructionLocations(hosts),
    dryRun,
    global,
  };
}

function describe(result: AgentsOperationResult, host?: Host): void {
  const verb = result.dryRun ? "Would be" : "Was";
  const label = host === undefined ? "" : ` [${host}]`;
  process.stdout.write(`${result.path}${label}: ${verb} ${result.status}\n`);
  if (result.backupPath && !result.dryRun)
    process.stdout.write(`Backup: ${result.backupPath}\n`);
}

function execute(
  args: string[],
  operation: (options: InstallOptions) => AgentsOperationResult,
): number {
  const { targets, dryRun, global } = plan(args);
  for (const target of targets) {
    if (typeof target === "string") {
      describe(operation({ path: target, dryRun }));
    } else {
      describe(
        operation({
          path: target.path,
          dryRun,
          createParentDirectory: global,
        }),
        target.host,
      );
    }
  }
  return 0;
}

export async function runInstall(args: string[]): Promise<number> {
  return execute(args, installAgents);
}

export async function runUninstall(args: string[]): Promise<number> {
  return execute(args, uninstallAgents);
}

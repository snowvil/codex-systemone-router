import {
  installAgents,
  uninstallAgents,
  type AgentsOperationResult,
} from "../codex/installer.js";
import { parseOptions, stringFlag } from "./options.js";

function options(args: string[]): { path?: string; dryRun: boolean } {
  const parsed = parseOptions(args, ["--dry-run"], ["--path"]);
  if (parsed.positionals.length > 0)
    throw new Error("Unexpected positional argument");
  return {
    path: stringFlag(parsed.flags, "--path"),
    dryRun: parsed.flags["--dry-run"] === true,
  };
}

function describe(result: AgentsOperationResult): void {
  const verb = result.dryRun ? "Would be" : "Was";
  process.stdout.write(`${result.path}: ${verb} ${result.status}\n`);
  if (result.backupPath && !result.dryRun)
    process.stdout.write(`Backup: ${result.backupPath}\n`);
}

export async function runInstall(args: string[]): Promise<number> {
  describe(installAgents(options(args)));
  return 0;
}

export async function runUninstall(args: string[]): Promise<number> {
  describe(uninstallAgents(options(args)));
  return 0;
}

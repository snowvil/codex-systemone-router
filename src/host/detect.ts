import { DEFAULT_HOST, HOSTS, type Host } from "../policy/types.js";

/** Environment variable that pins the host regardless of auto-detection. */
export const HOST_ENV = "CODEX_SYSTEMONE_ROUTER_HOST";

/**
 * Claude Code sets `CLAUDECODE=1` in every subprocess it spawns (Bash tool,
 * hooks, status line). Codex does not set a comparable documented marker, so
 * Codex is the default when nothing identifies Claude Code.
 */
export const CLAUDE_CODE_MARKER_ENV = "CLAUDECODE";

export type HostSource = "flag" | "env" | "detected" | "default";

export interface ResolvedHost {
  host: Host;
  source: HostSource;
}

export class HostResolutionError extends Error {
  readonly code = "invalid_host" as const;

  constructor(message: string) {
    super(message);
    this.name = "HostResolutionError";
  }
}

export function isHost(value: unknown): value is Host {
  return (
    typeof value === "string" && (HOSTS as readonly string[]).includes(value)
  );
}

function parseHost(value: string, origin: string): Host | "auto" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (isHost(normalized)) return normalized;
  throw new HostResolutionError(
    `${origin} must be ${HOSTS.join(", ")}, or auto (received ${value})`,
  );
}

/**
 * Decide which host's targets to apply.
 *
 * Precedence: explicit flag > `CODEX_SYSTEMONE_ROUTER_HOST` > Claude Code's
 * `CLAUDECODE=1` marker > the Codex default. `auto` at any level defers to the
 * next one, so an installed instruction can omit `--host` and still get the
 * right vocabulary when the router runs inside Claude Code.
 */
export function resolveHost(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): ResolvedHost {
  if (flag !== undefined) {
    const parsed = parseHost(flag, "--host");
    if (parsed !== "auto") return { host: parsed, source: "flag" };
  }
  const fromEnv = env[HOST_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    const parsed = parseHost(fromEnv, HOST_ENV);
    if (parsed !== "auto") return { host: parsed, source: "env" };
  }
  if (env[CLAUDE_CODE_MARKER_ENV] === "1") {
    return { host: "claude", source: "detected" };
  }
  return { host: DEFAULT_HOST, source: "default" };
}

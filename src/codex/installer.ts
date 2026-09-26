import {
  copyFileSync,
  readFileSync,
  lstatSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import {
  AGENTS_END_MARKER,
  AGENTS_START_MARKER,
  AGENTS_TEMPLATE,
  MANAGED_AGENTS_BLOCK,
} from "./agents-template.js";

export interface InstallOptions {
  /** Path to the AGENTS.md file. Defaults to <cwd>/AGENTS.md. */
  path?: string;
  /** Calculate the change without writing the file or creating a backup. */
  dryRun?: boolean;
}

export type InstallerOperation = "install" | "uninstall";
export type MarkerState = "absent" | "complete";
export type InstallerStatus = "created" | "updated" | "unchanged" | "removed";

export interface AgentsOperationResult {
  operation: InstallerOperation;
  /** Absolute path inspected by the operation. */
  path: string;
  dryRun: boolean;
  /** Whether the operation would or did change the file. */
  changed: boolean;
  /** True only when install created a previously absent file. */
  created: boolean;
  /** Whether a complete managed block was present before the operation. */
  hadManagedBlock: boolean;
  markerState: MarkerState;
  status: InstallerStatus;
  bytesBefore: number;
  bytesAfter: number;
  /** Existing-file backup path, when a replacement/removal was needed. */
  backupPath?: string;
}

/** Error raised when marker-like content is unsafe to edit automatically. */
export class ManagedAgentsMarkerError extends Error {
  readonly code = "malformed_markers" as const;
  readonly filePath: string;

  constructor(filePath: string, reason: string) {
    super(`Refusing to edit ${filePath}: ${reason}`);
    this.name = "ManagedAgentsMarkerError";
    this.filePath = filePath;
  }
}

interface CompleteMarkers {
  state: "complete";
  startIndex: number;
  endIndex: number;
  endExclusive: number;
}

interface NoMarkers {
  state: "absent";
}

type MarkerAnalysis = CompleteMarkers | NoMarkers;

const MARKER_PREFIX_RE = /<!--\s*codex-systemone-router\b/gi;

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function lineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function withLineEnding(text: string, eol: "\n" | "\r\n"): string {
  return eol === "\n" ? text : text.replaceAll("\n", eol);
}

function analyzeMarkers(content: string, filePath: string): MarkerAnalysis {
  const starts = countOccurrences(content, AGENTS_START_MARKER);
  const ends = countOccurrences(content, AGENTS_END_MARKER);
  const markerLikeCount = [...content.matchAll(MARKER_PREFIX_RE)].length;

  // Any marker-like token that is not one of the two exact markers is treated
  // as unsafe.  This catches truncated comments and hand-edited marker names
  // before the installer could accidentally consume unrelated content.
  if (markerLikeCount !== starts + ends) {
    throw new ManagedAgentsMarkerError(
      filePath,
      "found a partial or malformed codex-systemone-router marker",
    );
  }

  if (starts === 0 && ends === 0) return { state: "absent" };
  if (starts !== 1 || ends !== 1) {
    throw new ManagedAgentsMarkerError(
      filePath,
      "expected exactly one start marker and one end marker",
    );
  }

  const startIndex = content.indexOf(AGENTS_START_MARKER);
  const endIndex = content.indexOf(AGENTS_END_MARKER);
  if (startIndex > endIndex) {
    throw new ManagedAgentsMarkerError(
      filePath,
      "the end marker appears before the start marker",
    );
  }

  const standalone = (index: number, marker: string): boolean => {
    const beforeIsLineBreak = index === 0 || content[index - 1] === "\n";
    const after = index + marker.length;
    const afterIsLineBreak =
      after === content.length ||
      content[after] === "\n" ||
      (content[after] === "\r" && content[after + 1] === "\n");
    return beforeIsLineBreak && afterIsLineBreak;
  };
  if (
    !standalone(startIndex, AGENTS_START_MARKER) ||
    !standalone(endIndex, AGENTS_END_MARKER)
  ) {
    throw new ManagedAgentsMarkerError(
      filePath,
      "markers must each occupy a complete line",
    );
  }

  return {
    state: "complete",
    startIndex,
    endIndex,
    endExclusive: endIndex + AGENTS_END_MARKER.length,
  };
}

/** Inspect markers without modifying the file; used by doctor and installer. */
export function inspectManagedAgentsMarkers(
  content: string,
  filePath: string,
): MarkerState {
  return analyzeMarkers(content, filePath).state;
}

function appendManagedBlock(content: string): string {
  if (content.length === 0) return AGENTS_TEMPLATE;
  const eol = lineEnding(content);
  return `${content}${content.endsWith("\n") ? "" : eol}${withLineEnding(MANAGED_AGENTS_BLOCK, eol)}${eol}`;
}

function replaceManagedBlock(
  content: string,
  markers: CompleteMarkers,
): string {
  const eol = lineEnding(content);
  const canonicalBlock = withLineEnding(MANAGED_AGENTS_BLOCK, eol);
  return `${content.slice(0, markers.startIndex)}${canonicalBlock}${content.slice(markers.endExclusive)}`;
}

/** Remove the managed marker lines and body, never preceding user whitespace. */
function removeManagedBlock(content: string, markers: CompleteMarkers): string {
  let after = content.slice(markers.endExclusive);
  if (after.startsWith("\r\n")) after = after.slice(2);
  else if (after.startsWith("\n")) after = after.slice(1);
  return content.slice(0, markers.startIndex) + after;
}

function resolveAgentsPath(filePath?: string): string {
  const candidate = filePath ?? join(process.cwd(), "AGENTS.md");
  return isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(process.cwd(), candidate);
}

function readExisting(filePath: string): string | undefined {
  let info;
  try {
    info = lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  // Do not follow symlinks, including broken links, when editing instructions.
  if (!info.isFile()) {
    throw new Error(`AGENTS path is not a regular file: ${filePath}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      readFileSync(filePath),
    );
  } catch (error) {
    if (error instanceof TypeError)
      throw new Error("AGENTS file must contain valid UTF-8");
    throw error;
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function nextBackupPath(filePath: string): string {
  const base = `${filePath}.codex-systemone-router.bak`;
  if (!pathExists(base)) return base;
  let suffix = 1;
  while (true) {
    const candidate = `${base}.${suffix}`;
    if (!pathExists(candidate)) return candidate;
    suffix += 1;
  }
}

function createBackup(filePath: string): string {
  let candidate = nextBackupPath(filePath);
  while (true) {
    try {
      copyFileSync(filePath, candidate, fsConstants.COPYFILE_EXCL);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      candidate = nextBackupPath(filePath);
    }
  }
}

/** Stage a complete replacement beside the file so interrupted writes cannot truncate it. */
function replaceFile(filePath: string, previous: string, next: string): void {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  const mode = lstatSync(filePath).mode & 0o777;
  writeFileSync(temporary, next, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    chmodSync(temporary, mode);
    if (readExisting(filePath) !== previous) {
      throw new Error(
        "AGENTS file changed during installation; retry after other edits finish",
      );
    }
    renameSync(temporary, filePath);
  } finally {
    if (pathExists(temporary)) unlinkSync(temporary);
  }
}

function operationResult(
  operation: InstallerOperation,
  filePath: string,
  content: string | undefined,
  nextContent: string,
  options: InstallOptions,
  markers: MarkerAnalysis,
  status: InstallerStatus,
  created: boolean,
  backupPath?: string,
): AgentsOperationResult {
  const bytesBefore = Buffer.byteLength(content ?? "", "utf8");
  const bytesAfter = Buffer.byteLength(nextContent, "utf8");
  return {
    operation,
    path: filePath,
    dryRun: options.dryRun === true,
    changed: content === undefined || nextContent !== content,
    created,
    hadManagedBlock: markers.state === "complete",
    markerState: markers.state,
    status,
    bytesBefore,
    bytesAfter,
    ...(backupPath === undefined ? {} : { backupPath }),
  };
}

export function installAgents(
  options: InstallOptions = {},
): AgentsOperationResult {
  const filePath = resolveAgentsPath(options.path);
  const content = readExisting(filePath);

  if (content === undefined) {
    const nextContent = AGENTS_TEMPLATE;
    const result = operationResult(
      "install",
      filePath,
      undefined,
      nextContent,
      options,
      { state: "absent" },
      "created",
      true,
    );
    if (!options.dryRun)
      writeFileSync(filePath, nextContent, { encoding: "utf8", flag: "wx" });
    return result;
  }

  const markers = analyzeMarkers(content, filePath);
  const eol = lineEnding(content);
  const canonicalBlock = withLineEnding(MANAGED_AGENTS_BLOCK, eol);
  const existingBlock =
    markers.state === "complete"
      ? content.slice(markers.startIndex, markers.endExclusive)
      : undefined;
  const nextContent =
    markers.state === "absent"
      ? appendManagedBlock(content)
      : existingBlock === canonicalBlock
        ? content
        : replaceManagedBlock(content, markers);
  const changed = nextContent !== content;
  const backupPath = changed ? nextBackupPath(filePath) : undefined;
  const result = operationResult(
    "install",
    filePath,
    content,
    nextContent,
    options,
    markers,
    changed ? "updated" : "unchanged",
    false,
    backupPath,
  );
  if (!options.dryRun && changed) {
    result.backupPath = createBackup(filePath);
    replaceFile(filePath, content, nextContent);
  }
  return result;
}

export function uninstallAgents(
  options: InstallOptions = {},
): AgentsOperationResult {
  const filePath = resolveAgentsPath(options.path);
  const content = readExisting(filePath);

  if (content === undefined) {
    return operationResult(
      "uninstall",
      filePath,
      "",
      "",
      options,
      { state: "absent" },
      "unchanged",
      false,
    );
  }

  const markers = analyzeMarkers(content, filePath);
  if (markers.state === "absent") {
    return operationResult(
      "uninstall",
      filePath,
      content,
      content,
      options,
      markers,
      "unchanged",
      false,
    );
  }

  const nextContent = removeManagedBlock(content, markers);
  const backupPath = nextBackupPath(filePath);
  const result = operationResult(
    "uninstall",
    filePath,
    content,
    nextContent,
    options,
    markers,
    "removed",
    false,
    backupPath,
  );
  if (!options.dryRun) {
    result.backupPath = createBackup(filePath);
    replaceFile(filePath, content, nextContent);
  }
  return result;
}

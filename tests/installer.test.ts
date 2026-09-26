import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AGENTS_END_MARKER,
  AGENTS_START_MARKER,
  AGENTS_TEMPLATE,
  MANAGED_AGENTS_BLOCK,
} from "../src/codex/agents-template.js";
import {
  ManagedAgentsMarkerError,
  installAgents,
  uninstallAgents,
} from "../src/codex/installer.js";

function tempAgentsPath(): string {
  return join(
    mkdtempSync(join(tmpdir(), "codex-systemone-router-installer-")),
    "AGENTS.md",
  );
}

test("checked-in AGENTS template matches the installed block", () => {
  assert.equal(
    readFileSync(new URL("../templates/AGENTS.md", import.meta.url), "utf8"),
    AGENTS_TEMPLATE,
  );
});

test("AGENTS template follows repository-local policy without hardcoding branch names", () => {
  assert.ok(
    MANAGED_AGENTS_BLOCK.includes(
      "Before changing a repository, read its AGENTS.md plus contribution, version, and release guidance; follow that repository's documented branch workflow and do not apply another project's policy.",
    ),
  );
  assert.doesNotMatch(MANAGED_AGENTS_BLOCK, /\bmain\b|\bdevelop\b|feature\//);
});

test("AGENTS installer creates the managed block when the file is absent", () => {
  const path = tempAgentsPath();

  const result = installAgents({ path });

  assert.equal(result.status, "created");
  assert.equal(result.changed, true);
  assert.equal(readFileSync(path, "utf8"), `${MANAGED_AGENTS_BLOCK}\n`);
  assert.equal(result.backupPath, undefined);
});

test("AGENTS installer preserves unrelated content and is idempotent", () => {
  const path = tempAgentsPath();
  const original = "# Project instructions\nKeep this paragraph.\n";
  writeFileSync(path, original, "utf8");

  const first = installAgents({ path });
  const installed = readFileSync(path, "utf8");
  const second = installAgents({ path });

  assert.equal(first.status, "updated");
  assert.ok(first.backupPath);
  assert.equal(installed.startsWith(original), true);
  assert.equal(second.status, "unchanged");
  assert.equal(second.changed, false);
  assert.equal(
    readdirSync(join(path, "..")).filter((name) => name.includes(".bak"))
      .length,
    1,
  );
});

test("AGENTS installer replaces a changed managed block while backing up the prior file", () => {
  const path = tempAgentsPath();
  const original = `# Existing\n${AGENTS_START_MARKER}\nold instructions\n${AGENTS_END_MARKER}\n`;
  writeFileSync(path, original, "utf8");

  const result = installAgents({ path });

  assert.equal(result.status, "updated");
  assert.ok(result.backupPath);
  assert.equal(readFileSync(result.backupPath, "utf8"), original);
  assert.equal(readFileSync(path, "utf8").includes(MANAGED_AGENTS_BLOCK), true);
});

test("AGENTS installer uninstalls only the managed block and is idempotent", () => {
  const path = tempAgentsPath();
  const original = "# Keep me\n";
  writeFileSync(path, original, "utf8");
  installAgents({ path });

  const removed = uninstallAgents({ path });
  const repeated = uninstallAgents({ path });

  assert.equal(removed.status, "removed");
  assert.equal(readFileSync(path, "utf8"), original);
  assert.equal(repeated.status, "unchanged");
  assert.equal(repeated.changed, false);
});

test("AGENTS installer reports dry-run changes without writing or making backups", () => {
  const path = tempAgentsPath();
  const original = "# Keep me";
  writeFileSync(path, original, "utf8");

  const install = installAgents({ path, dryRun: true });
  assert.equal(install.changed, true);
  assert.equal(readFileSync(path, "utf8"), original);
  assert.deepEqual(readdirSync(join(path, "..")), ["AGENTS.md"]);

  const installedPath = tempAgentsPath();
  installAgents({ path: installedPath });
  const before = readFileSync(installedPath, "utf8");
  const uninstall = uninstallAgents({ path: installedPath, dryRun: true });
  assert.equal(uninstall.changed, true);
  assert.equal(readFileSync(installedPath, "utf8"), before);
});

for (const malformed of [
  `${AGENTS_START_MARKER}\npartial`,
  `partial\n${AGENTS_END_MARKER}`,
  `${AGENTS_END_MARKER}\n${AGENTS_START_MARKER}`,
  "<!-- codex-systemone-router:start",
  `Prefix ${AGENTS_START_MARKER} managed? ${AGENTS_END_MARKER} suffix`,
]) {
  test(`AGENTS installer refuses malformed or partial markers: ${malformed}`, () => {
    const path = tempAgentsPath();
    writeFileSync(path, malformed, "utf8");

    assert.throws(() => installAgents({ path }), ManagedAgentsMarkerError);
    assert.throws(() => uninstallAgents({ path }), ManagedAgentsMarkerError);
    assert.equal(readFileSync(path, "utf8"), malformed);
    assert.deepEqual(readdirSync(join(path, "..")), ["AGENTS.md"]);
  });
}

test("AGENTS installer refuses symbolic links without changing their targets", () => {
  const path = tempAgentsPath();
  const target = join(path, "..", "target.md");
  const original = "# External instructions\n";
  writeFileSync(target, original, "utf8");
  symlinkSync(target, path);

  assert.throws(() => installAgents({ path }), /not a regular file/);
  assert.throws(() => uninstallAgents({ path }), /not a regular file/);
  assert.equal(readFileSync(target, "utf8"), original);
});

test("uninstall preserves the newline terminating unrelated instructions", () => {
  const path = tempAgentsPath();
  writeFileSync(
    path,
    `# Keep me\n${AGENTS_START_MARKER}\nold\n${AGENTS_END_MARKER}\n`,
  );
  uninstallAgents({ path });
  assert.equal(readFileSync(path, "utf8"), "# Keep me\n");
});

test("dry-run treats a dangling backup symlink as occupied", () => {
  const path = tempAgentsPath();
  writeFileSync(path, "# Keep\n");
  symlinkSync(
    join(path, "..", "missing"),
    `${path}.codex-systemone-router.bak`,
  );
  const result = installAgents({ path, dryRun: true });
  assert.equal(result.backupPath, `${path}.codex-systemone-router.bak.1`);
});

test("installer rejects invalid UTF-8 instead of replacing user bytes", () => {
  const path = tempAgentsPath();
  const bytes = Buffer.from([0x23, 0x20, 0xff, 0x0a]);
  writeFileSync(path, bytes);
  assert.throws(() => installAgents({ path }), /UTF-8/);
  assert.deepEqual(readFileSync(path), bytes);
});

for (const original of ["", "# Keep\r\n", "# Keep\n\n", "# Keep\r\n\r\n"]) {
  test(`install/uninstall preserves whitespace ${JSON.stringify(original)}`, () => {
    const path = tempAgentsPath();
    writeFileSync(path, original);
    installAgents({ path });
    uninstallAgents({ path });
    assert.equal(readFileSync(path, "utf8"), original);
  });
}

test("preserves both sides of a middle block, including mixed line endings", () => {
  const path = tempAgentsPath();
  writeFileSync(
    path,
    `before\r\n${AGENTS_START_MARKER}\nold\n${AGENTS_END_MARKER}\nafter\r\n`,
  );
  uninstallAgents({ path });
  assert.equal(readFileSync(path, "utf8"), "before\r\nafter\r\n");
});

test("dry-run on absent files creates no files and repeated absent uninstall is safe", () => {
  const path = tempAgentsPath();
  installAgents({ path, dryRun: true });
  uninstallAgents({ path, dryRun: true });
  uninstallAgents({ path });
  assert.deepEqual(readdirSync(join(path, "..")), []);
});

test("repeated marker blocks are refused without changing user content", () => {
  const path = tempAgentsPath();
  const content = AGENTS_TEMPLATE.repeat(2);
  writeFileSync(path, content);
  assert.throws(() => installAgents({ path }), ManagedAgentsMarkerError);
  assert.throws(() => uninstallAgents({ path }), ManagedAgentsMarkerError);
  assert.equal(readFileSync(path, "utf8"), content);
});

for (const malformed of [
  "<!-- codex-systemone-router -->",
  "<!-- codex-systemone-router start -->",
  "<!-- codex-systemone-router",
  "<!-- CODEX-SYSTEMONE-ROUTER:START -->",
]) {
  test(`refuses damaged marker comments ${malformed}`, () => {
    const path = tempAgentsPath();
    writeFileSync(path, malformed);
    assert.throws(() => installAgents({ path }), ManagedAgentsMarkerError);
    assert.throws(() => uninstallAgents({ path }), ManagedAgentsMarkerError);
    assert.equal(readFileSync(path, "utf8"), malformed);
  });
}

test("ordinary prose naming the tool with a colon is preserved", () => {
  const path = tempAgentsPath();
  const original = "# Tools\ncodex-systemone-router: use before delegation.\n";
  writeFileSync(path, original);
  installAgents({ path });
  uninstallAgents({ path });
  assert.equal(readFileSync(path, "utf8"), original);
});

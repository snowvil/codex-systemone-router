# Gitflow Branch and Version Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Gitflow and SemVer policy to repository documentation, package metadata, and the managed global Codex agent guidance.

**Architecture:** `CONTRIBUTING.md` is the repository-specific source of truth for branch, version, release, and hotfix rules, with `README.md` directing maintainers to it. The global managed `AGENTS.md` block remains repository-neutral and instructs agents to discover and follow the policy in each target repository; its TypeScript source and distributed template stay byte-for-byte equivalent.

**Tech Stack:** Markdown, TypeScript template, Node.js 22+, npm, Prettier, existing Node test runner, package installer CLI.

**Spec:** `docs/superpowers/specs/2026-09-26-gitflow-version-policy-design.md`

## Global Constraints

- `main` is the release branch; `develop` is the integration branch; `feature/<slug>` branches start from `develop`; `release/<version>` branches start from `develop`; `hotfix/<slug>` branches start from `main`.
- `package.json` and `package-lock.json` must contain the same version, and release tags use the `v` prefix.
- Before `1.0.0`, patch increments are for compatible fixes and documentation corrections. Minor increments are for new features and any breaking change to the pre-1.0 contract.
- From `1.0.0`, major increments are for breaking changes, minor increments are for backward-compatible features, and patch increments are for backward-compatible fixes.
- Do not bump the current `0.1.1` version as part of establishing this policy.
- Do not push `develop` or the feature branch, publish npm, or create a release tag during this policy setup.
- Global Codex guidance must not impose this repository's Gitflow on unrelated repositories.

## Review Focus

- A feature or release branch created from the wrong base can skip reviewed integration; document and verify each branch base in `CONTRIBUTING.md`.
- An npm version can be tagged before it is actually published; make the publish, registry verification, and same-commit tag order explicit in the release checklist.
- `package.json`, `package-lock.json`, and `CHANGELOG.md` can drift during a release; verify the current package versions remain equal and that the changelog is included in `npm pack --dry-run`.
- Repository-specific Gitflow text copied into global guidance would affect unrelated projects; assert that the managed template tells agents to read the current repository policy without hard-coding this project's branch names.
- Installing the updated managed block could damage user-owned global instructions; run the installer dry-run, install through the existing managed-block mechanism, and verify all content outside the markers is unchanged.

---

### Task 1: Document Gitflow, release versioning, and changelog ownership

**Files:**

- Modify: `CONTRIBUTING.md`
- Modify: `README.md`
- Create: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-09-26-gitflow-version-policy-design.md`

**Interfaces:**

- Consumes: The approved branch model and release sequence in the spec.
- Produces: A maintainer workflow in `CONTRIBUTING.md`, a README entry point, a Keep a Changelog file, and an npm manifest that includes it.

- [ ] **Step 1: Replace the direct-to-main branch instructions**

Document the `main`, `develop`, `feature/<slug>`, `release/<version>`, and `hotfix/<slug>` bases and purposes; shared branch review requirements; kebab-case slugs; and feature, release, and hotfix integration paths. Include the main agent's branch setup and check workflow, assigned-branch behavior for delegated agents, and the rule against direct changes to shared branches. State that release publication and registry verification precede tagging the same `main` commit, then back-merge release fixes to `develop`.

- [ ] **Step 2: State the SemVer and changelog rules**

Document the pre-1.0 and post-1.0 increment rules, matching `package.json` and `package-lock.json` versions, the `vX.Y.Z` tag format, no reuse of published npm versions, and release/hotfix ownership of version and changelog updates. Preserve the npm release checks (`npm ci`, format, typecheck, tests, build, audit, pack and publish dry-runs, registry version check, publication, and disposable install) while placing them after reviewed changes are on `main`. Add a Keep a Changelog `CHANGELOG.md` with an `Unreleased` section and a `0.1.1` entry derived from the actual `v0.1.0..v0.1.1` history; do not change the current package version.

- [ ] **Step 3: Include the changelog and connect the README**

Add `CHANGELOG.md` to the `package.json` `files` list and point the README maintainer link to the complete Gitflow and version procedure.

Update the design document status from `Proposed for review` to `Approved for implementation`.

- [ ] **Step 4: Verify the documented metadata**

Run: `node -e 'const p=require("./package.json"), l=require("./package-lock.json"); if (p.version !== l.version || p.version !== "0.1.1" || !p.files.includes("CHANGELOG.md")) process.exit(1)'`

Expected: exit 0; package and lock versions remain `0.1.1`, and the package manifest includes `CHANGELOG.md`.

- [ ] **Step 5: Check formatting and whitespace**

Run: `npm run format:check && git diff --check`

Expected: both commands pass.

- [ ] **Step 6: Commit the documentation policy**

```bash
git add CONTRIBUTING.md README.md CHANGELOG.md package.json docs/superpowers/specs/2026-09-26-gitflow-version-policy-design.md
git commit -m "docs: document Gitflow and release policy"
```

### Task 2: Make managed agent guidance repository-aware

**Files:**

- Modify: `src/codex/agents-template.ts`
- Modify: `templates/AGENTS.md`
- Modify: `tests/installer.test.ts`

**Interfaces:**

- Consumes: The existing `MANAGED_AGENTS_BLOCK` and `AGENTS_TEMPLATE` exports and installer parity test.
- Produces: Equivalent source and distributed templates that tell agents to inspect and follow each repository's own agent, contribution, and release guidance.

- [ ] **Step 1: Add a focused repository-policy assertion**

Add `test("AGENTS template follows repository-local policy without hardcoding branch names", ...)` in `tests/installer.test.ts`. Assert that `MANAGED_AGENTS_BLOCK` contains the exact repository-policy instruction added in Step 2 and does not contain the literal branch names `main`, `develop`, or `feature/`. Keep the existing test that compares `templates/AGENTS.md` with `AGENTS_TEMPLATE` as the source/distribution parity check.

- [ ] **Step 2: Update the TypeScript managed block**

Add this repository-policy discovery instruction to `MANAGED_AGENTS_BLOCK` in `src/codex/agents-template.ts`: `Before changing a repository, read its AGENTS.md plus contribution, version, and release guidance; follow that repository's documented branch workflow and do not apply another project's policy.` Keep the text general and do not name this project's branches.

- [ ] **Step 3: Synchronize and verify the distributed template**

Make `templates/AGENTS.md` exactly equal to `AGENTS_TEMPLATE` output, including newline behavior.

- [ ] **Step 4: Run the focused template tests**

Run: `npx tsx --test --test-name-pattern='AGENTS template' tests/installer.test.ts`

Expected: the managed-template policy assertion and source/distribution parity test pass.

- [ ] **Step 5: Check formatting and whitespace**

Run: `npm run format:check && git diff --check`

Expected: both commands pass.

- [ ] **Step 6: Commit agent guidance**

```bash
git add src/codex/agents-template.ts templates/AGENTS.md tests/installer.test.ts
git commit -m "docs: guide agents to repository policies"
```

### Task 3: Install and verify the global managed block

**Files:**

- Update managed block in: `/Users/snowvil84/.codex/AGENTS.md`
- Use built CLI: `dist/cli/index.js`

**Interfaces:**

- Consumes: The built installer and equivalent templates from Task 2.
- Produces: The repository-neutral policy-discovery guidance in the existing global managed block, with all user-owned text preserved.

- [ ] **Step 1: Build the installer**

Run: `npm run build`

Expected: TypeScript build succeeds and produces the CLI.

- [ ] **Step 2: Preview the managed-block update**

Run: `node dist/cli/index.js install --path /Users/snowvil84/.codex/AGENTS.md --dry-run`

Expected: the installer reports the managed block would change without modifying the global file.

- [ ] **Step 3: Install through the managed-block installer**

Run: `node dist/cli/index.js install --path /Users/snowvil84/.codex/AGENTS.md`

Expected: only content between the package markers is updated; the installer creates its normal backup.

- [ ] **Step 4: Verify global block and package contents**

Before installation, record hashes of the global file's prefix and suffix outside the managed markers without printing their contents. Verify afterward that both hashes are unchanged, the managed block equals the built template, and `npm pack --dry-run --json` lists `CHANGELOG.md`.

Expected: all checks pass without publishing or creating a release tag.

### Task 4: Review and merge the feature to local develop

**Files:**

- Review: all changes on `feature/branch-version-policy`
- Integrate: local `develop`

**Interfaces:**

- Consumes: Completed and committed outputs from Tasks 1–3.
- Produces: The approved policy on local `develop`, while `main` and `origin/main` remain at `7f429e5`.

- [ ] **Step 1: Request an independent final review**

Route the exact review task through `codex-systemone-router route --stdin --json`, read the returned `model` and `reasoning_effort`, and use those settings to spawn a fresh reviewer. Ask for correctness, policy consistency, global-file preservation, and unintended scope findings; do not ask the reviewer to modify files.

- [ ] **Step 2: Resolve review findings and inspect the complete feature diff**

Confirm no unrelated paths are staged, no merge conflicts remain, the source and distributed templates match, and the global install preserved external content.

- [ ] **Step 3: Run final repository checks**

Run: `npm run format:check && npm run typecheck && npm test && npm run build && npm pack --dry-run`

Expected: every command succeeds and the pack preview includes `CHANGELOG.md`.

- [ ] **Step 4: Merge the feature into local develop**

After confirming the current branch is `feature/branch-version-policy`, merge it into local `develop` with a merge commit. Do not push either branch.

Expected: local `develop` contains the feature commits; `main`, `origin/main`, and tag `v0.1.1` remain unchanged; the worktree is clean.

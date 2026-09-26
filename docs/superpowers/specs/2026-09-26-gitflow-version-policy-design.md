# Gitflow Branch and Version Policy Design

**Status:** Proposed for review

**Date:** 2026-09-26

## Goal

Adopt a conventional Gitflow workflow for `codex-systemone-router`, keep
`main` as the release branch, add `develop` as the integration branch, and
make the project version and agent workflow rules explicit. Agents must follow
the policy documented by the repository they are changing. The global Codex
guidance must teach agents to discover and follow repository policy without
imposing this project's Gitflow on unrelated repositories.

## Approaches Considered

1. **Full Gitflow (selected):** `main`, `develop`, `feature/*`, `release/*`,
   and `hotfix/*`, with release and urgent-fix back-merges. This matches the
   requested accumulation and release flow and gives agents unambiguous branch
   bases.
2. **Gitflow-lite:** retain `main`, `develop`, and `feature/*`, but create a
   `release/*` branch only when stabilization needs a separate window. This
   reduces branch overhead, but makes release preparation less consistent.
3. **Trunk-based/GitHub flow:** feature branches merge directly to `main` and
   releases are tagged there. This is simpler, but conflicts with the requested
   `develop` integration branch and is not selected.

## Current State

- `main` points to `v0.1.1` (`7f429e5`) and matches `origin/main`.
- At the start of this setup, no local or remote `develop` branch existed. A
  local `develop` now points to the same `7f429e5` commit as `main`; it has not
  been pushed.
- The current working branch is `feature/branch-version-policy`, created from
  that local `develop` branch for this policy work.
- `CONTRIBUTING.md` currently describes short-lived topic branches that merge
  directly into `main`; this conflicts with the requested `develop` workflow.
- The current package is version `0.1.1` in `package.json` and
  `package-lock.json`.

## Branch Model

| Branch              | Base                     | Purpose                                                                | Integration                                                                                                                 |
| ------------------- | ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `main`              | Existing release history | Canonical release branch containing reviewed, release-prepared changes | Accept reviewed `release/*` and `hotfix/*` changes; publish passing commits and tag published releases as `vX.Y.Z`          |
| `develop`           | Initially `main`         | Integration branch for the next release                                | Accept reviewed `feature/*` and release back-merges                                                                         |
| `feature/<slug>`    | `develop`                | A feature, fix, or scoped maintenance change                           | Merge into `develop` after checks and review                                                                                |
| `release/<version>` | `develop`                | Stabilize a candidate version; allow release fixes and final metadata  | Merge into `main`; publish and verify; tag the published `main` commit; merge release fixes back into `develop`             |
| `hotfix/<slug>`     | `main`                   | Urgent production correction                                           | Update version and changelog; merge into `main`; publish and verify; tag the published commit; merge the fix into `develop` |

Use lowercase kebab-case slugs. Shared branches (`main` and `develop`) are not
working branches: agents do not make direct changes on them. Use pull requests
and the repository's required checks for shared-branch integration. Remove
merged topic branches when the hosting workflow permits it.

The initial local `develop` branch was created from the current `main` commit.
This setup must not change `main`, push a branch, publish a package, or create a
new release tag.

## Version Policy

The npm package follows Semantic Versioning. `package.json` and
`package-lock.json` must contain the same version, and release tags use the
`v` prefix.

- Before `1.0.0`, patch increments are for compatible fixes and documentation
  corrections. Minor increments are for new features and any breaking change
  to the pre-1.0 contract.
- From `1.0.0`, major increments are for breaking changes, minor increments
  are for backward-compatible features, and patch increments are for
  backward-compatible fixes.
- A release or hotfix branch owns its version and changelog update. Do not
  reuse or overwrite an npm version that has already been published.
- Publish only the exact version merged to a clean, passing `main`. Verify the
  registry entry, then tag that same `main` commit as `vX.Y.Z`, consistent with
  the existing package release procedure. A release is complete after
  publication and tagging; an unpublished `main` commit is a release candidate,
  not a completed release.
- A compatible hotfix normally increments PATCH. If a hotfix changes the
  pre-1.0 contract incompatibly, increment MINOR under the pre-1.0 rule.
- Do not bump the current `0.1.1` version as part of establishing this policy.

## Agent Workflow

Before implementation or release work, the main agent:

1. Reads the applicable `AGENTS.md` and repository contribution/release policy.
2. Checks the worktree, current branch, and available local/remote branches.
3. Leaves unrelated working-tree changes untouched.
4. Creates one `feature/<slug>` branch from `develop` for the requested change,
   unless the user has already assigned a branch or worktree. Delegated agents
   work in the assigned branch or worktree and do not create competing
   integration branches unless directed.
5. Runs the checks required by the repository, reviews the diff, and integrates
   only through the documented review path.

Agents do not force-push, publish packages, create release tags, or merge to a
remote shared branch unless the user explicitly requests that action. If a
repository documents a different branch policy, agents follow that policy
instead of applying this project's Gitflow.

## Documentation Changes

- `CONTRIBUTING.md` is the detailed source of truth for branch names, merges,
  version bumps, release validation, npm publication, and tags.
- `README.md` points maintainers to that procedure.
- The managed agent template gains a short instruction to inspect and follow
  the repository's existing branch/version policy; it does not hard-code this
  project's branch names for unrelated projects.
- `CHANGELOG.md` records release notes using Keep a Changelog sections.
- Release and hotfix checklists update `package.json`, `package-lock.json`, and
  `CHANGELOG.md`; include the changelog in the npm package manifest.
- The updated managed block is installed into the existing global Codex
  `AGENTS.md` through the package installer, preserving unrelated content.
- The source template in `src/codex/agents-template.ts` and the distributed
  `templates/AGENTS.md` must remain equivalent.

## Verification and Boundaries

- Review the changed documentation and template for consistency.
- Run the formatter check and `git diff --check`.
- Use the existing installer dry-run and managed-block checks, then install
  and confirm the global block matches the updated template.
- Confirm the generated agent template and distributed template match, and
  verify the packaged file list includes `CHANGELOG.md`.
- Confirm the local `develop` branch starts at the current `main` commit and
  that `main` itself has not moved.
- Do not push `develop` or the feature branch, publish npm, or create a release
  tag during this policy setup.

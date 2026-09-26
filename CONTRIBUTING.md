# Contributing

Thanks for helping keep `codex-systemone-router` small, local, and predictable.
Read [IMPLEMENTATION.md](IMPLEMENTATION.md) before making a design change; it
is the v0.1 specification.

## Development prerequisites

- Node.js 22 or newer.
- npm.
- A local Ollaya/Kev endpoint only when exercising live backend behavior. Unit
  and CLI tests should use deterministic mocks.

Install dependencies and run the standard checks:

```bash
npm install
npm run format:check
npm run typecheck
npm test
npm run build
```

The benchmark is separate from the normal test suite:

```bash
npm run benchmark
```

It may use the local backend when configured. Treat its measurements as
environment-specific evidence and do not turn a representative fixture run
into a claim about the canonical 100-task benchmark.

## Scope and design rules

v0.1 has four boundaries:

1. backend adapters return a validated, backend-neutral `DifficultyDecision`;
2. pure score and policy code maps probabilities to a target;
3. CLI code handles input, output, diagnostics, and safe fallback; and
4. installer code manages only the marked `AGENTS.md` block.

Keep model names in configuration/policy data rather than scattering them
through implementation code. Preserve all four probabilities and the score.
Do not route from argmax alone or treat confidence as the only routing signal.
Use native `fetch` and filesystem/process APIs where practical; avoid adding a
framework, database, logging framework, daemon, server, or speculative
abstraction.

The router is not an interceptor. `AGENTS.md` provides the integration
instructions, but cannot enforce that a Codex main agent calls the router before
every `spawn_agent` invocation. Do not describe an instruction change as
technical interception.

## Tests and evidence

Changes to decision validation, score math, thresholds, config precedence,
fallback, or CLI behavior need focused tests. Backend tests should cover valid
responses plus timeout, connection failure, non-2xx, malformed JSON, missing or
unknown choices, missing/invalid probabilities, near-1 sums, and grossly invalid
distributions.

Installer tests should use temporary files and cover absent files, unrelated
content, existing and repeated managed blocks, dry-run, malformed/partial
markers, and preservation of user content. CLI tests should cover argument and
stdin tasks, JSON and human output, fallback, and doctor success/failure.

When reporting verification, distinguish the evidence boundary. A build or
mock test proves static/runtime behavior under that test; it does not prove a
live Ollaya service, Codex spawn enforcement, physical-device behavior, or
production savings.

## Documentation expectations

Document user-visible flags, config keys, environment overrides, fallback
reasons, and exit behavior in the README or CLI help. Keep examples complete
enough for a new user to reproduce them. State when data is representative and
when labels are heuristic. Do not market the exploratory M4 figures as a
guarantee, and call out the weak xhigh calibration.

## Branches and versions

This repository uses Gitflow. Create branches with lowercase kebab-case slugs:

| Branch              | Base                     | Purpose and integration                                                                                                                                                       |
| ------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`              | Existing release history | Canonical release branch. Accept reviewed `release/*` and `hotfix/*` changes. Publish and tag the passing `main` commit.                                                      |
| `develop`           | Initially `main`         | Integration branch for the next release. Accept reviewed `feature/*` changes and release back-merges.                                                                         |
| `feature/<slug>`    | `develop`                | Feature, fix, or scoped maintenance work. Run checks and merge through review into `develop`.                                                                                 |
| `release/<version>` | `develop`                | Stabilize a candidate, make release fixes, and update version and changelog. Merge through review into `main`, publish and tag, then back-merge release fixes into `develop`. |
| `hotfix/<slug>`     | `main`                   | Urgent production correction. Update version and changelog, merge through review into `main`, publish and tag, then merge the fix into `develop`.                             |

`main` and `develop` are shared branches. Do not make direct changes on them.
Use pull requests and the repository's required checks for integration. Remove
merged topic branches when the hosting workflow permits it.

Before implementation or release work, the main agent reads the applicable
`AGENTS.md` and this policy, checks the worktree and current branch, and
inspects available local and remote branches. Leave unrelated working-tree
changes untouched. Create a `feature/<slug>` branch from `develop` for a normal
change unless the user has assigned a branch or worktree. Delegated agents work
in their assigned branch or worktree; they do not create competing integration
branches unless directed. Review the diff, run the required checks, and use the
review path above. Agents do not force-push, publish packages, create release
tags, or merge to a remote shared branch unless the user explicitly requests
that action.

Follow Semantic Versioning for the npm package:

- Before `1.0.0`, increment PATCH for compatible fixes and documentation
  corrections; increment MINOR for new features or any breaking change to the
  pre-1.0 contract. A compatible hotfix normally increments PATCH, while a
  breaking pre-1.0 hotfix increments MINOR.
- From `1.0.0`, increment MAJOR for breaking changes, MINOR for
  backward-compatible features, and PATCH for backward-compatible fixes.
- Keep the versions in `package.json` and `package-lock.json` identical. A
  `release/*` or `hotfix/*` branch owns both version files and `CHANGELOG.md`.
  Use `npm version patch --no-git-tag-version` or an explicit version such as
  `npm version 0.2.0 --no-git-tag-version`, then review and commit both files.
  Move release notes from `Unreleased` into the dated version section.
- Never reuse or overwrite a published npm version. Tag a published release
  `vX.Y.Z`, using the exact version in both package files. The current version
  is `0.1.1`; establishing this policy does not change it.

## Publishing to npm (maintainers)

First merge the reviewed `release/*` or `hotfix/*` changes to `main`. Publish
only after that exact version is on a clean, up-to-date `main` and its CI run
has passed:

1. Confirm `npm pkg get name version`, `npm whoami`, and the registry
   (`npm config get registry`). Sign in with `npm login` if needed. Publishing
   requires account two-factor authentication or an authorized granular token;
   do not put credentials in this repository.
2. Run `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`,
   `npm run build`, `npm audit --omit=dev`, `npm pack --dry-run`, and
   `npm publish --dry-run`. Inspect the tarball for secrets, local output, and
   stale documentation; resolve any manifest auto-correction warnings.
3. Check that the exact version is not already on npm with
   `npm view codex-systemone-router@<version> version` (replace `<version>`
   with the version in both package files). For this unscoped public package,
   publish from `main` with `npm publish`. A missing version is expected before
   publication; the publish command is the final name and permission check.
4. Verify the registry entry with `npm view codex-systemone-router version` and
   install that exact version in a disposable directory. Only after
   publication and registry verification succeed, tag that same `main` commit
   as `vX.Y.Z` and push the tag. Record the npm URL and commit in release notes.
   Back-merge release fixes or the hotfix into `develop` through review.

If publication fails, keep the version commit and fix the cause before retrying.
Do not create a release tag for an unpublished version. The npm CLI and current
registry policy are described in the
[npm public-package guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## Pull requests

Before opening a pull request:

- inspect `git diff` and ensure unrelated files are untouched;
- run formatting, strict typecheck, tests, and build;
- include benchmark commands and environment when reporting measurements;
- mention any live backend or network dependency; and
- keep v0.1 scope intact unless the change is required to make the specified
  behavior correct.

Do not commit credentials, backend tokens, task/source text, generated `dist/`,
or local benchmark output unless the repository explicitly asks for it.

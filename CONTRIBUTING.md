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

`main` is the release source. Develop changes on a short-lived branch (for
example `codex/<topic>`), run the standard checks, and integrate the reviewed,
passing change into `main`. Confirm the resulting `main` commit passes CI,
then remove its local and remote topic branch. Never publish an npm version
from an unmerged topic branch or a dirty working tree.

Use semantic versions in both `package.json` and `package-lock.json`. For this
0.x series, increment the patch for compatible fixes and the minor for new
features or breaking changes; reserve 1.0.0 for a stable public contract. npm
does not allow replacing an already published package version, so each release
needs a new version. Prepare a version change on a topic branch with
`npm version patch --no-git-tag-version` or an explicit version such as
`npm version 0.2.0 --no-git-tag-version`. Commit both package files, run CI,
and merge before publishing. The initial 0.1.0 release already has its version
set; do not bump it just to make the first publication.

## Publishing to npm (maintainers)

Publish only after the intended version is on a clean, up-to-date `main` and
its CI run has passed:

1. Confirm `npm pkg get name version`, `npm whoami`, and the registry
   (`npm config get registry`). Sign in with `npm login` if needed. Publishing
   requires account two-factor authentication or an authorized granular token;
   do not put credentials in this repository.
2. Run `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`,
   `npm run build`, `npm audit --omit=dev`, `npm pack --dry-run`, and
   `npm publish --dry-run`. Inspect the tarball for secrets, local output, and
   stale documentation; resolve any manifest auto-correction warnings.
3. Check that the exact version is not already on npm with
   `npm view codex-systemone-router@0.1.0 version` (replace 0.1.0 for later
   releases). For this unscoped public package, publish from `main` with
   `npm publish`. A missing version is expected before the first release; the
   publish command is the final name and permission check.
4. Verify the registry entry with `npm view codex-systemone-router version` and
   install it in a disposable directory. Only after publication succeeds, tag
   that same `main` commit as `v<version>` and push the tag. Record the npm URL
   and commit in release notes.

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

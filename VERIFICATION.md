# v0.1 second-pass verification

Historical routing outputs in this report reflect the pre-0.1.1 model policy.
The 0.1.1 defaults use gpt-6-luna, gpt-6-sol, and gpt-6-astra.

## Scope and requirement checklist

The complete IMPLEMENTATION.md specification and all source, tests, templates,
configuration, benchmark fixtures, package metadata, and documentation were read.
Existing untracked implementation work was preserved. This verification pass
did not change global Codex settings, real user AGENTS.md, the Ollaya
installation, or npm publication. It ran on an isolated branch before
integration into main.

| Area                                                       | Initial state                           | Second-pass disposition                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Backend → normalized decision → score → policy → target    | Implemented, duplicate probability math | Shared pure normalization/scoring; adapter contains no execution-model selection                                                     |
| Four typed choices, endpoint, Kev model, schema validation | Implemented                             | Real requests verified; malformed metadata/probability and HTTP tests expanded                                                       |
| Ordinal score and configurable thresholds                  | Implemented, incomplete edge coverage   | Pure-class, argmax disagreement, boundary and invalid-order tests; floating tolerance edge fixed                                     |
| Safe fallback and JSON stdout                              | Implemented                             | All backend error categories exercised through the CLI; configured and invalid-config fallback documented                            |
| CLI arguments, stdin, help, doctor                         | Partial                                 | Split UTF-8 input fixed; unknown short options rejected; help expanded; unreadable AGENTS diagnostics fail                           |
| Managed AGENTS guidance                                    | Implemented                             | Exact stdin task, returned settings, unavailable-setting behavior and instruction-only limitation clarified                          |
| Installer preservation and idempotency                     | Partial                                 | User newline preservation, dangling backup symlink, invalid UTF-8 and damaged markers fixed; staged replacement and backups          |
| Public JSON contract                                       | Implemented, semantics incomplete       | Stable fields, null metadata, policy-selected difficulty and synthetic fallback values documented                                    |
| Tests and package                                          | Implemented, 39 initial tests           | Expanded regression coverage; actual tarball install/bin/route/install/uninstall smoke test                                          |
| CI                                                         | Missing                                 | Node 22 GitHub Actions install/format/typecheck/test/build/pack workflow using current Node 24 action runtimes                       |
| Release metadata                                           | Partial                                 | Repository/homepage/issues from actual Git remote; packaged specification fixes CONTRIBUTING link; embedded source maps              |
| Simplicity and dependencies                                | Some unnecessary duplication            | Duplicate score/normalizer and unused aliases removed; benchmark stdout interception removed; one runtime dependency (yaml) retained |

The implementation uses snake_case `reasoning_effort` consistently in routing
targets/config/JSON rather than the brief's illustrative camelCase internal field.
This is a deliberate naming choice; it does not change the required behavior.
Fallback values remain compatible with the initial result shape: synthetic high,
score 2, and one-hot high probabilities are explicitly not measured difficulty.
Invalid configuration uses the known built-in fallback because a malformed
configuration cannot be trusted. No required v0.1 feature is intentionally omitted.

## Initial live Ollaya/Kev evidence

Measured locally on macOS arm64, Node v24.19.0, against the default local endpoint
and kev:latest. Four requested task descriptions were run 10 times each,
sequentially, with no fallback. Values below are the first observation for each.
Probabilities are shown in low/medium/high/xhigh order and rounded for display.

| Task                                        | Probabilities                         | Ordinal score | Kev choice | Policy route |
| ------------------------------------------- | ------------------------------------- | ------------- | ---------- | ------------ |
| Local Java variable rename                  | 0.53890 / 0.39760 / 0.03100 / 0.03250 | 0.55710       | low        | low          |
| Optional Spring Boot lastLoginAt            | 0.27070 / 0.62150 / 0.06100 / 0.04680 | 0.88390       | medium     | medium       |
| Retried/redelivered multi-instance payments | 0.08979 / 0.26007 / 0.46325 / 0.18688 | 1.74723       | high       | medium       |
| Ambiguous latency across 200 microservices  | 0.05691 / 0.04420 / 0.54745 / 0.35144 | 2.19342       | high       | high         |

| 40-request measurement        | Average | P50    | P95    | P99    |
| ----------------------------- | ------- | ------ | ------ | ------ |
| Backend-reported duration, ms | 224.69  | 234.51 | 261.21 | 289.32 |
| Observed request duration, ms | 227.69  | 237.11 | 262.94 | 292.13 |

The payment task is just below the initial high lower bound of 1.75. Thresholds
were not tuned to these four examples. Adjacent differences do not fail the
build, and these observations do not establish execution quality or savings.
The historical M4 P50/P95/P99 of about 173/234/249 ms is context, not an SLA.

The separate 24-fixture benchmark completed with 0 fallbacks, 10/24 exact and
20/24 within ±1 agreement between policy routes and heuristic fixture labels.
Observed end-to-end P50/P95/P99 was 424.20/513.33/751.06 ms in that separate run.
These figures are not Kev argmax accuracy and are not the canonical 100-task
benchmark. They expose calibration work still needed before trusting automatic
resource reduction on consequential work.

Raw live distributions and package smoke output are intentionally kept under
ignored benchmark/results/, outside the npm package.

## Final live recheck: backend degraded

After the independent-review fixes, a repeated 40-request check produced 40
request timeouts at the default 2000 ms. No final-run backend latency or
classification results are available. The observed timeout P50/P95/P99 was
2001.52/2006.26/2007.75 ms. An earlier single final recheck also timed out.
The service's read-only version endpoint still answered (0.6.0), and its loaded
model endpoint listed kev:latest; this does not prove inference is responsive.
A separate request with a 15000 ms timeout also returned an exit-0 timeout
fallback. A fresh Codex route call also used `backend_unavailable` fallback. The cause was
not established and the installation/service was not changed.

The final installed package returned parseable exit-0 fallback JSON for task
routing and a diagnostic exit 1 from doctor. Help and temporary install/uninstall
checks still passed. Initial successful measurements above must not be read as
proof that the backend remained healthy at the end of this session.

The repository is ready for controlled fallback testing. Dynamic-routing
dogfooding currently requires Ollaya decision responses to recover; rerun doctor
and confirm fallback:false before evaluating resource selection.

## Node 22 and fresh Codex session

The official Node.js v22.19.0 macOS arm64 archive checksum matched the
published SHASUMS256 entry. Under Node v22.19.0, formatting, strict typecheck,
all 78 tests, build, and `npm pack --dry-run` passed.

An ephemeral `codex exec` v0.147.0 session ran in a disposable Git project with
the package tarball installed and the generated AGENTS block. The first attempt
exposed that a local package's `.bin` directory is not always inherited by a
fresh Codex process; the session correctly reported command-not-found and used
its fallback. The repeat included the fixture's `.bin` path in `PATH`. It routed
the exact task through the installed binary; Ollaya returned
`backend_unavailable`, so JSON selected `gpt-5.6-sol/high`. The session spawned
one child with fresh history and those settings. The child completed the task
and reported the declared runtime dependency `yaml`. No fixture files changed.
The session exited 0. Codex CLI logged stale local model-cache and MCP shutdown
warnings, so this proves the fresh CLI session path, not a clean Desktop UI run.

## Validation and proof boundaries

- Strict type checking includes src, tests, and benchmark code.
- Formatting, strict typecheck, all 78 unit/HTTP/CLI/filesystem tests, build, and
  npm pack --dry-run passed. A clean temporary checkout also passed npm ci,
  typecheck, all 74 tests, and build. No tests were skipped or disabled.
- Packaged executable was installed into a temporary prefix and exercised with
  --help, doctor, argument route, JSON route, stdin route, both dry-runs, repeated
  install, and repeated uninstall. Existing fixture instructions survived.
- npm audit --omit=dev reported zero known runtime vulnerabilities at check time.
- The only runtime dependency is yaml. Node built-ins cover HTTP, CLI parsing,
  files, timers, and logging; replacing YAML with a hand-written parser would
  increase maintenance cost.
- Local verification used Node v24.19.0 and Node v22.19.0. GitHub Actions run
  [36220136033](https://github.com/snowvil/codex-systemone-router/actions/runs/36220136033)
  passed all steps on the verification branch with actions/checkout@v7.0.1,
  actions/setup-node@v7.0.0, and Node 22. GitHub's only remaining annotation
  says ubuntu-latest will migrate to Ubuntu 26 beginning October 19, 2026; it
  does not affect this passing run.
- Global npm link in the user's environment was not run. A fresh ephemeral Codex
  CLI session was run in a disposable project, as described above. A Desktop UI
  session remains a separate proof boundary.
- Independent review returned six actionable findings. All six were evaluated
  and fixed: persistent fixed-name task file guidance, missing host spawn-history
  guidance, silently accepted truncated task input, ordinary prose mistaken for
  markers, overly strict partial-route TypeScript types, and the unused optional
  fallback decision that could produce inconsistent fields.
- Truncated input now returns fallback with reason input_truncated. Optional
  truncation metadata is runtime-validated, consistent with the
  [Ollaya API reference](https://ollaya.dev/docs/api#decide).
- Tests for truncation, marker prose, and partial route types reproduced the
  defects before their fixes. The final suite has 78 passing tests.
- The review itself was routed using its exact task, returning gpt-5.6-sol/high,
  then dispatched with those explicit settings and a fresh-history fork. This
  demonstrates one manually orchestrated route/spawn, not automatic enforcement
  in a fresh user session.
- The independent reviewer rechecked all six fixes and found no remaining
  functional issue. An optional suggestion to assert exact instruction strings
  was not added: text-matching tests do not prove an agent follows the guidance.
  Template parity, schema review, and fresh-session behavioral validation remain
  the explicit evidence boundaries.

## Local dogfooding

From a checkout:

```bash
npm ci
npm run build
npm link
codex-systemone-router doctor
codex-systemone-router route --json "Rename a local variable without changing behavior."
codex-systemone-router install --dry-run
codex-systemone-router install
```

Install in a disposable project first if desired. For custom mapping, export
CODEX_SYSTEMONE_ROUTER_CONFIG to an absolute configuration path before starting
Codex. Start a fresh Codex session and observe Delegate → Route → Spawn using
the identical subtask and returned settings. Check host model availability;
AGENTS instructions cannot guarantee interception or enforce every spawn.

Preview removal with codex-systemone-router uninstall --dry-run; uninstall
removes only the managed block. Backups are retained. Avoid simultaneous edits.

## Develop-based routing reliability feature verification (2026-09-26)

This run starts from `origin/develop` `0fbac7f974353eed4a02981a64ecf3bb5f908344` on `feature/routing-reliability`; application implementation commit: `f40dca0103e3629692391a2d8d460f4a8de95a1b`; latest source/pack-smoke commit validated by hosted CI: `a7fe591ef1a1c7297a8398a86615e88db2144e04`. The result is not integrated. Detailed per-issue state, replay metrics, H05 case hashes, and resume conditions are in [`docs/superpowers/plans/2026-09-26-routing-reliability.md`](docs/superpowers/plans/2026-09-26-routing-reliability.md). The supplied prompt/evidence files remain unmodified and untracked.

### Checks

- `npm test`: 93 passed, 0 failed, 0 skipped. This includes invalid explicit configuration, unreadable config path, empty stdout/no backend request, backend fallback, policy edge cases, template parity, and fixed replay tests.
- `npm run typecheck`, `npm run build`, `npm run replay`, and `git diff --check`: passed.
- Scoped Prettier check over changed project files: passed. The repository-wide `npm run format:check` exits 1 only for the three user-provided untracked inputs `README_START_HERE.md`, `WORK_PROMPT.md`, and `evidence/replay-baseline.json`; these files were not rewritten. The clean-checkout CI command remains `npm run format:check`.
- `npm pack --dry-run --json`: version `0.1.1`, 62 package files; includes the existing `CHANGELOG.md`, compiled CLI/library, template, config example, README, and implementation/contribution docs.
- `npm run pack:smoke`: passed for `0.1.1`; tarball SHA-256 `dfdef86470769ac75f8c3497c0a788cffd4e3783202f88592eee18c91f0fab67`, 62 files. The script installs from its local tarball into a temporary local prefix, not globally.
- Package and lockfile versions remain `0.1.1`. No release, tag, publish, or push to `main`/`develop` was performed. Hosted CI is pending the develop-target PR.

### Replay and interpretation

The source CSV SHA-256 is `44fadbdeb47912333a66ed704c68fe8bd9fd1e276d1a2eb8d3c355281fdc1659`; the checked-in numeric fixture matches. On the same 100 rows, recorded choice scored 61 exact/100 within one, with 28 under, 11 over, and no severe under. Legacy ordinal scored 49 exact/99 within one, with 42 under, 9 over, and 1 severe under; it caused 21 downgrades from recorded choice. The conservative candidate scored 63 exact/100 within one, with 25 under, 12 over, no severe under, and no policy-induced downgrade. Probability argmax matched recorded choice on all rows. The candidate preserved ID 56 as high; the legacy bucket lowered it to medium.

These are comparisons against heuristic manual labels on a fixed dataset whose task text is absent. They do not measure Codex task success, generalization, or cost reduction. Historical backend `eval_ms` averaged 194.068 ms; local replay measured parse/analysis and varied across runs (1.950 ms and 16.134 ms), so those timings are not comparable.

### H05 evidence boundary

The installed local package produced two non-fallback `kev:latest` router decisions: Task B selected `gpt-6-luna/medium`, and a repeat of Task A selected `gpt-6-luna/low`. A first Task A attempt returned fallback `gpt-6-sol/high` after timeout and is not counted as route success. All three attempts are `router_only`; no spawn request or child was observed. The task hashes and artifact hash are recorded in the plan.

The fresh-parent `codex exec --ephemeral` attempt stopped before session startup because Codex CLI `0.147.0` rejected the existing local user configuration (`invalid type: map, expected a boolean in features`). No user configuration/authentication was changed. H05 remains blocked; child target application, child runtime model/effort, and independent task assertions are unknown. Resume only with a fresh parent session that successfully starts under the existing configuration and can collect observable runtime metadata.

### CI and release handoff

The Ubuntu and macOS CI jobs compare the PR's base/head range with `git diff --check`; the macOS job records OS/architecture. The first two hosted runs, [36249019297](https://github.com/snowvil/codex-systemone-router/actions/runs/36249019297) and [36249060348](https://github.com/snowvil/codex-systemone-router/actions/runs/36249060348), passed all earlier steps but failed packaged smoke because a clean runner had no cached `yaml` tarball for the offline temporary install. The smoke now packs the locked, already-installed `yaml` runtime dependency locally and supplies both local tarballs. Local `npm run pack:smoke` passed after the fix. Hosted reruns passed on commit `a7fe591`: [push run 36249442342](https://github.com/snowvil/codex-systemone-router/actions/runs/36249442342) and [PR run 36249446569](https://github.com/snowvil/codex-systemone-router/actions/runs/36249446569); both Ubuntu and macOS jobs are green. The blocker and resolution are recorded on [issue #6](https://github.com/snowvil/codex-systemone-router/issues/6). Latest check status remains visible on [PR #7 checks](https://github.com/snowvil/codex-systemone-router/pull/7/checks). Migration notes are in [`docs/migration/routing-reliability.md`](docs/migration/routing-reliability.md). Release review owns the conservative-default decision, additive JSON/doctor contract review, exit-code migration guidance, Unreleased changelog promotion, synchronized version update, and MINOR-version assessment under the repository's 0.x policy.

## H05 historical Desktop-parent follow-up (2026-09-27)

This subsection records the evidence available at that point; the later active-project follow-up below supersedes its current-status statements. The renewed Desktop parent followed the managed-block instructions supplied in the task context, inspected the block installed in a disposable Git project, and used the `0.1.1` local tarball there (source SHA `484399db3c5854a2fb137dff87dff691a002f1a0`, tarball SHA-256 `dfdef86470769ac75f8c3497c0a788cffd4e3783202f88592eee18c91f0fab67`) for routing. This was not a separate `codex exec` parent launched with the temporary project as its active context. The installed managed block was present. `codex-systemone-router doctor --agents-path AGENTS.md` passed runtime/config/policy and returned a typed `kev:latest` response; its Codex instruction loading and child-runtime settings remained explicitly unverified.

| Case                                                                                   | Router target                      | Spawn request                                                    | Result assertion                                                                                                             | Evidence level                              |
| -------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| H05-A, task SHA-256 `69a6403a04369f57fd136fcc4b71476b8b9ceb87e0e522c99d1c4872d39dbbad` | `fallback:false`, `gpt-6-luna/low` | `spawn_agent` requested `gpt-6-luna/low` with the identical task | Exact result bytes `31 30 30 0a`; sum 100                                                                                    | `spawn_requested`; runtime settings unknown |
| H05-C, task SHA-256 `c30d9159289ce22f56081aac08b59d55ad3cb42701600ecdf4d0bd4cbd154888` | `fallback:false`, `gpt-6-sol/high` | `spawn_agent` requested `gpt-6-sol/high` with the identical task | Nine parent-side checks passed on the report contents; the six described regression cases were not executed as payment tests | `spawn_requested`; runtime settings unknown |

An additional non-fallback route-only probe (task SHA-256 `8027ecce4e3a80b6fe96daf8724d221f33bc4f759d511e0006448d2efe7449e4`) selected `gpt-6-luna/medium`; no child was requested for that probe. The two executed tasks requested distinct model/effort pairs, and their independent output assertions passed. The host's `list_agents` output exposed only names/status, so neither effective child model nor effort was observed. Spawn arguments and task quality are not runtime metadata; no case reached `runtime_observed`.

Environment for the original follow-up: macOS `26.6.2` arm64; shell Node `v24.19.0`; Codex CLI `0.147.0`; packaged doctor Node `v26.8.1`. The initial plain `codex exec --ephemeral` attempt failed before startup with `invalid type: map, expected a boolean in features`. No user config, authentication, or global installation was changed. This CLI error is separate from the successful Desktop route/spawn requests.

## H05 renewed Desktop and active-project CLI follow-up (2026-09-27)

The current Desktop root task routed through the installed package in the disposable project, but its own active workspace remained the repository checkout. Collaboration children inherited that repository directory; the H05-E report was moved to the disposable project after parent-side checks. These cases add route/spawn evidence but do not make this Desktop parent an active-project parent.

| Case  | Task SHA-256                                                       | Router result                                                                                                                                                         | Spawn request                                                     | Task assertion                                                                                                                         | Evidence                                           |
| ----- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| H05-D | `03fd7585cc7e43a915ec0dc87ab97a5863e6f7c7fb5f114c2ad998dfce587cac` | Initial identical attempt timed out with fallback and was excluded. Retry returned `fallback:false`, `gpt-6-luna/low`, backend `ollaya`, decision model `kev:latest`. | Host spawn schema received `gpt-6-luna/low` and the same task.    | `31 + 7 + 26 + 13 + 23 = 100`; output bytes `31 30 30 0a`.                                                                             | `spawn_requested`; child runtime settings unknown. |
| H05-E | `e95139b86c51c44898274f3737305436d0ab6171f6d765b2df6362b899d8805a` | `fallback:false`, `gpt-6-luna/medium`, backend `ollaya`, decision model `kev:latest`, 1099.658 ms.                                                                    | Host spawn schema received `gpt-6-luna/medium` and the same task. | Nine parent-side content checks passed for the report; it described exactly six regression cases, which were not run as payment tests. | `spawn_requested`; child runtime settings unknown. |

The H05-D result artifact SHA-256 is `eea8254c7500ba3de996aa8ad6af399183f04e17d4a8102fde539dbc93a90012`; the H05-E report artifact SHA-256 is `cdd69e7401231845add779fb90993ae6c3e36fbf5638b05712b771f6f06147e4`. The nine H05-E content checks covered six numbered scenarios, duplicate-key retry, distinct-key race, both crash windows, stale update, failed charge, the cross-system atomicity limit, compensation, and reconciliation.

H05-D's first router attempt timed out and did not spawn a child; only its identical non-fallback retry is counted. H05-D and H05-E changed effort while retaining `gpt-6-luna`. Earlier H05-A/H05-C requests changed both model and effort, but the host never exposed their effective settings. No source or version files changed.

A separate ephemeral Codex CLI parent was started with the disposable project as its active directory and an explicit read-only sandbox. A plain launch failed on the existing config parse error; one-shot replacements for `features` failed with schema type errors. The successful launch used the supported `--ignore-user-config` option without changing user config or authentication files. It emitted a model-cache warning about missing `supports_parallel_tool_calls`, then issued two route-only calls. Both returned `fallback:true`, reason `backend_unavailable`, with the safe fallback `gpt-6-sol/high`; no child was requested and no assertions ran. This attempt is `router_only`. The CLI event stream did not provide a direct receipt that the installed managed block was loaded, and this CLI result is not Desktop spawn evidence.

No available host surface reports the effective model or reasoning effort for a collaboration child. `spawn_agent` accepts requested overrides; `list_agents` exposes only name/status. Cases A, C, D, and E remain `spawn_requested`, not `runtime_observed`. H05 stays partial/blocked; issue #5 remains open and PR #7 remains draft.

# Routing reliability & evidence — execution status

- Date: 2026-09-26
- Repository: `snowvil/codex-systemone-router`
- Base: `origin/develop` at `0fbac7f974353eed4a02981a64ecf3bb5f908344`
- Branch: `feature/routing-reliability`
- Milestone: [Routing reliability & evidence](https://github.com/snowvil/codex-systemone-router/milestone/1)
- PR: [#7](https://github.com/snowvil/codex-systemone-router/pull/7), draft with base `develop`.

## Issue status

| Key     | Issue                                                            | Implementation and validation                                                                                                                                          | Current state                                                                                                                                              |
| ------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1R-H01 | [#1](https://github.com/snowvil/codex-systemone-router/issues/1) | Checked-in CSV replay, parser validation, fixed expectations, offline tests, and independent Python recomputation.                                                     | Implemented; local validation passed; PR #7 draft; integration pending.                                                                                    |
| S1R-H02 | [#2](https://github.com/snowvil/codex-systemone-router/issues/2) | Conservative, ordinal, and argmax strategies; historical replay comparison; disagreement diagnostics and downgrade/tie tests.                                          | Implemented; local validation passed; PR #7 draft; integration pending.                                                                                    |
| S1R-H03 | [#3](https://github.com/snowvil/codex-systemone-router/issues/3) | Explicit config/policy failures exit 2 with redacted stderr, empty stdout, and no backend request; valid backend failures retain fallback.                             | Implemented; regression tests pass; PR #7 draft; integration pending.                                                                                      |
| S1R-H04 | [#4](https://github.com/snowvil/codex-systemone-router/issues/4) | Portable source/distributed template parity and doctor evidence-level reporting.                                                                                       | Implemented; local validation passed; PR #7 draft; integration pending.                                                                                    |
| S1R-H05 | [#5](https://github.com/snowvil/codex-systemone-router/issues/5) | Installed tarball and bounded live routing probes completed; the fresh-parent route-to-spawn run could not start because the local Codex CLI rejected its user config. | **Blocked** at `router_only`; no spawn requested and no child runtime observed. Resume after the local CLI can start with its existing user configuration. |
| S1R-H06 | [#6](https://github.com/snowvil/codex-systemone-router/issues/6) | Local tarball smoke passes. Initial hosted Ubuntu/macOS runs exposed a missing offline runtime dependency cache; smoke now supplies a local `yaml` tarball.            | Implemented; local and hosted validation passed on `a7fe591`; PR #7 draft; integration pending.                                                            |

Issues and milestone remain open. Implementation, local validation, hosted CI, develop integration, and release are tracked as separate states. The PR will reference the issues without automatic closing keywords and will be draft while H05 is blocked.

## Replay comparison

Source fixture: `benchmark/fixtures/kev-benchmark-20260926-083316.csv`, SHA-256 `44fadbdeb47912333a66ed704c68fe8bd9fd1e276d1a2eb8d3c355281fdc1659`. It has 100 unique rows with manual-label counts low/medium/high/xhigh of 25/30/30/15. Task text is absent; model digest and original runtime are unknown.

| Policy on the same 100 rows    | Exact | Within one | Under | Over | Severe under | Policy-induced downgrade | Target distribution low/medium/high/xhigh |
| ------------------------------ | ----: | ---------: | ----: | ---: | -----------: | -----------------------: | ----------------------------------------- |
| Recorded backend choice        |    61 |        100 |    28 |   11 |            0 |                        0 | 20/42/38/0                                |
| Probability argmax             |    61 |        100 |    28 |   11 |            0 |                        0 | 20/42/38/0                                |
| Legacy ordinal thresholds      |    49 |         99 |    42 |    9 |            1 |                       21 | 24/51/25/0                                |
| Conservative candidate/default |    63 |        100 |    25 |   12 |            0 |                        0 | 16/46/38/0                                |

The default is the higher ordinal result of the backend-declared choice and the legacy score bucket. It preserves the ID 56 high declaration that the legacy bucket would lower to medium. These are same-sample agreement and downgrade checks against heuristic manual labels, not Codex task success, generalization, or cost savings. Probability argmax matched the recorded choice on all 100 rows. Historical `eval_ms` averaged 194.068 ms; local replay runs took 1.950 ms in an earlier run and 16.134 ms in the final run, measuring parse/analysis rather than backend inference.

## H05 bounded evidence and blocker

The temporary install used a local `0.1.1` tarball (SHA-256 `dfdef86470769ac75f8c3497c0a788cffd4e3783202f88592eee18c91f0fab67`) and a disposable project. The managed block was installed there. The same tarball SHA was reproduced by the final packaged smoke at source commit `a7fe591ef1a1c7297a8398a86615e88db2144e04`. The live attempts ran before that commit, from an uncommitted feature tree based on `0fbac7f974353eed4a02981a64ecf3bb5f908344`; the reproduced tarball hash confirms identical packaged bytes after commit. Common identifiers: package `0.1.1`; policy `conservative`; configuration `package-defaults`; prompt IDs `H05-A` and `H05-B`; backend tag `kev:latest`, backend digest `unknown`. Task text is not retained; only UTF-8 SHA-256 values are recorded.

| Case                     | Prompt ID | Task hash                                                          | Router result                                                           | Spawn request | Child runtime and assertions                  | Evidence level                                                         |
| ------------------------ | --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| A, first bounded attempt | `H05-A`   | `a1523948e3d0af72293419580ee0a5ad69d5d3505bec710e09a2ecfce854e3a3` | Fallback, `gpt-6-sol/high`; timeout, not a routing success.             | None.         | No child; no assertions.                      | `router_only` (fallback only; excluded from successful-route evidence) |
| B, bounded attempt       | `H05-B`   | `8b027e27f88c489ebadbbdd2b95b9d9202399cc7d7492498152aba046426b83f` | `fallback:false`, backend tag `kev:latest`, target `gpt-6-luna/medium`. | None.         | No child; no observed settings or assertions. | `router_only`                                                          |
| A, repeat                | `H05-A`   | `a1523948e3d0af72293419580ee0a5ad69d5d3505bec710e09a2ecfce854e3a3` | `fallback:false`, backend tag `kev:latest`, target `gpt-6-luna/low`.    | None.         | No child; no observed settings or assertions. | `router_only`                                                          |

This shows two non-fallback router targets with the same model and different effort values. It does not verify model switching or child settings. The observed host was macOS 26.6.2 arm64, Node `v24.19.0`, and Codex CLI `0.147.0`. A fresh `codex exec --ephemeral` parent attempt exited before session startup because the existing user Codex configuration failed to parse (`invalid type: map, expected a boolean in features`). No configuration, authentication, or global installation was changed. The parent never reached the installed instructions, so `spawn_requested` is false and `runtime_observed` is unknown. The host error blocks H05; no child-run assertion can be claimed.

Resume H05 when the local Codex CLI can start without changing this feature's safety boundaries. Use a fresh parent session, the installed tarball, and the exact routed task payload; collect a supported spawn request, at least two distinct child target combinations, observable child model/effort metadata, and independent task assertions. If runtime metadata remains unavailable, report the achieved evidence level and keep the issue open.

## Release handoff

See [routing reliability migration notes](../../migration/routing-reliability.md). Release review must decide the new default policy and additive JSON/doctor contract, assess a MINOR change under the repository's 0.x policy, update the existing Unreleased changelog and synchronized versions on a release branch, and provide upgrade guidance for exit-code changes. This feature does not bump package versions, edit the historical changelog, publish, tag, or release.

## Local verification

The completed run and proof boundaries are appended to [`VERIFICATION.md`](../../../VERIFICATION.md). Local format checking reports only the untouched user-provided untracked prompt/evidence files; the tracked project files are checked separately. The first hosted runs failed because the offline cache lacked `yaml`; the fix and green rerun are recorded on [issue #6](https://github.com/snowvil/codex-systemone-router/issues/6). Both [hosted jobs](https://github.com/snowvil/codex-systemone-router/actions/runs/36249446569) passed on `a7fe591`; current status remains visible on [PR #7 checks](https://github.com/snowvil/codex-systemone-router/pull/7/checks).

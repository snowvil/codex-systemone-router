# Routing reliability 0.2.0 migration notes

These notes describe the proposed behavior changes for the `0.2.0` release
candidate. The package version is synchronized in `package.json` and
`package-lock.json` on the `release/0.2.0` branch.

## Behavior and configuration

- The default policy changes from score-only `ordinal` to `conservative`, which
  selects the higher ordinal value of the configured score bucket and the
  backend-declared choice. This prevents a high or xhigh declaration from being
  silently lowered by mean-score bucketing.
- Existing installations that need the previous route selection can set
  `policy.strategy: ordinal` in YAML or
  `CODEX_SYSTEMONE_ROUTER_POLICY_STRATEGY=ordinal`. `argmax` is also available
  as an explicit strategy; ties choose the lower ordinal difficulty.
- Route JSON adds `policy`, `declared_choice`, `probability_argmax`, and
  `choice_argmax_disagreement`. These fields are additive. Their values are
  null for fallback results because the fallback decision is synthetic.
- Invalid or unreadable explicit config, invalid policy, or invalid route
  overrides now exit 2 with stderr diagnostics and no successful-looking
  fallback JSON. A valid config followed by an expected backend failure still
  exits 0 with `fallback: true`. Unexpected internal errors exit 1.
- `doctor` output now separates runtime, configuration, policy, backend typed
  response, and managed-block state. It explicitly reports that actual Codex
  instruction loading and child runtime settings are unverified.
- The managed AGENTS instructions require identical router input and child
  task text, prevent child re-delegation unless authorized, and do not guess a
  target after a failed router command. They remain instruction-driven and do
  not hard-code this repository's Gitflow into user projects.

## Release decision

This pre-1.0 feature and CLI behavior change is proposed as a MINOR version.
The `conservative` default is retained to prevent the score bucket from silently
lowering a backend-declared high or xhigh choice. This is a policy choice, not
evidence that Codex task success or cost improved. Installations that need the
previous score-only behavior can select `ordinal` explicitly.

Route JSON fields are additive; consumers should tolerate unknown keys. Scripts
that relied on invalid configuration exiting successfully with a fallback
route must handle exit status 2. A backend failure after valid configuration
continues to produce the configured fallback with exit status 0.

The Codex host still does not expose effective child model or reasoning-effort
metadata, and the fresh active-project CLI probe did not spawn a child. Issue #5
remains open; no runtime model or effort application is claimed by this release.

The 100-row offline replay contains heuristic manual difficulty labels without
task text. Its comparison is a fixed-dataset sanity check, not Codex task
success, generalization, or cost evidence. Release evaluation should use
independent task families and completed-work assertions before making quality
or savings claims.

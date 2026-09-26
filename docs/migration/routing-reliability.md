# Routing reliability feature migration notes

These notes are for the later `release/*` review. This feature branch keeps
`package.json` and `package-lock.json` at `0.1.1`; it does not choose a release
version, update `CHANGELOG.md`, publish, or create a tag.

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

## Release review

Because this is a pre-1.0 default behavior and CLI contract change, the release
owner should review it as a MINOR change under the repository's version policy.
The release owner should decide whether to keep `conservative` as the default,
review the added JSON keys and doctor output, move an approved summary into the
existing `CHANGELOG.md` Unreleased section, synchronize package version files,
and verify upgrade instructions. Do not reuse the feature tarball's `0.1.1`
version as a published release.

The 100-row offline replay contains heuristic manual difficulty labels without
task text. Its comparison is a fixed-dataset sanity check, not Codex task
success, generalization, or cost evidence. Release evaluation should use
independent task families and completed-work assertions before making quality
or savings claims.

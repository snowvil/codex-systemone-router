# Changelog

All notable changes to this project are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-11

### Added

- Added Claude Code as a routing host. `route --host codex|claude|auto`
  selects the target vocabulary; `claude` targets are Claude Code `Agent` tool
  model aliases (`haiku`, `sonnet`, `opus`, `fable`) plus `effort`, with
  defaults low → `haiku`/low, medium → `sonnet`/medium, high → `opus`/high,
  xhigh → `opus`/xhigh, and fallback `opus`/high. The JSON result reports
  `host`.
- Added host auto-detection: `CODEX_SYSTEMONE_ROUTER_HOST`, then Claude Code's
  documented `CLAUDECODE=1` subprocess marker, then the Codex default.
- Added `policy.hosts.<codex|claude>.{routes,fallback}` configuration with
  matching `CODEX_SYSTEMONE_ROUTER_POLICY_HOSTS_*` environment overrides.
  `policy.routes` / `policy.fallback` remain a shorthand for `hosts.codex`, so
  existing configuration files keep working.
- Added `install --global` / `uninstall --global`, which manage the block in
  `$CODEX_HOME/AGENTS.md` and `$CLAUDE_CONFIG_DIR/CLAUDE.md` (defaults
  `~/.codex`, `~/.claude`) in one step, and `--host codex|claude|all` for
  project or global installs. `doctor` gained `--host`, `--global`, and
  per-host target reporting.

### Changed

- Rewrote the managed instruction block to be host-neutral: the agent passes
  its own host name to `route --host`, and the block explains how Codex and
  Claude Code each apply the returned model and effort. Reinstall to update
  existing files (`doctor` reports "template update available").

## [0.2.1] - 2026-09-30

### Changed

- Changed the built-in high and fallback targets to `gpt-6.1-sol` while
  retaining high reasoning effort. Low, medium, and xhigh mappings are
  unchanged.
- Documented the limits of the available evidence for effective child model
  and reasoning-effort settings.

## [0.2.0] - 2026-09-27

### Added

- Added an offline replay for the fixed 100-row benchmark and packaged-install
  smoke checks with Linux and macOS CI coverage.
- Added configurable `conservative`, `ordinal`, and `argmax` routing policies.

### Changed

- Changed the default policy to `conservative`, which selects the higher
  ordinal class of the backend-declared choice and score bucket. Set
  `policy.strategy: ordinal` or `CODEX_SYSTEMONE_ROUTER_POLICY_STRATEGY=ordinal`
  to retain score-only routing.
- Added policy, backend-declared choice, probability argmax, and disagreement
  fields to route JSON. Consumers should ignore unrecognized fields.
- Invalid or unreadable explicit configuration now exits with status 2 without
  returning a fallback route. Expected backend failures with valid
  configuration still return the configured fallback with status 0; unexpected
  internal errors exit with status 1.
- Updated `doctor` to report configuration, policy, backend response, managed
  block presence, and unverified Codex instruction/runtime evidence separately.
- Clarified managed delegation instructions, including identical task routing
  and following each target repository's own policies.

### Evidence limitations

- The offline benchmark uses heuristic manual difficulty labels. Its agreement
  results are not Codex task-success or cost measurements.
- The Codex host does not expose effective child model and reasoning-effort
  settings. Issue #5 remains open; this release does not claim those settings
  were observed or verified.

## [0.1.1] - 2026-09-26

### Changed

- Switched default routing targets and fallback from GPT-5.6 to GPT-6 models.
  Updated the configuration example, documentation, managed agent template,
  and routing tests to match.

[Unreleased]: https://github.com/snowvil/codex-systemone-router/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/snowvil/codex-systemone-router/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/snowvil/codex-systemone-router/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/snowvil/codex-systemone-router/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/snowvil/codex-systemone-router/compare/v0.1.0...v0.1.1

# codex-systemone-router

`codex-systemone-router` is a small, local-first control-plane utility for
choosing a subagent model and reasoning effort before delegation. It asks a
local System-1 decision backend (v0.1 uses Ollaya with `kev:latest`), turns the
returned difficulty probabilities into an ordinal score, and applies a
deterministic, configurable routing policy.

The difficulty estimate is shared; the model vocabulary is per host. The same
decision yields a Codex model slug for Codex (`--host codex`) and an Agent tool
model alias plus effort for Claude Code (`--host claude`). One global install
of the managed instruction block lets each host pick its own targets.

The router makes a decision; it does not perform the delegated work.

Maintainers: see [Contributing: branches, versions, and npm publishing](CONTRIBUTING.md#branches-and-versions)
for the complete Gitflow, version, and release procedure. Release changes are
recorded in [CHANGELOG.md](CHANGELOG.md).

## v0.1 status and boundaries

The integration is instruction-driven through `AGENTS.md` (Codex) and
`CLAUDE.md` (Claude Code). The managed instructions tell the main agent to
describe each independent subtask, route that description with its own host
name, and pass the returned model and reasoning effort to the subagent.
Neither file can technically intercept or enforce a Codex `spawn_agent` call
or a Claude Code `Agent` tool call, and this project does not claim to do so.

There is no transparent subagent proxy, main-agent interception, daemon,
telemetry service, dashboard, hosted decision service, OpenAI API proxy, or
automatic failure escalation in v0.1. The router never executes commands
returned by a backend and does not bind a server port.

## Quick start: connect it to Codex and Claude Code

For a published release, install the package from npm as shown below. If the
npm release is unavailable, use the source checkout instead. You need Node.js
22 or newer and a local Codex and/or Claude Code installation with subagents
available. Ollaya and `kev:latest` are required for live decisions; without
them, the router returns its safe fallback.

1. Install the executable:

   ```bash
   npm install --global codex-systemone-router
   command -v codex-systemone-router
   codex-systemone-router --help
   ```

   To install the current source checkout instead:

   ```bash
   git clone https://github.com/snowvil/codex-systemone-router.git
   cd codex-systemone-router
   npm ci
   npm run build
   npm link
   command -v codex-systemone-router
   codex-systemone-router --help
   ```

   Global installation (or `npm link` for a source checkout) makes the command
   available through npm's executable directory. The `command -v` line must
   resolve in the environment that launches Codex or Claude Code. If it does
   not, add that directory to `PATH` and start a new host process. An already
   running desktop app may retain its old `PATH`.

2. Install the managed instructions **once, globally**, for both hosts:

   ```bash
   codex-systemone-router install --global --dry-run
   codex-systemone-router install --global
   codex-systemone-router doctor --global
   codex-systemone-router route --json --host codex \
     "Review the parser error handling and report two concrete risks."
   codex-systemone-router route --json --host claude \
     "Review the parser error handling and report two concrete risks."
   ```

   `install --global` writes the same host-neutral block into
   `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`), which Codex reads in
   every project, and into `$CLAUDE_CONFIG_DIR/CLAUDE.md` (default
   `~/.claude/CLAUDE.md`), Claude Code's user-level memory file that is also
   read in every project. Existing content is preserved; missing directories
   are created. Add `--host codex` or `--host claude` to install only one.

   `doctor` checks Node.js, resolved config and policy, the host it would
   select, each host's targets, a real typed backend response, and the managed
   block in both global files. It also states that instruction loading and
   child runtime settings are unverified. If Ollaya is unavailable, `doctor`
   exits with status 1; `route` still emits JSON with `fallback: true` and a
   safe target. A successful decision has `fallback: false`.

   To install per project instead, run `codex-systemone-router install` in the
   repository (writes `AGENTS.md`), `install --host claude` (writes
   `CLAUDE.md`), or `install --host all` for both, and check with
   `doctor --agents-path <file>`.

3. Start a **new Codex or Claude Code session** and give it an independently
   delegatable task, for example:

   > Use one subagent to review the parser's error handling. Report the
   > router-selected model and reasoning effort, whether it used fallback, and
   > the concrete risks the subagent found.

   Inspect the session for `codex-systemone-router route --stdin --json
--host codex` (Codex) or `--host claude` (Claude Code) followed by a
   subagent spawn using the returned settings and the same task description.
   In Codex the result is passed as the subagent's model and reasoning effort;
   in Claude Code it is passed as the `Agent` tool's `model` and `effort`
   parameters. The installed block asks each host to follow this sequence; it
   is guidance, not a technical hook into the spawn tool. The host must be able
   to run the executable and support the selected model and effort. See the
   [Codex AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
   the [Codex subagents guide](https://learn.chatgpt.com/docs/agent-configuration/subagents),
   and the Claude Code [memory](https://code.claude.com/docs/en/memory) and
   [subagents](https://code.claude.com/docs/en/sub-agents) docs.

### How each host finds its targets

- `route --host codex` uses `policy.hosts.codex` (also written as the
  `policy.routes` / `policy.fallback` shorthand). Models are Codex slugs such
  as `gpt-6.1-sol`.
- `route --host claude` uses `policy.hosts.claude`. Models are Claude Code
  Agent tool aliases (`haiku`, `sonnet`, `opus`, `fable`) or full model IDs,
  and `reasoning_effort` is the Agent tool's `effort`. Defaults: low →
  `haiku`/low, medium → `sonnet`/medium, high → `opus`/high, xhigh →
  `opus`/xhigh, fallback `opus`/high.
- Without `--host` (or with `--host auto`) the router uses
  `CODEX_SYSTEMONE_ROUTER_HOST` when set, otherwise selects `claude` when
  Claude Code's documented `CLAUDECODE=1` subprocess marker is present, and
  otherwise `codex`. The installed block still passes `--host` explicitly, so
  the host name never depends on detection. The JSON result reports `host`.

### Instruction file notes

Codex loads `AGENTS.override.md` before `AGENTS.md` in the same directory. If
either the project or Codex home already has an override file, install into
that file with `--path` and pass the same path to `doctor --agents-path`;
otherwise Codex will read the override instead of the managed `AGENTS.md`.
Project guidance is read alongside global guidance, with files nearer the
working directory taking precedence.

Claude Code reads `~/.claude/CLAUDE.md` in every project together with the
project's `CLAUDE.md` files. By default it reads a project `AGENTS.md` only
when the project tree has no `CLAUDE.md`; a `CLAUDE.md` can also import one
with a line containing `@AGENTS.md`. Whether `CLAUDE_CONFIG_DIR` relocates the
user `CLAUDE.md` is not stated in Claude Code's documentation; the installer
follows the variable because Claude Code stores its other home files there,
and `--path` overrides the location if your build differs.

Install in one scope unless you deliberately want the instructions in both.

## Architecture

```text
task description                      host (--host, env, CLAUDECODE, default)
      |                                          |
      v                                          |
backend adapter (Ollaya HTTP API)                |
      |                                          |
      v                                          |
validated DifficultyDecision                     |
      |                                          |
      v                                          |
ordinal score: 0*P(low) + 1*P(medium) + 2*P(high) + 3*P(xhigh)
      |                                          |
      v                                          v
configured difficulty policy  --->  per-host target table (policy.hosts.<host>)
      |
      v
host + model + reasoning_effort (+ fallback metadata)
```

Backend details stay behind an adapter. Policy code consumes normalized
decisions, so a future native Kev, Laya, Jev, or custom HTTP adapter can be
added without spreading Ollaya-specific response types through the project.
Probabilities, score, backend-declared choice, and probability argmax are
retained for inspection. The default conservative strategy selects the higher
ordinal class of the configured score bucket and declared choice; legacy
ordinal and probability argmax are explicit alternatives. None of these
strategies establishes the model or effort a host will actually run.

## Prerequisites

- Node.js 22 or newer.
- A Codex setup that can delegate independent work and accept explicit model /
  reasoning overrides, and/or a Claude Code installation whose `Agent` tool
  accepts `model` and `effort`. Availability depends on your host and account;
  configure the mapping to supported models. This router cannot check host
  entitlements.
- A local Ollaya-compatible decision endpoint. The default is
  `http://127.0.0.1:11435/api/decide`.
- The `kev:latest` decision model available to that endpoint, unless a
  configured model is used instead.

Ollaya and Kev are optional for a smoke test because routing degrades to a
configured capable fallback when the backend is unavailable. That fallback is
not evidence that the local decision model ran.

## Route a task

Pass a complete, self-contained task description. Do not pass placeholders such
as `fix it` or `continue previous work`; the description is the only context a
subagent is guaranteed to receive.

```bash
codex-systemone-router route \
  "Investigate duplicate payment records on retry, fix the concurrency issue, and add a regression test."

codex-systemone-router route --json \
  "Review the parser error handling and add focused tests."

printf '%s\n' "Trace the cache invalidation race across the worker and API." \
  | codex-systemone-router route --stdin --json
```

The command accepts one positional task; `--stdin` reads the task from
standard input instead. `--host codex|claude|auto` selects the target
vocabulary (see above). Route-level overrides are `--config PATH`,
`--backend-url URL`, `--backend-model MODEL`, `--timeout-ms MS`,
`--fallback-model MODEL`, and `--fallback-reasoning-effort low|medium|high|xhigh`;
the fallback overrides apply to the selected host.

JSON output contains the policy-selected difficulty, policy name, host, ordinal score,
target model and reasoning effort, normalized probabilities, backend metadata,
latency, and `fallback`. It also includes `declared_choice`,
`probability_argmax`, and `choice_argmax_disagreement` so disagreements stay
visible. Human-readable warnings go to stderr so JSON stdout remains
machine-parseable. A fallback result has `fallback: true` and a machine-readable
reason such as `backend_unavailable`, `timeout`, `malformed_response`,
`invalid_probabilities`, or `input_truncated`.

The JSON keys are `policy`, `host`, `difficulty`, `score`, `model`, `reasoning_effort`,
`declared_choice`, `probability_argmax`, `choice_argmax_disagreement`,
`probabilities`, `backend`, `decision_model`, `latency_ms`, `fallback`, and `reason`.
`reason` is null on success. `latency_ms` is Ollaya's `total_duration` converted
from nanoseconds, or observed request time when that field is absent. On fallback,
`backend` is `fallback`, `decision_model` and `latency_ms` are null; the high
bucket, score 2, and one-hot high probabilities are synthetic placeholders,
**not a measured estimate**. Always check `fallback` before using these as data.
The choice and argmax fields are null on fallback because its decision fields
are synthetic.

Explicit config-file, environment, and policy validation errors exit 2 with
diagnostics on stderr and no route JSON. An unexpected internal failure exits 1
without being misreported as a backend fallback.

The decision model's four choices are ordered `low`, `medium`, `high`, and
`xhigh`. The score is in the inclusive range 0..3. The initial thresholds are
heuristics and are configurable; they are not a calibration claim.

## Configuration

Copy `config.example.yaml` and pass it with `--config PATH`, or set
`CODEX_SYSTEMONE_ROUTER_CONFIG`. No config file is discovered automatically. The configuration contains backend
settings and a routing policy:

```yaml
backend:
  type: ollaya
  url: http://127.0.0.1:11435/api/decide
  model: kev:latest
  timeout_ms: 2000
policy:
  strategy: conservative
  thresholds:
    medium: 0.75
    high: 1.75
    xhigh: 2.55
  routes: # Codex targets; shorthand for hosts.codex.routes
    low: { model: gpt-6-luna, reasoning_effort: low }
    medium: { model: gpt-6-luna, reasoning_effort: medium }
    high: { model: gpt-6.1-sol, reasoning_effort: high }
    xhigh: { model: gpt-6-astra, reasoning_effort: xhigh }
  fallback: { model: gpt-6.1-sol, reasoning_effort: high }
  hosts:
    claude: # Claude Code targets: Agent tool model alias or full ID + effort
      routes:
        low: { model: haiku, reasoning_effort: low }
        medium: { model: sonnet, reasoning_effort: medium }
        high: { model: opus, reasoning_effort: high }
        xhigh: { model: opus, reasoning_effort: xhigh }
      fallback: { model: opus, reasoning_effort: high }
```

`policy.hosts.<host>` holds the per-host `routes` and `fallback`; `codex` and
`claude` are the supported hosts. `policy.routes` and `policy.fallback` are a
shorthand for `hosts.codex`, so existing configuration files keep working and
receive the Claude Code defaults automatically. Within one source an explicit
`hosts.codex` entry wins over the shorthand. Partial host entries are merged
over the built-in defaults, so you can change only `hosts.claude.routes.xhigh`
(for example to `fable`) and keep the rest.

`strategy` accepts `conservative`, `ordinal`, or `argmax`. The default
`conservative` strategy chooses the more difficult class between the ordinal
score bucket and the backend-declared choice; a high/xhigh declaration therefore
cannot be silently lowered by mean-score bucketing. `ordinal` reproduces the
legacy score-only policy. `argmax` selects the largest probability, with ties
resolved toward the lower ordinal class. All three keep the raw probabilities
and score visible. Default score buckets use inclusive lower bounds: low [0,
0.75), medium [0.75, 1.75), high [1.75, 2.55), xhigh [2.55, 3]. These initial
heuristics are not fitted claims about Codex task success. Thresholds must
strictly increase within 0..3. All probabilities must be finite values in [0,
1]; sums within 0.01 of 1 are normalized, larger deviations are rejected.

Recognized environment overrides use the `CODEX_SYSTEMONE_ROUTER_` prefix:
`BACKEND_TYPE`, `BACKEND_URL`, `BACKEND_MODEL`, `BACKEND_TIMEOUT_MS`,
`POLICY_STRATEGY`, `POLICY_THRESHOLDS_MEDIUM|HIGH|XHIGH`,
`POLICY_ROUTES_<DIFFICULTY>_MODEL`,
`POLICY_ROUTES_<DIFFICULTY>_REASONING_EFFORT`,
`POLICY_FALLBACK_MODEL`, and `POLICY_FALLBACK_REASONING_EFFORT` (all Codex
shorthand), plus per-host `POLICY_HOSTS_<CODEX|CLAUDE>_ROUTES_<DIFFICULTY>_MODEL`,
`POLICY_HOSTS_<CODEX|CLAUDE>_ROUTES_<DIFFICULTY>_REASONING_EFFORT`,
`POLICY_HOSTS_<CODEX|CLAUDE>_FALLBACK_MODEL`, and
`POLICY_HOSTS_<CODEX|CLAUDE>_FALLBACK_REASONING_EFFORT`. Singular
`POLICY_THRESHOLD_*`, `POLICY_ROUTE_*_*`, `TIMEOUT_MS`, `FALLBACK_MODEL`, and
`FALLBACK_REASONING_EFFORT` aliases are also accepted for compatibility.
`CODEX_SYSTEMONE_ROUTER_HOST=codex|claude|auto` pins the host when `--host` is
omitted; it is not part of the configuration file.

Where multiple sources are supplied, precedence is deterministic:

```text
CLI override > environment > config file > built-in defaults
```

Keep task text out of shell interpolation. The CLI sends it only to the
configured decision backend; it does not send it to an analytics service.

## AGENTS.md / CLAUDE.md integration

Install the managed block in the relevant instruction file. Without flags the
target is `AGENTS.md` in the current directory; `--host claude` targets
`CLAUDE.md`, `--host all` both; `--global` targets the Codex home and Claude
Code config directory files for both hosts (or one with `--host`); `--path`
selects an arbitrary file. Preview first when working in an existing
repository, and preview removal before uninstalling:

```bash
codex-systemone-router install --global --dry-run
codex-systemone-router install --global
codex-systemone-router uninstall --global --dry-run
codex-systemone-router uninstall --global
```

The block content is identical for every host: it tells the agent to pass its
own host name (`--host codex` or `--host claude`) and how to apply the result
through its own spawn schema. Installation is idempotent, preserves unrelated
content, and uses the markers below. Uninstall removes only this block:

```text
<!-- codex-systemone-router:start -->
...
<!-- codex-systemone-router:end -->
```

Existing files are backed up before edits. Partial, repeated, reversed, or
inline markers and non-regular files (including symlinks) are refused. Dry-run
creates neither files nor backups. Uninstall preserves surrounding whitespace;
if install had to add a line terminator to an unterminated user line, that
terminator remains. Avoid concurrent edits during installation.

For custom configuration, export `CODEX_SYSTEMONE_ROUTER_CONFIG` to an absolute
path in the shell that starts Codex or Claude Code, so every routed subtask
uses it. An earlier one-off `route --config ...` does not persist configuration
for installed guidance. For a desktop app, the variable must be in the app
process's environment; exporting it in an unrelated terminal does not change an
already running app.

After installation, start a fresh Codex or Claude Code session. Observe the
route invocation with the host's own `--host` value, its returned settings, and
the subsequent spawn with the **identical** task. Use the host's current spawn
schema; do not assume a role preset or option accepts overrides. The router
does not invent or override a host's spawn API.

The installed instructions tell the main agent to:

1. choose independently delegatable implementation, investigation, testing,
   review, or research work;
2. have an assigned child complete its task without re-delegating unless its
   parent explicitly authorizes that;
3. write a concise self-contained task description before every spawn,
   including all role instructions and constraints;
4. route that exact UTF-8 text through `codex-systemone-router route --stdin
--json --host <codex|claude>` with its own host name and pass the identical
   text as the child task;
5. use a router decision only after exit 0 and valid JSON with a target; a
   valid fallback result may be used as returned, while nonzero, command-not-
   found, invalid config, or invalid JSON must not be used to guess a target;
6. apply returned settings through the current host's actual spawn schema
   (Codex subagent model and reasoning effort; Claude Code `Agent` tool
   `model` and `effort`) and report when the host cannot apply them; and
7. route even tasks that look trivial.

This is a safe instruction path, not technical enforcement. The main agent
still owns decomposition, integration, and final verification.

`doctor --config PATH --agents-path FILE` reports runtime, configuration, the
selected host and its source, each host's targets, policy, a typed backend
response, and whether the requested file contains the current managed block;
`doctor --global` checks both global files instead. A missing block is
informational; malformed markers, unreadable paths, invalid config/policy, an
invalid `--host`, an unsupported Node runtime, or a failed backend response
make the command exit nonzero. The marker check does not prove either host
loaded that file. `AGENTS.override.md`, a nearer project file, or a project
`CLAUDE.md` that hides `AGENTS.md` may change the active instructions, and
`doctor` cannot observe a child's effective model or effort after spawn.

## Safe fallback

The backend has a required timeout and strict response validation. Ollaya
responses declaring `state_truncated: true` use fallback with reason
`input_truncated`, because part of the task was dropped; see the
[Ollaya API reference](https://ollaya.dev/docs/api#decide). Connection
errors, non-2xx responses, malformed JSON, unknown choices, missing fields, and
invalid probability distributions produce a valid fallback `RoutingResult`
instead of blocking delegation. The fallback target is normally high
reasoning and can be configured. In JSON mode, warnings remain on stderr and
stdout contains one valid result. A successful fallback can exit with status 0;
inspect `fallback` and `reason` when automation needs to distinguish it. Invalid
configuration exits 2 without JSON because a route cannot be trusted; run
`doctor` for details. Empty/overlong tasks and invalid command syntax exit
nonzero without JSON. Tasks are limited to 100000 UTF-16 code units.

## Privacy and logging

The default design is local-first with no analytics or decision log. Task text
is sent only to the configured decision backend. The router does not print
task text in diagnostics. Avoid putting credentials or sensitive source text
in task descriptions.

## Benchmark and calibration caveat

From a source checkout, `npm run benchmark` runs the checked-in representative fixtures when a
canonical 100-task dataset is not present. That fixture set is validation
tooling, not the M4 benchmark and must not be described as canonical. The report
includes exact accuracy, accuracy within ±1 ordinal class, a confusion matrix,
average/P50/P95/P99 end-to-end latency (including failed attempts), and score distributions when the backend returns
them. Fallbacks are counted separately and excluded from accuracy, confusion,
and score statistics.

The exploratory M4 result in the implementation brief (about 100 tasks,
roughly 194 ms average, 173 ms P50, 234 ms P95, 249 ms P99, 61% exact and 100%
within ±1) is historical context, not a guarantee. Manual labels are heuristic,
not ground truth. In particular, xhigh is weakly calibrated. Future calibration
should measure the minimum model/reasoning level at which Codex reliably
completes a task, while preserving raw probabilities and score.

From a source checkout, `npm run replay` separately recomputes the checked-in
numeric 100-row historical CSV without network or Codex calls. It reports recorded choice,
probability argmax, legacy ordinal, and the default conservative candidate.
The rows do not contain task text, and their manual labels are not Codex task
outcomes. The repository verification notes document the fixed-dataset
comparison and its limits.

## Limitations and roadmap

v0.1 chooses a resource for a task description; it does not know whether the
selected model actually completed the work, and it cannot prove savings or
quality improvements. Thresholds are initial heuristics and should be tuned
against real completion outcomes.

Possible future work, intentionally out of scope for v0.1:

- main-agent reasoning routing per user turn;
- a Codex proxy or interception layer;
- separate capability and difficulty dimensions;
- risk-aware routing and failure escalation;
- native Kev/MLX, Jev, Laya, and additional backends;
- calibration from observed Codex outcomes and offline decision logs; and
- Homebrew distribution.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development loop, test
requirements, and scope boundaries. Keep changes small and reviewable. Do not
add hidden network calls, telemetry, or automatic subagent interception.

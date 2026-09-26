# codex-systemone-router

`codex-systemone-router` is a small, local-first control-plane utility for
choosing a Codex subagent model and reasoning effort before delegation. It
asks a local System-1 decision backend (v0.1 uses Ollaya with `kev:latest`),
turns the returned difficulty probabilities into an ordinal score, and applies
a deterministic, configurable routing policy.

The router makes a decision; it does not perform the delegated work.

## v0.1 status and boundaries

The v0.1 integration is instruction-driven through `AGENTS.md`. The managed
instructions tell a Codex main agent to describe each independent subtask,
route that description, and pass the returned model and reasoning effort to
the subagent. `AGENTS.md` cannot technically intercept or enforce a
`spawn_agent` call, and this project does not claim to do so.

There is no transparent subagent proxy, main-agent interception, daemon,
telemetry service, dashboard, hosted decision service, OpenAI API proxy, or
automatic failure escalation in v0.1. The router never executes commands
returned by a backend and does not bind a server port.

## Architecture

```text
task description
      |
      v
backend adapter (Ollaya HTTP API)
      |
      v
validated DifficultyDecision
      |
      v
ordinal score: 0*P(low) + 1*P(medium) + 2*P(high) + 3*P(xhigh)
      |
      v
deterministic threshold policy
      |
      v
model + reasoning_effort (+ fallback metadata)
```

Backend details stay behind an adapter. Policy code consumes normalized
decisions, so a future native Kev, Laya, Jev, or custom HTTP adapter can be
added without spreading Ollaya-specific response types through the project.
Probabilities and the score are retained in the result for inspection; the
probability argmax is not treated as the route by itself.

## Prerequisites

- Node.js 22 or newer.
- A Codex setup that can delegate independent work and accept explicit model /
  reasoning overrides. Availability depends on your host and account; configure
  the mapping to supported models. This router cannot check Codex entitlements.
- A local Ollaya-compatible decision endpoint. The default is
  `http://127.0.0.1:11435/api/decide`.
- The `kev:latest` decision model available to that endpoint, unless a
  configured model is used instead.

Ollaya and Kev are optional for a smoke test because routing degrades to a
configured capable fallback when the backend is unavailable. That fallback is
not evidence that the local decision model ran.

## Install and build

```bash
npm install
npm run build
```

The package exposes the `codex-systemone-router` executable after installation
(or with `npm link` from a checkout):

```bash
npm link
codex-systemone-router --help
```

The Codex process must inherit the npm global executable directory on `PATH`.
After `npm link`, verify `command -v codex-systemone-router` in the same shell
you use to launch Codex. Restart Codex after changing `PATH` or linking the
package; a desktop app already open may keep its earlier environment.

The command accepts one positional task for `route`; `--stdin` reads the task
from standard input instead. Route-level overrides are `--config PATH`,
`--backend-url URL`, `--backend-model MODEL`, `--timeout-ms MS`,
`--fallback-model MODEL`, and `--fallback-reasoning-effort low|medium|high|xhigh`.

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

JSON output contains the policy-selected difficulty, ordinal score, target model and
reasoning effort, the normalized probabilities, backend metadata, latency, and
`fallback`. Human-readable warnings go to stderr so JSON stdout remains
machine-parseable. A fallback result has `fallback: true` and a machine-readable
reason such as `backend_unavailable`, `timeout`, `malformed_response`,
`invalid_probabilities`, `input_truncated`, or `invalid_configuration`.

The stable JSON keys are `difficulty`, `score`, `model`, `reasoning_effort`,
`probabilities`, `backend`, `decision_model`, `latency_ms`, `fallback`, and `reason`.
`reason` is null on success. `latency_ms` is Ollaya's `total_duration` converted
from nanoseconds, or observed request time when that field is absent. On fallback,
`backend` is `fallback`, `decision_model` and `latency_ms` are null; the high
bucket, score 2, and one-hot high probabilities are synthetic placeholders,
**not a measured estimate**. Always check `fallback` before using these as data.

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
  thresholds:
    medium: 0.75
    high: 1.75
    xhigh: 2.55
  routes:
    low: { model: gpt-5.6-luna, reasoning_effort: low }
    medium: { model: gpt-5.6-luna, reasoning_effort: medium }
    high: { model: gpt-5.6-sol, reasoning_effort: high }
    xhigh: { model: gpt-5.6-sol, reasoning_effort: xhigh }
  fallback: { model: gpt-5.6-sol, reasoning_effort: high }
```

Default score buckets use inclusive lower bounds: low [0, 0.75), medium
[0.75, 1.75), high [1.75, 2.55), xhigh [2.55, 3]. These initial heuristics
reserve xhigh for distributions strongly weighted toward the hardest class;
they are not fitted to the historical 100-task labels. Thresholds must strictly
increase within 0..3. All four probabilities must be finite values in [0, 1];
sums within 0.01 of 1 are normalized, larger deviations are rejected.

Recognized environment overrides use the `CODEX_SYSTEMONE_ROUTER_` prefix:
`BACKEND_TYPE`, `BACKEND_URL`, `BACKEND_MODEL`, `BACKEND_TIMEOUT_MS`,
`POLICY_THRESHOLDS_MEDIUM|HIGH|XHIGH`,
`POLICY_ROUTES_<DIFFICULTY>_MODEL`,
`POLICY_ROUTES_<DIFFICULTY>_REASONING_EFFORT`,
`POLICY_FALLBACK_MODEL`, and `POLICY_FALLBACK_REASONING_EFFORT`. Singular
`POLICY_THRESHOLD_*`, `POLICY_ROUTE_*_*`, `TIMEOUT_MS`, `FALLBACK_MODEL`, and
`FALLBACK_REASONING_EFFORT` aliases are also accepted for compatibility.

Where multiple sources are supplied, precedence is deterministic:

```text
CLI override > environment > config file > built-in defaults
```

Keep task text out of shell interpolation. The CLI sends it only to the
configured decision backend; it does not send it to an analytics service.

## AGENTS.md integration

Install the managed block in the relevant Codex instruction file. `--path`
selects a file and defaults to `AGENTS.md` in the current directory. Preview
first when working in an existing repository:

```bash
codex-systemone-router install --dry-run
codex-systemone-router install
codex-systemone-router uninstall --path path/to/AGENTS.md --dry-run
```

Installation is idempotent, preserves unrelated content, and uses the markers
below. Uninstall removes only this block:

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
path in the shell that starts Codex, so every routed subtask uses it. An earlier
one-off `route --config ...` does not persist configuration for installed guidance.

After installation, start a fresh Codex session. Observe the route invocation,
its returned settings, and the subsequent spawn with the **identical** task.
When the host requires a fresh/limited-history spawn to accept overrides, use
that supported form; role presets may fix their own model. The router does not
invent or override a host's spawn API.

The installed instructions tell the main agent to:

1. choose independently delegatable implementation, investigation, testing,
   review, or research work;
2. write a concise self-contained task description before every spawn;
3. invoke `codex-systemone-router route --json` (stdin is preferred for long
   descriptions);
4. read the returned `model` and `reasoning_effort`;
5. spawn the subagent with those settings and the same task description;
6. route even tasks that look trivial; and
7. use the configured fallback if the router cannot run, and report unsupported
   spawn settings rather than silently substituting another model.

This is a safe instruction path, not technical enforcement. The main agent
still owns decomposition, integration, and final verification.

`doctor --config PATH --agents-path AGENTS.md` checks Node.js, configuration,
policy, a typed backend response, and the managed integration state. It exits
nonzero when the required Node/config/backend checks fail; an absent AGENTS
file is reported as informational.

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
configuration uses the built-in fallback because the configured target cannot
be trusted; run `doctor` for details. Empty/overlong tasks and invalid command
syntax exit nonzero without JSON. Tasks are limited to 100000 UTF-16 code units.

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

# Codex System-1 Router — v0.1 Implementation Brief

## Mission
Build a public OSS project: `codex-systemone-router`.

Act as lead implementation agent: design, implement, test, document, and prepare v0.1 for GitHub release. Do not merely scaffold. Use subagents for independent implementation/research/testing/review when useful; main agent owns architecture, integration, final verification.

Primary goal: **before Codex spawns a subagent, use a fast local System-1 decision model to estimate task difficulty, then deterministically choose subagent model + reasoning effort.**

Core workflow: **Delegate → Route → Spawn**.

Do not invent undocumented Codex capabilities. If enforcement is impossible, use the safest instruction-driven integration and document the limitation.

## Product model
```text
User → Codex Main Agent → delegatable subtask
     → codex-systemone-router → System-1 backend (v0.1 Ollaya + Kev)
     → difficulty probabilities → deterministic policy
     → model + reasoning_effort → Codex Subagent
```
The router is control-plane software; it MUST NOT solve the delegated task. Decision inference and execution policy are separate concerns.

## Evidence / design implication
Historical exploratory M4 Mac mini benchmark, Ollaya + `kev:latest`: 100 tasks; avg ~194ms, P50 ~173ms, P95 ~234ms, P99 ~249ms; manually labeled exact agreement 61%; within ±1 ordinal class 100%; no observed ≥2-level disagreements. These heuristic labels are not Codex task outcomes or ground truth. Preserve probabilities and declared choice; do not directly map argmax to model names.

## v0.1 scope
### 1. AGENTS.md integration
Install a concise managed block strongly instructing Codex to:
1. Delegate suitable independent work to subagents.
2. An assigned child does not re-delegate unless its parent explicitly permits it.
3. Before EVERY spawn, create a self-contained task including all role instructions.
4. Route the identical UTF-8 task text and pass it unchanged to the child.
5. Use only a valid exit-0 JSON decision; do not guess a target after errors.
6. Apply returned settings through the host's actual spawn schema and report unsupported settings.
7. Do not bypass routing because a task looks trivial.

This is instruction-driven. Never claim AGENTS.md technically intercepts `spawn_agent`.

### 2. Routing CLI
Support:
```bash
codex-systemone-router route "<task>"
codex-systemone-router route --json "<task>"
echo "<task>" | codex-systemone-router route --stdin --json
```
Conceptual JSON:
```json
{"difficulty":"high","score":1.84,"model":"gpt-6.1-sol","reasoning_effort":"high","probabilities":{"low":0.07,"medium":0.21,"high":0.52,"xhigh":0.20},"backend":"ollaya","decision_model":"kev:latest","latency_ms":218,"fallback":false}
```

## Explicit non-goals
Do NOT implement: main-agent routing/interception; per-user/per-inference Codex proxy; OpenAI API proxy; transparent request interception; automatic failure escalation; daemon; dashboard/web UI; telemetry server; hosted decision service; direct ML inference/download/GPU management; IDE plugins. Leave extension points only.

## Technology
- TypeScript, Node.js 22+, strict mode, ESM unless concretely blocked.
- Prefer native `fetch`, fs/process APIs.
- Runtime dependencies ideally ≤2.
- No framework, DI container, database, or logging framework.

## Architecture
```text
Backend Adapter
  ↓
Normalized DifficultyDecision
  ↓
Ordinal Score
  ↓
Routing Policy
  ↓
RoutingResult
```
Backends estimate difficulty; policies choose execution resources. No Ollaya-specific types outside adapter. Design for future native Kev, Laya, Jev, custom HTTP backends.

## Suggested layout
```text
src/
  cli/{index,route,doctor,install,uninstall}.ts
  backend/{types,ollaya}.ts
  decision/{types,difficulty}.ts
  policy/{types,score,default-policy}.ts
  config/{types,defaults,loader}.ts
  codex/{agents-template,installer}.ts
  errors/errors.ts
  index.ts
templates/AGENTS.md
benchmark/tasks.json
tests/
config.example.yaml
package.json
tsconfig.json
README.md
CONTRIBUTING.md
LICENSE
.gitignore
```
Simplify when justified; avoid architecture astronautics.

## Core types
Use explicit types equivalent to:
```ts
type Difficulty = "low" | "medium" | "high" | "xhigh";
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
interface DifficultyProbabilities { low:number; medium:number; high:number; xhigh:number }
interface DecisionRequest { task:string }
interface DifficultyDecision { choice:Difficulty; confidence?:number; probabilities:DifficultyProbabilities; score:number; latencyMs?:number; backend:string; decisionModel?:string }
interface RoutingTarget { model:string; reasoningEffort:ReasoningEffort }
interface RoutingResult { difficulty:Difficulty; score:number; target:RoutingTarget; decision:DifficultyDecision; fallback:boolean; reason?:string }
```
All external JSON MUST be runtime-validated; no unsafe blind casts.

## Backend
Small abstraction:
```ts
interface DecisionBackend {
  decide(request: DecisionRequest): Promise<DifficultyDecision>;
  healthCheck?(): Promise<HealthStatus>;
}
```
v0.1: `OllayaBackend`.
Defaults: `http://127.0.0.1:11435/api/decide`, model `kev:latest`; configurable.

## Ollaya request
Use the proven typed-choice request with state=`<SUBTASK>` and question `reasoning_effort`:
- low: simple mechanical/highly predictable, little investigation
- medium: normal engineering, existing-code understanding/localized changes
- high: substantial investigation/debugging/cross-module/concurrency/architecture-sensitive
- xhigh: exceptional ambiguity/deep investigation/multiple hypotheses/costly mistakes

Centralize exact question/criteria strings.

## Response validation
Validate HTTP status, JSON, answer, known choice, all four probabilities, finite/range-valid values, sensible sum. Normalize small floating deviations; reject gross invalidity. Convert Ollaya ns durations to ms. Preserve confidence for observability but never use it as sole routing signal. Handle timeout, refusal, non-2xx, malformed JSON, unknown choice, missing fields, invalid probabilities.

## Ordinal score
Map low=0, medium=1, high=2, xhigh=3:
```text
score = P(low)*0 + P(medium)*1 + P(high)*2 + P(xhigh)*3
```
Range 0..3. Pure function + thorough tests. The configured strategy, not the
score function, determines the selected logical difficulty.

## Policy
Deterministic + configurable. The default `conservative` strategy selects the
higher ordinal value of the configured score bucket and backend-declared
choice, preventing mean-score bucketing from silently lowering a valid high or
xhigh declaration. Preserve and expose declared-choice/probability-argmax
disagreement. Also support explicit `ordinal` (legacy score-only) and `argmax`
(probability maximum, ties choose the lower ordinal class) strategies. Logical
difficulty remains separate from model/effort mapping. Example only:
```yaml
low:    { model: gpt-6-luna, reasoning_effort: low }
medium: { model: gpt-6-luna, reasoning_effort: medium }
high:   { model: gpt-6.1-sol,  reasoning_effort: high }
xhigh:  { model: gpt-6-astra, reasoning_effort: xhigh }
```
Do not scatter model names in code. Score thresholds configurable. Any initial thresholds are heuristics; do not present them as proven calibration.

## Calibration philosophy
Manual benchmark labels are heuristic, not true ground truth. The fixed replay
is a sanity comparison, not evidence of generalization or improved Codex task
success. Future ground truth should approximate the **minimum model/reasoning
level at which Codex reliably completes a task**. Preserve probabilities and
score; expose configurable thresholds; explicitly document xhigh calibration
weakness; avoid accuracy marketing claims.

## Safe fallback
After configuration is valid, expected backend failures must not block
delegation. Provide a configurable capable fallback, normally high reasoning.
On backend failure: valid `RoutingResult`, `fallback:true`, machine-readable
reason, stderr warning, clean stdout in JSON mode. Invalid configuration exits
2 without a route; unexpected internal errors exit 1 and do not masquerade as
backend fallback.

## CLI
### route
Robust args/stdin, stable JSON, human output, no shell interpolation of task text.
### doctor
Report Node≥22, configuration, policy, actual typed backend response, and
managed-block presence/absence/malformed state separately. State that Codex
instruction loading and child runtime settings are unverified; an
`AGENTS.override.md` or nearer file may change which instructions Codex loads.
### install
Support `--dry-run`; safely add/update managed AGENTS block using:
```text
<!-- codex-systemone-router:start -->
...
<!-- codex-systemone-router:end -->
```
Idempotent; preserve unrelated content; backup before potentially destructive replacement.
### uninstall
Remove ONLY managed block; support dry-run; idempotent.

## Configuration
Prefer simple YAML if dependency cost is reasonable. Concept:
```yaml
backend:
  type: ollaya
  url: http://127.0.0.1:11435/api/decide
  model: kev:latest
  timeout_ms: 2000
policy:
  strategy: conservative
  thresholds:
    medium: <calibrated>
    high: <calibrated>
    xhigh: <calibrated>
  routes:
    low:    { model: gpt-6-luna, reasoning_effort: low }
    medium: { model: gpt-6-luna, reasoning_effort: medium }
    high:   { model: gpt-6.1-sol, reasoning_effort: high }
    xhigh:  { model: gpt-6-astra, reasoning_effort: xhigh }
  fallback: { model: gpt-6.1-sol, reasoning_effort: high }
```
If overrides exist, deterministic precedence: CLI > env > config > defaults. Keep configuration small.

## AGENTS.md template requirements
Keep installed context concise. Meaning:
> Use subagents for independently delegatable implementation, investigation, testing, review, research, and other separable work. Before EVERY spawn, create a concise self-contained task; invoke `codex-systemone-router route --json` (stdin preferred for long tasks); read model/reasoning; spawn with them; give the subagent the same task. Do not bypass routing for trivial-looking tasks. Use router fallback if returned; if executable cannot run, use configured safe fallback. Main agent owns decomposition, integration, final verification. Router chooses resources and does not solve work.

Bad routing task: `fix it`; `continue previous work`.
Good: `Investigate why PaymentService can create duplicate payment records when client requests are retried across multiple application instances. Identify the concurrency/idempotency failure, implement a safe fix, and add a regression test.`

## Privacy/logging
Local-first, no analytics by default. If logging exists, default to task hash + route + probabilities + latency + timestamp; no full task/source text by default. Verbose logging opt-in. Never send task text anywhere except configured decision backend.

## Mandatory tests
- Pure: probability validation/normalization, score, threshold boundaries, policy mapping, fallback, config precedence.
- Ollaya mock: valid, timeout, connection error, 500, malformed JSON, missing answer, invalid choice, missing/invalid probability, near-1 sum normalization, gross invalid distribution.
- Installer with temp files: absent file, unrelated content, existing block, repeated install/uninstall, dry-run, malformed/partial markers, preservation.
- CLI: arg task, stdin, JSON, human output, fallback, doctor success/failure.

## Benchmark support
If the 100-task dataset exists in workspace, include/adapt it; otherwise create representative fixtures without claiming canonical status. Report exact accuracy, within ±1, confusion matrix, avg/P50/P95/P99 latency, preferably score distributions. Benchmark is validation tooling, not runtime coupling.

## README
Explain what/why, architecture, prerequisites (Codex, Node22+, Ollaya, Kev), quick start, config, route examples, AGENTS integration, fallback, limitations, privacy, benchmark caveat, roadmap, contributing. Explicitly state v0.1 does NOT transparently intercept subagent spawning; integration is AGENTS instruction-driven. Do not overclaim savings/accuracy.

## Packaging/release
Expose npm bin `codex-systemone-router`. Add package metadata, build/typecheck/test scripts, files whitelist, `engines.node >=22`. Do not publish/create remote resources unless explicitly authorized. Never invent GitHub username/repository URL.

## Security/error handling
Treat task/config/backend data as untrusted. No eval. Avoid shell execution for task text. No secret printing. No server binding in v0.1. Backend timeout required. Never execute backend-provided commands. Human errors to stderr; JSON stdout stays parseable. Avoid stack traces for expected errors unless debug. Routing normally degrades to fallback.

## Engineering quality
Small cohesive modules, explicit types, pure policy math, comments explain why, no speculative abstractions, avoid `any`, deterministic tests, format/lint/typecheck/test clean. Optimize clarity first; router overhead should remain tiny.

## Execution plan
Proceed autonomously:
1. Inspect workspace and preserve intentional existing work.
2. Verify only current Codex details necessary for AGENTS/subagent syntax; do not invent APIs.
3. Finalize concise architecture/plan.
4. Scaffold TypeScript package.
5. Implement types/config.
6. Implement Ollaya adapter + validation.
7. Implement score/policy/fallback.
8. Implement route CLI.
9. Implement doctor.
10. Implement safe AGENTS install/uninstall.
11. Build tests in parallel where useful.
12. Add benchmark fixtures/tooling if practical.
13. Write README/CONTRIBUTING/LICENSE.
14. Run formatter/lint if configured, typecheck, tests, build, CLI smoke tests, installer idempotency and fallback tests.
15. Perform independent reviewer pass via subagent if available.
16. Fix issues.
17. Report changed files, commands/tests, limitations, and next steps.

Do not stop after planning unless genuinely blocked by information unavailable locally.

## Definition of Done
Done only when: build clean; strict typecheck passes; tests pass; route works against mocked backend and real Ollaya smoke test if locally available; score is probability-based; policy configurable; failures fallback safely; doctor actionable; install/uninstall preserve unrelated AGENTS content and are idempotent; JSON machine-parseable; README sufficient for new user; limitations explicit; no hidden telemetry/network beyond configured backend; no unrelated files modified.

## Future roadmap — document, do not implement
- main-agent reasoning routing per user turn
- Codex proxy integration
- model capability and difficulty as separate dimensions
- risk-aware routing
- failure escalation
- native Kev/MLX, Jev, Laya, custom backends
- calibration from actual Codex outcomes
- decision logs/offline analysis
- Homebrew distribution

## Final instruction
Keep v0.1 intentionally small. The value proposition is not “an autonomous orchestration framework.” It is:

> **A fast, local System-1 decision before Codex delegates expensive work.**

Protect that simplicity throughout implementation.

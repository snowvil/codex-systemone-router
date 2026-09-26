/**
 * The markers are deliberately boring and stable. The installer uses them as
 * the only boundary it is allowed to replace or remove in an AGENTS.md file.
 */
export const AGENTS_START_MARKER = "<!-- codex-systemone-router:start -->";
export const AGENTS_END_MARKER = "<!-- codex-systemone-router:end -->";

/**
 * Keep this block short: it is copied into a user's AGENTS.md file and read on
 * every Codex task. The router supplies a resource choice; it does not do the
 * delegated work itself.
 */
export const MANAGED_AGENTS_BLOCK = `${AGENTS_START_MARKER}

Use subagents for independently delegatable implementation, investigation, testing, review, research, and other separable work.

An assigned subagent completes its task without re-delegating unless its parent explicitly authorizes that. The coordinating agent owns decomposition, integration, and final verification.

Before EVERY subagent spawn:

1. Create a concise, self-contained task description with context, scope, constraints, and expected evidence. Include every role instruction and constraint in this description.
2. Route that exact UTF-8 text with \`codex-systemone-router route --stdin --json\`; pass the identical text as the child task. Feed stdin without shell interpolation or writing a repository task file. If a temporary file is necessary, create it securely with a unique name and remove it immediately after routing.
3. Use a router decision only when the command exits 0 and returns valid JSON containing a target. A valid fallback result may be used as returned. For nonzero exit, command-not-found, invalid configuration, or invalid JSON, do not infer or guess a model or effort.
4. Read the returned \`model\` and \`reasoning_effort\`, then apply them using the current host's actual spawn schema. Do not assume a role preset or spawn option accepts overrides; if the schema cannot apply them, report that limitation without claiming they were applied.
5. Give the subagent the identical self-contained task description.

Do not bypass routing because a task looks trivial. If no valid decision is available or the host cannot apply it, report the limitation and continue only within the coordinating agent's authority; do not silently substitute a target. This is instruction-driven guidance, not a technical spawn hook. The router chooses resources; it does not do the delegated work.
Before changing a repository, read its AGENTS.md plus contribution, version, and release guidance; follow that repository's documented branch workflow and do not apply another project's policy.
${AGENTS_END_MARKER}`;

/** The complete file content used when AGENTS.md does not exist yet. */
export const AGENTS_TEMPLATE = `${MANAGED_AGENTS_BLOCK}\n`;

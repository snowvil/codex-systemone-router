import { DEFAULT_FALLBACK } from "../config/defaults.js";

/**
 * The markers are deliberately boring and stable.  The installer uses them as
 * the only boundary it is allowed to replace or remove in an AGENTS.md file.
 */
export const AGENTS_START_MARKER = "<!-- codex-systemone-router:start -->";
export const AGENTS_END_MARKER = "<!-- codex-systemone-router:end -->";

/**
 * Keep this block short: it is copied into a user's AGENTS.md and is read on
 * every Codex task.  The router supplies a resource choice; it does not do the
 * delegated work itself.
 */
export const MANAGED_AGENTS_BLOCK = `${AGENTS_START_MARKER}

Use subagents for independently delegatable implementation, investigation, testing, review, research, and other separable work.

Before EVERY subagent spawn:

1. Create a concise, self-contained task description with context, scope, constraints, and expected evidence.
2. Route that exact text with \`codex-systemone-router route --stdin --json\`; feed stdin without shell interpolation or writing a repository task file. If a temporary file is necessary, create it securely with a unique name and remove it immediately after routing.
3. Read the returned \`model\` and \`reasoning_effort\`, then spawn the subagent with those settings. Follow the available tool schema: if overrides require fresh/limited history, use that form (for \`collaboration.spawn_agent\`, \`fork_turns="none"\` or a positive count, not the default full-history fork). Avoid role presets that force different settings.
4. Give the subagent the same self-contained task description.

Do not bypass routing because a task looks trivial. If routing fails, use the returned safe fallback; if the executable cannot run, use the configured safe fallback (built-in: ${DEFAULT_FALLBACK.model} with ${DEFAULT_FALLBACK.reasoning_effort} reasoning effort). If the available spawn tool cannot apply those settings, report the limitation and keep the main agent settings instead of silently substituting. This is instruction-driven guidance, not a technical spawn hook. The router chooses resources and does not solve work. The main agent owns decomposition, integration, and final verification.
${AGENTS_END_MARKER}`;

/** The complete file content used when AGENTS.md does not exist yet. */
export const AGENTS_TEMPLATE = `${MANAGED_AGENTS_BLOCK}\n`;

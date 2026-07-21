# Context

Three independent main-process flows invoke `@anthropic-ai/claude-agent-sdk`. Each currently prepares Claude configuration and provider credentials independently, and two flows implement their own model selection. This duplication creates inconsistent catalog fallback and makes process-global `CLAUDE_CONFIG_DIR` coordination unreliable across modules.

# Decisions

## Decision: Introduce a shared Claude SDK runtime facade

The system will add a single runtime module under `electron/engines/` that owns SDK loading, query construction, session metadata/history access, session deletion, bundled executable discovery, configuration-directory preparation, and process-environment coordination.

Rationale: these concerns are SDK integration infrastructure rather than chat, cron, or memory business logic. A single facade provides one lifecycle and one serialization queue for process-global environment changes.

Alternative considered: retain direct dynamic SDK imports in each caller and only share helper functions. This leaves SDK lifecycle behavior distributed and does not fully satisfy the consolidation goal.

## Decision: Use the existing catalog-aware model selector for every flow

All flows will resolve explicit overrides first, then Agent preferences and the default account, using `resolveAvailableClaudeModel` for catalog validation and fallback.

Rationale: the selector already handles enabled accounts, qualified/unqualified model matching, configured fallbacks, and incomplete STO catalogs.

Alternative considered: preserve scheduled-task and summarization-specific selectors. This would retain the model drift that caused the reported failure.

## Decision: Keep feature-specific SDK options in callers

The shared runtime will construct the common launch context and SDK query, while callers will continue to supply their own prompt, streaming flag, skills, MCP servers, hooks, plugins, permission mode, system prompt, and session semantics.

Rationale: these options express business behavior and differ materially between interactive chat, scheduled tasks, and summarization.

Alternative considered: create one universal option builder. This would produce a large conditional API and couple unrelated features.

# Risks

- [Risk] Consolidated model validation may select a fallback where a stale model was previously forwarded. → Mitigation: log requested and selected account/model whenever fallback is applied and cover selection priority with unit tests.
- [Risk] Process-global `CLAUDE_CONFIG_DIR` mutation can race across concurrent flows. → Mitigation: keep a single shared serialization queue and limit mutation to SDK construction/session operations.
- [Risk] Moving credential construction may change STO endpoint behavior. → Mitigation: reuse `applyStoClaudeInferenceEnv` as the canonical STO credential implementation and run existing Claude-related tests plus type checking.

# Documentation

This is an internal architecture refactor with no user-visible workflow or public interface change. The three README variants will be reviewed; updates are only required if they currently describe the internal SDK integration structure.


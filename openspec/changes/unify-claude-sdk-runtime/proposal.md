# Why

Claude interactive chat, local scheduled tasks, and execution-memory summarization currently duplicate provider selection, model fallback, authentication environment, Claude configuration preparation, executable discovery, and SDK loading. The implementations have already drifted: scheduled tasks and interactive chat validate models against the current catalog, while execution summarization can forward a stale model and repeatedly fail with a deterministic upstream 400.

# What Changes

- Introduce one Electron main-process Claude runtime service that owns provider/model resolution, authentication environment construction, Claude configuration preparation, bundled executable discovery, and Claude Agent SDK access.
- Migrate interactive chat, local scheduled tasks, and execution-memory summarization to the shared runtime.
- Preserve scenario-specific behavior such as streaming, skills, MCP servers, hooks, plugins, permissions, prompts, and timeouts in their existing callers.
- Add regression coverage for shared selection and runtime behavior.

# Capabilities

## New Capabilities

- `service-claude-runtime`: A shared main-process runtime boundary for all Claude Agent SDK consumers.

## Modified Capabilities

- None.

# Impact

- Affects Electron main-process Claude chat, scheduled-task execution, and execution-memory summarization.
- Removes duplicated runtime setup code and makes stale-model fallback consistent across all Claude SDK entry points.
- Does not change Renderer APIs or visible UI.


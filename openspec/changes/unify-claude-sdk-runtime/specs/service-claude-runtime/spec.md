# Purpose

Define a single Electron main-process runtime boundary for every Claude Agent SDK consumer.

# Requirements

### Requirement: Claude SDK consumers use a shared runtime boundary
Interactive chat, local scheduled tasks, and execution-memory summarization MUST access the Claude Agent SDK through one shared runtime module and MUST NOT independently implement SDK loading, bundled executable discovery, Claude configuration preparation, or provider authentication environment construction.

#### Scenario: Starting any Claude-backed operation
- **WHEN** interactive chat, a local scheduled task, or execution-memory summarization starts a Claude SDK operation
- **THEN** the operation SHALL obtain its shared launch context and SDK handle from the common Claude runtime boundary

### Requirement: Model selection is catalog-aware and consistent
The shared runtime SHALL resolve explicit model/account overrides before Agent preferences and defaults, and MUST validate the selected model against the available provider catalog using the common Claude model selector.

#### Scenario: A stored model is no longer available
- **WHEN** a Claude-backed operation requests a model that is absent from the selected provider's current catalog
- **THEN** the shared runtime SHALL select an available configured fallback and expose that resolved model to the caller

### Requirement: Feature-specific behavior remains caller-owned
The shared runtime MUST allow each caller to retain its own streaming, skills, MCP, hooks, plugins, permission, prompt, timeout, and session-resume behavior.

#### Scenario: Execution-memory summarization creates a query
- **WHEN** the summarizer creates a Claude query through the shared runtime
- **THEN** it SHALL continue to disable skills, MCP servers, hooks, and plugins while interactive and scheduled-task flows retain their existing capabilities

### Requirement: Claude process environment coordination is centralized
All temporary mutation of the process-level `CLAUDE_CONFIG_DIR` for SDK operations MUST be serialized by the shared runtime and restored after the operation is constructed or completed.

#### Scenario: Concurrent Claude flows prepare SDK operations
- **WHEN** multiple Claude-backed flows request SDK operations concurrently
- **THEN** the shared runtime SHALL serialize process-level configuration-directory mutation and restore the previous value after each protected operation


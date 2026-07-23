## Context

OpenClaw requires bootstrap markdown at the agent workspace root. Moving those files into a subdirectory without retargeting `workspace` would break injection.

## Decision

1. Introduce `PROJECT_AGENT_RUNTIME_DIRNAME = '.sclaw'`
2. `resolveProjectAgentWorkspacePath(projectRoot) -> projectRoot/.sclaw`
3. `prepareProjectAgentWorkspace` creates `.sclaw` and migrates legacy root clutter
4. Tool cwd for project sessions also resolves to `.sclaw` so OpenClaw/Claude share one home; AGENTS.md tells the model the real project is `../`

## Risks

- Agents must use `../` for project source files
- Migration is best-effort rename/merge; name collisions leave source files in place

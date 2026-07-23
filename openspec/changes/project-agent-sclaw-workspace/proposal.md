## Why

Project agents previously set OpenClaw `workspace` to the user project root. Gateway then seeded bootstrap files (`AGENTS.md`, `SOUL.md`, `USER.md`, …) and `.claw-output` directly into the project folder, polluting Finder / git status.

## What Changes

- Project agent OpenClaw workspace becomes `<projectRoot>/.sclaw`
- Artifacts live at `<projectRoot>/.sclaw/.claw-output`
- On ensure, migrate legacy root bootstrap / `.claw-output` / `memory` into `.sclaw`
- Upsert AGENTS.md / CLAUDE.md project-directory + artifact rules for the new layout

## Impact

- Affected: project-agent-service, session-catalog tool cwd, shared workspace-paths, i18n project artifact hint
- Existing project chats: next ensure/migrate moves files and retargets agent workspace
- Default managed workspaces under `~/.stoclaw/workspace` unchanged

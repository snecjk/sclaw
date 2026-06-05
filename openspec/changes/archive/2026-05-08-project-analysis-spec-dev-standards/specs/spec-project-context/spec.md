## Purpose

Define requirements for maintaining the OpenSpec project context in `openspec/config.yaml` so that AI agents generate artifacts aligned with StoClaw conventions.

## Requirements

### Requirement: config.yaml includes project tech stack context
The openspec/config.yaml SHALL include a `context` field describing StoClaw's technology stack, key directories, and domain knowledge.

#### Scenario: AI generates a proposal
- **WHEN** an AI agent creates a new OpenSpec artifact for StoClaw
- **THEN** the AI SHALL have access to the project context including: Electron + React 19 + Vite + TypeScript, pnpm package manager, `src/pages/`, `src/components/`, `src/stores/`, `electron/services/` directory structure
- **AND** the context SHALL mention that the app is a GUI for the OpenClaw AI agent runtime

### Requirement: config.yaml includes architecture boundary rules
The openspec/config.yaml SHALL include per-artifact rules that enforce the Renderer/Main API boundary constraints.

#### Scenario: AI generates a task involving IPC
- **WHEN** an AI generates tasks for a change that crosses the Renderer/Main boundary
- **THEN** the per-artifact rules SHALL remind the AI that renderer MUST use `src/lib/host-api.ts` and `src/lib/api-client.ts` as the single entry for backend calls
- **AND** the rules SHALL prohibit adding new direct `window.electron.ipcRenderer.invoke(...)` calls in pages/components

### Requirement: config.yaml includes communication path rules
The openspec/config.yaml SHALL include rules for changes that touch communication paths.

#### Scenario: AI generates tasks for gateway or runtime communication
- **WHEN** an AI generates tasks for changes involving gateway events, runtime send/receive, or delivery
- **THEN** the per-artifact rules SHALL require running `pnpm run comms:replay` and `pnpm run comms:compare` before marking the change complete
- **AND** the rules SHALL state that transport policy is Main-owned and fixed as `WS -> HTTP -> IPC fallback`

### Requirement: config.yaml includes doc sync rules
The openspec/config.yaml SHALL include rules requiring documentation updates after functional changes.

#### Scenario: AI generates tasks that change user-facing behavior
- **WHEN** an AI generates tasks for changes that modify behavior, flows, or interfaces
- **THEN** the per-artifact rules SHALL require reviewing `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates
- **AND** the rules SHALL state that docs SHALL be updated in the same PR/commit when behavior changes

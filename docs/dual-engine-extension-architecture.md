# Dual-Engine Extension Architecture

## Status

Draft design with initial implementation scaffolding.

## Goal

StoClaw needs one extension model that can serve both runtime engines:

- OpenClaw plugin runtime
- Claude Agent SDK runtime

The architecture should let us:

- install/package OpenClaw and Claude assets independently
- allow StoClaw to decide what is enabled for a given session
- keep OpenClaw and Claude source trees isolated so they can evolve independently

## Non-Goals

- This document does not migrate existing extensions yet
- This document does not replace the current OpenClaw plugin bundle pipeline
- This document does not require every Claude extension to be a standalone Claude plugin; SDK hooks remain first-class

## Design Principles

1. Host-controlled enablement
   StoClaw decides which extensions are active for a session. We do not rely on accidental files left in user config directories.

2. Packaged assets are immutable, installed assets are runtime mirrors
   Repo and packaged resources are sources of truth. Runtime directories under OpenClaw / Claude config paths are mirrors.

3. Engine source trees are isolated
   OpenClaw plugin code and Claude SDK / plugin code live under separate directories and should not directly import each other.

4. Claude SDK hooks and Claude plugins are complementary
   Session-aware behavior belongs in SDK hooks; static packaged behavior can live in Claude plugin directories.

## Directory Layout

Each extension gets one stable ID and may provide assets for one or both engines.

```text
sto-plugin/
  openclaw/
    <plugin-id>/
      openclaw.plugin.json
      package.json
      ...
  claude/
    <extension-id>/
      sdk/
        ...
      plugin/
        .claude-plugin/
          plugin.json
        hooks/
          hooks.json
        skills/
          ...
        agents/
          ...
        scripts/
          ...
  <plugin-id>/
    ...
```

Notes:

- `sto-plugin/openclaw/` is the canonical repo source for OpenClaw plugins.
- `sto-plugin/claude/` is the canonical repo source for Claude SDK adapters and optional Claude plugin assets.
- `sto-plugin/<plugin-id>/` remains only as a compatibility shim for existing packaging/install scripts and should not receive new engine-specific logic.

## Extension Registry

StoClaw owns a single extension registry. The registry records:

- extension ID
- supported engines
- source locations for OpenClaw, Claude SDK, and Claude plugin assets
- whether an extension currently has installable Claude plugin files

The registry is the canonical list used by:

- packaging scripts
- runtime bridge installers
- per-session Claude adapter assembly
- future settings UI / feature gating

## OpenClaw Flow

### Source

- source assets live in repo-managed directories
- OpenClaw plugin sources live under `sto-plugin/openclaw/<plugin-id>`

### Packaging

- `scripts/bundle-openclaw-plugins.mjs` bundles registered OpenClaw plugin sources
- packaged app ships bundled plugin mirrors

### Runtime Install

- startup install/update logic mirrors bundled plugins into OpenClaw's extension directory
- OpenClaw discovers `openclaw.plugin.json`

### Runtime Use

- OpenClaw invokes native plugin hooks such as:
  - `before_prompt_build`
  - `before_tool_call`
  - `after_tool_call`

## Claude Flow

Claude has two runtime surfaces:

1. SDK runtime options
   - `hooks`
   - `systemPrompt`
   - `plugins`

2. Local Claude plugin directories
   - plugin root with `.claude-plugin/plugin.json`
   - optional `hooks/`, `skills/`, `agents/`, `scripts/`

Official references:

- [Agent SDK plugins](https://code.claude.com/docs/en/agent-sdk/plugins)
- [Claude plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude hooks reference](https://code.claude.com/docs/en/hooks)

### Source

- repo-managed Claude SDK logic lives under `sto-plugin/claude/<extension-id>/sdk/`
- optional Claude plugin assets live under `sto-plugin/claude/<extension-id>/plugin/`
- SDK-specific adapter wiring in Electron can re-export from those directories, but should not import OpenClaw plugin code

### Packaging

- packaged app ships Claude plugin source mirrors under app resources

### Runtime Install

- StoClaw mirrors packaged Claude plugin assets into `CLAUDE_CONFIG_DIR/plugins/<extension-id>`
- mirror operations are bridge-managed and tagged with a marker file
- bridge-managed copies may be refreshed or removed safely
- non-bridge directories are treated as user-owned and skipped

### Runtime Load

StoClaw must explicitly load Claude plugins in SDK sessions by passing:

```ts
plugins: [{ type: 'local', path: '<plugin-dir>' }]
```

Copying files into a Claude config directory is not sufficient by itself for StoClaw-managed SDK sessions.

### Runtime Use

Per session, StoClaw assembles:

- `systemPrompt`
- `hooks`
- `plugins`

from enabled extension registry entries.

## Enablement Rules

Enablement is host-owned, not directory-owned.

Priority:

1. explicit StoClaw session / agent enablement
2. app-level defaults
3. extension registry support matrix

Local directories alone do not auto-enable an extension.

## Recommended Responsibility Split

### OpenClaw Adapter

OpenClaw-specific plugin code lives under `sto-plugin/openclaw/`.

### Claude SDK Adapter

Claude SDK runtime logic lives under `sto-plugin/claude/<extension-id>/sdk/`.

### Claude Plugin Assets

Optional packaged assets under `sto-plugin/claude/<extension-id>/plugin/` for:

- static hooks
- skills
- agents
- helper scripts

## Why Not Directly Import OpenClaw Plugin Trees From Claude

Directly importing OpenClaw plugin source from Claude runtime code creates:

- source-layout coupling
- packaging coupling
- lifecycle coupling between OpenClaw hooks and Claude hooks

Instead, Claude should depend on its own runtime adapter layer and any Claude-specific helper modules.

## Initial Implementation Scope

The first implementation stage should add:

1. a central extension registry
2. Claude path helpers for plugin mirrors
3. a Claude plugin bridge service
4. adapter support for loading registry-backed Claude plugins

This stage does not yet require every extension to provide Claude plugin assets.

## Migration Plan

1. Introduce registry and bridge scaffolding
2. Register current extensions against `sto-plugin/openclaw/` and `sto-plugin/claude/`
3. Keep legacy `sto-plugin/<plugin-id>/` entries as compatibility shims during transition
4. Add optional repo-managed Claude plugin source directories under `sto-plugin/claude/`
5. Retire direct cross-engine source imports

## Current First Candidate

`sto-dingtalk-send-guard`

Reason:

- it already exists in OpenClaw form
- it has clear core logic boundaries
- it needs both session-aware Claude SDK behavior and optional future Claude plugin packaging

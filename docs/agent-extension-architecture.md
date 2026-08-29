# SClaw Agent Extension Architecture

SClaw business extensions are compiled into the desktop application and registered through a static allowlist. The framework does not discover project `.pi/extensions`, load arbitrary local packages, or expose a public third-party plugin API.

## Layers

1. A common extension definition declares TypeBox tool schemas, tool handlers, prompt contributions, and before/after-tool policies without importing an engine SDK.
2. Capability tokens inject host-owned services without coupling business code to Electron singletons or transport details.
3. Session, turn, and tool-call state scopes normalize lifecycle differences between engines.
4. The Claude adapter compiles common tools to an in-process MCP server and policies to Claude hooks.
5. The Pi adapter compiles the same definitions to `InlineExtension`, `registerTool`, and Pi lifecycle events.

The production common allowlist is `SCLAW_AGENT_EXTENSIONS` in `electron/agent-extensions/registry.ts`. Each adapter materializes its own engine registry and attaches only its native contributions, preventing Claude native code from entering the PI worker bundle and vice versa. Migrated entries currently include the PI-only `claw-scheduled-path-guard` and the common `sto-scheduled-task-tool`. The scheduled-task extension uses a typed capability/Port backed by the local Host API, so Claude Main and the PI Utility Process share one business implementation without sharing process-local service singletons.

## Common-first rule

Business operations, validation, prompts, policies, and result envelopes belong in the common definition. Tool parameters use `typebox@1.3.7` as their single source; the Claude adapter converts the supported TypeBox subset to Zod while Pi consumes TypeBox directly.

Expected business failures use the common `SclawToolOutcome` envelope. Claude maps failures to an MCP error result; Pi raises a controlled `SclawToolExecutionError` so its native runtime records an error tool result.

## Engine-native escape hatch

A registered extension may include `native.claude` or `native.pi` contributions:

- `augment` keeps the common contribution and appends native behavior.
- `replace` skips the common contribution for that engine and uses only the native implementation.
- Individual common tools, policies, and prompts can also declare an `engines` filter.

Native code lives in the corresponding adapter or the extension's `claude.ts` / `pi.ts`. It may use the complete engine SDK, but shared business behavior must remain in the common modules. Native contributions declare claimed tool and MCP server names; collisions are diagnosed and never silently overwrite another contribution.

Recommended layout:

```text
extensions/<extension-id>/
├─ definition.ts            # common tools, policies, and prompts
├─ operations.ts            # engine-independent orchestration
├─ capability.ts            # typed business Port token, when needed
├─ host-api-capability.ts    # bundled host-side Port implementation, when needed
├─ claude.ts                # optional Claude-native escape hatch
└─ pi.ts                    # optional Pi-native escape hatch
```

## Security and compatibility

- Only compile-time registry entries are loaded.
- Missing capabilities disable the affected extension and emit a diagnostic.
- Before-tool policy exceptions fail closed; after-tool observers and prompt contributors fail independently and are logged.
- Tool names are unique across the enabled common and native contributions for each engine.
- OpenClaw remains on its legacy plugin path and is not part of this abstraction.

## Runtime diagnostics

Framework logs use the stable `[agent-extension]` prefix and structured fields. Important events include `build.start`, `build.completed`, `registry.diagnostic`, `native.build.*`, `tool.execute.*`, `policy.before.denied`, and `prompt.build.completed`. Inputs and prompt bodies are deliberately excluded; logs contain identifiers, outcome codes, counts, and durations only.

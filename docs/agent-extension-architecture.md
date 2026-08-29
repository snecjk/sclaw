# SClaw Agent Extension Architecture

SClaw business extensions are compiled into the desktop application and registered through a static allowlist. The framework does not discover project `.pi/extensions`, load arbitrary local packages, or expose a public third-party plugin API.

## Layers

1. A common extension definition declares TypeBox tool schemas, tool handlers, prompt contributions, and before/after-tool policies without importing an engine SDK.
2. Capability tokens inject host-owned services without coupling business code to Electron singletons or transport details.
3. Session, turn, and tool-call state scopes normalize lifecycle differences between engines.
4. The Claude adapter compiles common tools to an in-process MCP server and policies to Claude hooks.
5. The Pi adapter compiles the same definitions to `InlineExtension`, `registerTool`, and Pi lifecycle events.

The production registry is `SCLAW_AGENT_EXTENSIONS` in `electron/agent-extensions/registry.ts`. The first migrated entry is the PI-only `claw-scheduled-path-guard`; additional business extensions remain separate migration work.

## Common-first rule

Business operations, validation, prompts, policies, and result envelopes belong in the common definition. Tool parameters use `typebox@1.3.7` as their single source; the Claude adapter converts the supported TypeBox subset to Zod while Pi consumes TypeBox directly.

Expected business failures use the common `SclawToolOutcome` envelope. Claude maps failures to an MCP error result; Pi raises a controlled `SclawToolExecutionError` so its native runtime records an error tool result.

## Engine-native escape hatch

A registered extension may include `native.claude` or `native.pi` contributions:

- `augment` keeps the common contribution and appends native behavior.
- `replace` skips the common contribution for that engine and uses only the native implementation.
- Individual common tools, policies, and prompts can also declare an `engines` filter.

Native code lives in the corresponding adapter or the extension's `claude.ts` / `pi.ts`. It may use the complete engine SDK, but shared business behavior must remain in the common modules. Native contributions declare claimed tool and MCP server names; collisions are diagnosed and never silently overwrite another contribution.

## Security and compatibility

- Only compile-time registry entries are loaded.
- Missing capabilities disable the affected extension and emit a diagnostic.
- Before-tool policy exceptions fail closed; after-tool observers and prompt contributors fail independently and are logged.
- Tool names are unique across the enabled common and native contributions for each engine.
- OpenClaw remains on its legacy plugin path and is not part of this abstraction.

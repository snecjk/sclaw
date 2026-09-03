# SClaw Agent Extension Architecture

SClaw business extensions are compiled into the desktop application and registered through a static allowlist. The framework does not discover project `.pi/extensions`, load arbitrary local packages, or expose a public third-party plugin API.

## Layers

1. A common extension definition declares TypeBox tool schemas, tool handlers, prompt contributions, and before/after-tool policies without importing an engine SDK.
2. Capability tokens inject host-owned services without coupling business code to Electron singletons or transport details.
3. Session, turn, and tool-call state scopes normalize lifecycle differences between engines.
4. The Claude adapter compiles common tools to an in-process MCP server and policies to Claude hooks.
5. The Pi adapter compiles the same definitions to `InlineExtension`, `registerTool`, and Pi lifecycle events.

Adapters must also populate the engine-neutral runtime environment used by common policies. `commandShell` is mandatory (`bash` or `powershell`), and tool events carry a semantic `toolKind` (`shell`, `filesystem`, or `other`) so common extensions never branch on engine names or engine-specific tool names. Scheduled-task permission, workspace, and workflow behavior is declared through each `EngineAdapter.scheduledTaskCapabilities` entry.

The production common allowlist is `SCLAW_AGENT_EXTENSIONS` in `electron/agent-extensions/registry.ts`. Each adapter materializes its own engine registry and attaches only its native contributions, preventing Claude native code from entering the PI worker bundle and vice versa. Migrated entries currently include the PI-only `pi-browser-use`, the Claude-only `sto-browser-tool`, and the cross-engine `sto-scheduled-task-tool`, `sto-workflow-tool`, `sto-dingtalk-send-guard`, and `sto-skill-runtime`. Host-owned operations are exposed through typed capabilities backed by the local Host API, keeping authentication and process-local services outside extension business code.

`sto-workflow-tool` is implemented entirely with common definitions, TypeBox schemas, policies, prompts, and a `StoWorkflowPort`; it no longer depends on Claude SDK types. Claude and PI sessions share the same workflow management contract. Local PI workflow nodes reuse the singleton worker through isolated `pi:workflow:*` sessions, inherit the originating PI account and fixed model, and release their session after the node reaches a terminal state.

`sto-dingtalk-send-guard` is a common Claude/PI policy and prompt extension, not a message-sending tool. It consumes one-shot mention context through a typed Host API capability, normalizes `dws chat message send` shell input, blocks unsafe batch or local-path sends, and centralizes rate-limit/dedup state in Main. OpenClaw keeps its legacy plugin implementation until that engine is removed.

Its guidance prompt uses session-scoped activation. Explicit DingTalk keywords, oral send intent such as “发给…”, or non-destructively detected pending mention context activate it; the pending context is consumed only while building the activated prompt. Once active, follow-up turns remain active for the session. The before/after-tool safety policy is deliberately not activation-gated, so a direct `dws chat message send` call is still normalized and guarded even when no prompt contribution was loaded.

`sto-skill-runtime` owns the complete Claude/PI Skill lifecycle through one typed capability. Its always-available `search_skills` tool discovers runtime misses and authorizes native `Read/read` access to locally validated candidates. Its `save_user_skill` tool and authoring guidance activate only for interactive user-skill creation/update intent and remain available for session follow-ups. Both read attribution and direct-write protection policies remain always active; post-tool detection schedules a best-effort Main-owned orphan import through the Host API. OpenClaw retains its legacy `sto-user-skill-tool` plugin until that engine is removed.

`sto-browser-tool` exposes the six `bridge_*` operations to Claude through a common `StoBrowserBridgePort`; it is a Host API adapter for the existing Main-owned Browser Bridge and embed driver, not a second browser implementation. Embed app sessions and scheduled executions activate it automatically, while ordinary interactive sessions use sticky intent activation. Embed tool calls require an explicit `embed-<runtimeId>` session id, and ordinary calls without an id select only an external Browser Bridge session so another app's embed preview cannot be chosen accidentally. Pi does not receive `bridge_*`; interactive Pi sessions use the native `pi-browser-use` contribution, which explicitly loads the pinned `@amaster.ai/pi-browser-use` package. Pi does not use a permanent exact-name or prefix allowlist: `noExtensions: true`, the compile-time extension registry, and the session mode define which reviewed factories may load; Pi then activates every tool registered by those factories during `session_start`. On Windows the adapter gives the extension a real Node runtime for its `chrome-devtools-mcp` subprocess, preferring SClaw's packaged `node.exe` and then the system `PATH`; this keeps Electron application output off the MCP stdio channel. The worker sets `PI_AGENT_HOME` and `PI_CODING_AGENT_DIR` before importing the package, so its profile and configuration stay under SClaw's managed Pi directory. Project-local Pi settings are untrusted by default. Scheduled Pi sessions do not load this browser extension. OpenClaw retains `sto-browser-bridge` until that engine is removed.

## On-demand activation

Common tools and prompts may reference an activation declared by their owning extension. Contributions without an activation remain enabled by default, preserving compatibility. An activation matcher receives only the engine-neutral build context and may use either `turn` scope or sticky `session` scope. Session matches are stored in the framework state manager, so follow-up prompts do not need to repeat the original keywords; deleting or shutting down the engine session clears that state.

Activation is contribution-level rather than extension-level. Policies remain always active, and scheduled execution prompts can remain unconditional while interactive management tools are lazy. Matcher failures fail closed for the affected tool or prompt and emit `ACTIVATION_MATCH_FAILED` without logging the user prompt.

Claude evaluates activation before compiling common tools, so an inactive tool does not create an MCP server or contribute its schema. Pi starts each initial bind or resource reload from built-ins plus non-lazy static tools. The bound `session_start` lifecycle then lets reviewed factories register their runtime tools, which Pi activates directly; SClaw does not inspect names or rebuild a dynamic-tool allowlist. On a matching `before_agent_start`, the adapter additively enables lazy static groups through `setActiveTools()`. Resource reloads are lifecycle events caused by actual resource changes or session replacement, not a per-prompt operation; the session configuration key includes the selected Skill-set hash. PI resource reloads preserve the framework's session-scoped activation cache, while a real session shutdown clears it. This preserves follow-up availability while avoiding inactive static tool schemas in ordinary model requests and avoids restarting extension-owned MCP processes on every turn.

The common helper `createKeywordActivationMatcher` covers simple keyword and regular-expression routing. Business extensions should keep domain-specific intent matching in their own `activation.ts` when false positives or exclusions require semantic rules.

The workflow extension uses session-scoped activation for prompts containing `工作流` or `workflow`. It checks the Host API authentication state only after an intent match; an unavailable login leaves tools and prompt out of the request. Once matched, the activation remains available for follow-up turns in that session. Its shell-bypass and same-turn schema/create policies remain active independently of tool activation.

## PI prompt ownership

SClaw replaces Pi Coding Agent's built-in base system prompt through `DefaultResourceLoader.systemPromptOverride`; it does not expose Pi's coding-assistant persona to end users. The SClaw-owned base describes a general-purpose assistant for ordinary users, while retaining compact internal rules for safe use of the core file and shell tools. The SDK still assembles the managed `AGENTS.md`, selected Skills, and cwd around that custom base, and activated common/native extensions may modify the resulting prompt during `before_agent_start`. Tool schemas remain part of the provider request, while additional business tools are described by their own schemas and activated prompt contributions.

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
├─ activation.ts            # optional engine-neutral intent matcher
├─ operations.ts            # engine-independent orchestration
├─ capability.ts            # typed business Port token, when needed
├─ host-api-capability.ts    # bundled host-side Port implementation, when needed
├─ claude.ts                # optional Claude-native escape hatch
└─ pi.ts                    # optional Pi-native escape hatch
```

## Security and compatibility

- Only compile-time registry entries are loaded.
- Extension-level engine and session-mode filters are enforced before common or native contributions are built.
- Project-local Pi configuration is ignored unless the host explicitly marks the project trusted; current SClaw sessions default to untrusted.
- Missing capabilities disable the affected extension and emit a diagnostic.
- Before-tool policy exceptions fail closed; after-tool observers and prompt contributors fail independently and are logged.
- Activation matcher exceptions fail closed for the affected tools/prompts; policies are never implicitly disabled.
- Activation ids are unique within an extension and every contribution reference is validated at registry build time.
- Tool names are unique across the enabled common and native contributions for each engine.
- OpenClaw remains on its legacy plugin path and is not part of this abstraction.
- PI scheduled sessions use the same file and shell path-access behavior as interactive PI sessions. Session mode is retained only for scheduled-specific extensions and prompts, not as a filesystem boundary.

## Runtime diagnostics

Framework logs use the stable `[agent-extension]` prefix and structured fields. Important events include `build.start`, `build.completed`, `registry.diagnostic`, `activation.evaluated`, `activation.restored`, `activation.failed`, `tools.activated`, `native.build.*`, `tool.execute.*`, `policy.before.denied`, and `prompt.build.completed`. These framework events exclude inputs and prompt bodies. PI additionally emits one `[pi-core] turn.prompt.final` diagnostic per user turn: searchable metadata stays on the JSON header, followed by clearly delimited, unescaped multiline system and user prompt sections for runtime verification. Treat the local log as business-sensitive data.

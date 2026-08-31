# SClaw Agent Extension Architecture

SClaw business extensions are compiled into the desktop application and registered through a static allowlist. The framework does not discover project `.pi/extensions`, load arbitrary local packages, or expose a public third-party plugin API.

## Layers

1. A common extension definition declares TypeBox tool schemas, tool handlers, prompt contributions, and before/after-tool policies without importing an engine SDK.
2. Capability tokens inject host-owned services without coupling business code to Electron singletons or transport details.
3. Session, turn, and tool-call state scopes normalize lifecycle differences between engines.
4. The Claude adapter compiles common tools to an in-process MCP server and policies to Claude hooks.
5. The Pi adapter compiles the same definitions to `InlineExtension`, `registerTool`, and Pi lifecycle events.

Adapters must also populate the engine-neutral runtime environment used by common policies. `commandShell` is mandatory (`bash` or `powershell`), and tool events carry a semantic `toolKind` (`shell`, `filesystem`, or `other`) so common extensions never branch on engine names or engine-specific tool names. Scheduled-task permission, workspace, workflow, and root-restriction behavior is declared through each `EngineAdapter.scheduledTaskCapabilities` entry.

The production common allowlist is `SCLAW_AGENT_EXTENSIONS` in `electron/agent-extensions/registry.ts`. Each adapter materializes its own engine registry and attaches only its native contributions, preventing Claude native code from entering the PI worker bundle and vice versa. Migrated entries currently include the PI-only `claw-scheduled-path-guard`, the cross-engine `sto-browser-tool` and `sto-scheduled-task-tool`, the currently Claude-enabled `sto-workflow-tool`, and the cross-engine `sto-dingtalk-send-guard` and `sto-user-skill-tool`. Host-owned operations are exposed through typed capabilities backed by the local Host API, keeping authentication and process-local services outside extension business code.

`sto-workflow-tool` is implemented entirely with common definitions, TypeBox schemas, policies, prompts, and a `StoWorkflowPort`; it no longer depends on Claude SDK types. Its definition remains filtered to Claude because the local workflow execution bridge does not yet support PI. Enabling PI later requires adding PI runtime support and then widening the engine selector, rather than copying the workflow implementation.

`sto-dingtalk-send-guard` is a common Claude/PI policy and prompt extension, not a message-sending tool. It consumes one-shot mention context through a typed Host API capability, normalizes `dws chat message send` shell input, blocks unsafe batch or local-path sends, and centralizes rate-limit/dedup state in Main. OpenClaw keeps its legacy plugin implementation until that engine is removed.

Its guidance prompt uses session-scoped activation. Explicit DingTalk keywords, oral send intent such as “发给…”, or non-destructively detected pending mention context activate it; the pending context is consumed only while building the activated prompt. Once active, follow-up turns remain active for the session. The before/after-tool safety policy is deliberately not activation-gated, so a direct `dws chat message send` call is still normalized and guarded even when no prompt contribution was loaded.

`sto-user-skill-tool` exposes the common `save_user_skill` tool to Claude and Pi through a typed `StoUserSkillPort`. Its tool and guidance prompt activate for user-skill creation/update intent and remain available for session follow-ups. Its common policy is always active: direct writes to engine/workspace/skills-store directories are denied, while post-tool detection schedules a best-effort Main-owned orphan import through the Host API. OpenClaw retains its legacy plugin until that engine is removed.

`sto-browser-tool` exposes the six `bridge_*` operations through a common `StoBrowserBridgePort`; it is a Host API adapter for the existing Main-owned Browser Bridge and embed driver, not a second browser implementation. Embed app sessions and scheduled executions activate it automatically, while ordinary interactive sessions use sticky intent activation. Embed tool calls require an explicit `embed-<runtimeId>` session id, and ordinary calls without an id select only an external Browser Bridge session so another app's embed preview cannot be chosen accidentally. The shared prompt permits either `bridge_*` or an independently available `ba_*` flow for multi-step work but prohibits mixing them in one task, removing the former Claude prompt conflict. OpenClaw retains `sto-browser-bridge` until that engine is removed.

## On-demand activation

Common tools and prompts may reference an activation declared by their owning extension. Contributions without an activation remain enabled by default, preserving compatibility. An activation matcher receives only the engine-neutral build context and may use either `turn` scope or sticky `session` scope. Session matches are stored in the framework state manager, so follow-up prompts do not need to repeat the original keywords; deleting or shutting down the engine session clears that state.

Activation is contribution-level rather than extension-level. Policies remain always active, and scheduled execution prompts can remain unconditional while interactive management tools are lazy. Matcher failures fail closed for the affected tool or prompt and emit `ACTIVATION_MATCH_FAILED` without logging the user prompt.

Claude evaluates activation before compiling common tools, so an inactive tool does not create an MCP server or contribute its schema. Pi must include every registered tool in the permanent `createAgentSession.tools` allowlist because the SDK removes omitted tools from its registry; immediately after session creation or resource reload, SClaw resets the active set to built-ins plus non-lazy tools. On a matching `before_agent_start`, the adapter additively enables the group through `setActiveTools()`. PI resource reloads preserve the framework's session-scoped activation cache, while a real session shutdown clears it. This preserves follow-up availability while avoiding inactive tool schemas in ordinary model requests.

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
- Missing capabilities disable the affected extension and emit a diagnostic.
- Before-tool policy exceptions fail closed; after-tool observers and prompt contributors fail independently and are logged.
- Activation matcher exceptions fail closed for the affected tools/prompts; policies are never implicitly disabled.
- Activation ids are unique within an extension and every contribution reference is validated at registry build time.
- Tool names are unique across the enabled common and native contributions for each engine.
- OpenClaw remains on its legacy plugin path and is not part of this abstraction.
- PI scheduled path checks canonicalize candidates through `realpath`/`relative`, recognize Windows and POSIX absolute paths, and fail closed for shell-expanded paths that cannot be proven to remain under configured roots.

## Runtime diagnostics

Framework logs use the stable `[agent-extension]` prefix and structured fields. Important events include `build.start`, `build.completed`, `registry.diagnostic`, `activation.evaluated`, `activation.restored`, `activation.failed`, `tools.activated`, `native.build.*`, `tool.execute.*`, `policy.before.denied`, and `prompt.build.completed`. These framework events exclude inputs and prompt bodies. PI additionally emits one `[pi-core] turn.prompt.final` diagnostic per user turn containing the final system and user prompt for runtime verification; treat the local log as business-sensitive data.

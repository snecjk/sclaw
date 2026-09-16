# Vendor: openclaw-weixin

## Provenance

| Field | Value |
| --- | --- |
| Upstream package | `@tencent-weixin/openclaw-weixin` |
| Snapshot version (package.json) | `2.4.9-beta.0` |
| License | MIT (see `LICENSE`) |
| Ingested into | `electron/message-channel/weixin/runtime/vendor/openclaw-weixin-main/` |

This tree is a **source snapshot** for StoClaw Weixin Worker transport. It is **not** loaded as an OpenClaw Gateway channel plugin.

## StoClaw Phase 0 patches

Replaced `openclaw/plugin-sdk` **value** imports on the thin transport path with local shims:

| File | Was | Now |
| --- | --- | --- |
| `src/util/logger.ts` | `resolvePreferredOpenClawTmpDir` from plugin-sdk | `src/shims/infra-runtime.ts` |
| `src/auth/pairing.ts` | `withFileLock` from plugin-sdk | `src/shims/infra-runtime.ts` |
| `src/auth/accounts.ts` | `normalizeAccountId` from plugin-sdk | `src/shims/account-id.ts` |

Still present (acceptable for Phase 0):

- `import type` from `openclaw/plugin-sdk/*` (compile-time only; erased at runtime).
- Dynamic `import("openclaw/plugin-sdk/config-runtime")` inside `triggerWeixinChannelReload` — **not called** by thin transport / spike.
- Plugin entry files (`index.ts`, `channel.ts`, `process-message.ts`, hooks) remain in the tree for reference but are **out of thin-path import graph**.

## Do not use

- `openclaw.plugin.json` / Gateway extension registration
- npm plugin install path (`ensureWeChatPluginInstalled`)

## Runtime ownership

Runnable code lives in `../transport/` (+ Host under `message-channel/weixin/`). Vendor is reference + thin API reuse until logic is copied into `transport/`.

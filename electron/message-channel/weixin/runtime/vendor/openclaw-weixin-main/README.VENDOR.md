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

## Thin import graph (StoClaw production)

Only these vendor files are imported by Host Worker transport/adapter:

| Vendor path | Imported by |
| --- | --- |
| `src/api/api.ts` (+ deps) | `runtime/transport/client-v1.ts` |
| `src/api/types.ts` | `runtime/transport/client-v1.ts` |
| `src/cdn/upload.ts` / `src/cdn/pic-decrypt.ts` | `runtime/adapter/encode-outbound-media.ts` / `download-inbound-media.ts` |
| `src/media/mime.ts` | outbound/inbound media adapters |

Everything else in this tree is reference / unused by the thin path.  
`package-lock.json`、`.github/`、`*.test.ts` 已从源树去掉；安装包 `dist-electron/weixin-runtime/` 仅含 `worker-entry.js` + `package.json`（after-pack 白名单校验）。

## Do not use

- `openclaw.plugin.json` / Gateway extension registration
- npm plugin install path (`ensureWeChatPluginInstalled`)

## Runtime ownership

Runnable code lives in `../transport/` (+ Host under `message-channel/weixin/`). Vendor is reference + thin API reuse until logic is copied into `transport/`.

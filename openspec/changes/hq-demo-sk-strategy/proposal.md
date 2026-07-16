# HQ Demo SK Strategy

## Summary

When HQ users switch to a site account for demonstration, the session identity becomes the site user but AI resources (SK, models, inference gateway, quota) remain on the HQ account via `DemoSkStrategy`.

## Auth modes

| Mode | Condition | AI strategy |
|------|-----------|-------------|
| `native-hq` | HQ login, no impersonation | `HqSkStrategy` |
| `native-site` | Site login | `SiteSkStrategy` |
| `hq-demo-as-site` | HQ switched to site | `DemoSkStrategy` → HQ |

## Design notes

- Session token (`~/.sai/sso-auth.json`): site token after switch (business APIs)
- AI token: `impersonationOrigin.stoToken` for memory-center ensure/quota
- OpenClaw `sso-auth.json`: session site user (unchanged)
- Models page quota UI uses `resolveAiResourceIsSite()` (HQ UI in demo mode)

## Tasks

- [x] `sto-auth-mode.ts` + `shared/auth-mode-utils.ts`
- [x] `sto-memory-api-fetch.ts` session vs AI token
- [x] `DemoSkStrategy` + factory priority
- [x] `sto-model-sync` aiUser for secret
- [x] `auth-setup-orchestrator` demo SK refresh
- [x] Models page dual-track UI
- [x] Unit tests

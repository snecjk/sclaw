## Why

SSO can finish and persist a valid session while the Login page remains on “logging in”. The login response currently waits for runtime setup, so slow model, Agent, Apollo, SK, or Gateway work leaves Main authenticated while Renderer is still pending.

## What Changes

- Complete login after access validation and durable session persistence
- Run post-login runtime setup in an observed background pipeline
- Recover a committed session after a lost or timed-out login response
- Make authorization-code exchange single-flight for each SSO attempt
- Add regression coverage and diagnostics

## Capabilities

### New Capabilities

- `auth-session-completion`: Reliable coordination of SSO completion, persisted authentication, renderer state, and runtime setup

### Modified Capabilities

<!-- No existing authentication capability spec is present. -->

## Impact

- `electron/api/routes/auth.ts`
- `electron/utils/sso-login.ts`
- `src/stores/auth.ts`
- Authentication unit tests
- No visual or theme changes

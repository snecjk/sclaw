## Context

The login route persists the user and then waits for configuration, SK, model, Agent, and Gateway setup. Renderer only marks the user authenticated after that response and another metadata request. This couples identity establishment to runtime readiness.

## Goals / Non-Goals

**Goals:** promptly expose an authorized durable session, preserve background setup, recover lost responses, and prevent duplicate code exchange.

**Non-Goals:** redesign Login, remove runtime setup, or add a renderer-to-Gateway transport.

## Decisions

### 1. Respond at the authentication boundary

- **Decision**: Validate access, persist the user, schedule setup, and respond without awaiting setup.
- **Rationale**: Authentication and runtime readiness have different correctness boundaries.
- **Alternative considered**: Increase setup timeouts. Rejected because the false dependency remains.

### 2. Keep access validation synchronous

- **Decision**: Access validation MUST precede persistence and success.
- **Rationale**: Unauthorized users must never receive a committed session.
- **Alternative considered**: Persist and revoke later. Rejected because it creates an authorization window.

### 3. Reuse the serialized setup orchestrator

- **Decision**: Run existing setup in one observed background task.
- **Rationale**: It preserves ordering and Gateway/config coordination.
- **Alternative considered**: Launch setup operations independently. Rejected because mutations can race.

### 4. Recover once after transport failure

- **Decision**: Query `/api/auth/status` after a login request error before displaying that error.
- **Rationale**: It repairs a lost response without polling during QR scanning.
- **Alternative considered**: Continuous polling. Rejected due to unnecessary access checks and traffic.

### 5. Claim the SSO callback once

- **Decision**: Only the first callback notification starts code exchange.
- **Rationale**: Electron can expose one redirect through several hooks before async exchange finishes.
- **Alternative considered**: Use only the settled flag. Rejected because it changes too late.

## Risks / Trade-offs

- **[Risk]** Home opens before runtime refresh finishes. → **Mitigation**: Existing readiness UI and setup continue independently.
- **[Risk]** Background errors are not returned by login. → **Mitigation**: Log scheduled, completed, failed, and elapsed states.
- **[Risk]** Status recovery repeats access validation. → **Mitigation**: Run it only after transport failure.

## UI and Theme

No visual state or hardcoded color is added. Existing light/dark behavior remains aligned with `docs/sto-design.md`.

## ADDED Requirements

### Requirement: Authentication completion is independent from runtime initialization

The system SHALL complete login after access is allowed and the user is durably persisted, and MUST NOT delay success for runtime initialization.

#### Scenario: Runtime initialization is slow
- **WHEN** authentication is committed while model, Agent, Apollo, SK, or Gateway work remains
- **THEN** the endpoint SHALL return the authenticated user without waiting for that work

#### Scenario: Client access is denied
- **WHEN** client access validation denies the SSO user
- **THEN** the system MUST NOT persist or return an authenticated session

### Requirement: Post-login initialization continues in the background

The system SHALL schedule existing authenticated setup after session commit and MUST observe completion or failure without an unhandled rejection.

#### Scenario: Background setup fails
- **WHEN** post-login setup rejects
- **THEN** the authenticated session SHALL remain valid and the failure MUST be logged

### Requirement: Renderer recovers committed authentication after transport failure

The renderer SHALL query authoritative status after a login request error and MUST apply an authenticated status before displaying the transport error.

#### Scenario: Response is lost after persistence
- **WHEN** login throws after Main persisted a valid session
- **THEN** Renderer SHALL mark the user authenticated and clear the pending state

#### Scenario: Recovery is unavailable
- **WHEN** login throws and status is unauthenticated or unavailable
- **THEN** Renderer SHALL clear pending state and display the original error

### Requirement: SSO authorization-code exchange is single-flight

The SSO manager MUST exchange at most one code for each active login attempt.

#### Scenario: Multiple hooks observe one callback
- **WHEN** multiple callback notifications arrive before exchange completes
- **THEN** the manager SHALL execute one exchange and settle once

### Requirement: Existing Login appearance remains compatible with dark mode

The Login page SHALL preserve readable semantic text, backgrounds, borders, focus, and disabled states in dark mode.

#### Scenario: Login is pending in dark mode
- **WHEN** SSO login starts in dark mode
- **THEN** the pending presentation SHALL remain consistent with `docs/sto-design.md`

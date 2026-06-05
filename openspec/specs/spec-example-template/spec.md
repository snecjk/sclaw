## Purpose

Provide reusable templates for the three most common StoClaw change scenarios to ensure consistency and enforce AGENTS.md constraints.

## Requirements

### Requirement: Templates cover the three primary StoClaw change scenarios
The system SHALL provide dedicated spec templates for new Renderer pages, new Electron main-process capabilities, and UI component enhancements.

#### Scenario: Adding a new page
- **WHEN** a change involves adding a new page to the StoClaw application
- **THEN** the template for "New Renderer Page" SHALL be available
- **AND** the template SHALL include placeholders for route registration, page component, store slice, and host-api integration

#### Scenario: Adding a main-process API
- **WHEN** a change involves adding a new Electron main-process API
- **THEN** the template for "New Electron Main-Process Capability" SHALL be available
- **AND** the template SHALL include placeholders for main-process handler, IPC channel definition, preload API exposure, and renderer host-api wrapper

#### Scenario: Enhancing a UI component
- **WHEN** a change involves adding or modifying a React component without main-process communication
- **THEN** the template for "UI Component Enhancement" SHALL be available
- **AND** the template SHALL include placeholders for component props, hooks, and unit tests

### Requirement: Templates enforce project-specific architecture constraints
Every template SHALL include mandatory reminders of StoClaw-specific constraints derived from AGENTS.md.

#### Scenario: Using the main-process API template
- **WHEN** a developer uses the "New Electron Main-Process Capability" template
- **THEN** the template SHALL contain a mandatory reminder that renderer code MUST NOT call `window.electron.ipcRenderer.invoke` directly
- **AND** the template SHALL require that all main-process calls go through `src/lib/host-api.ts` and `src/lib/api-client.ts`

#### Scenario: Using the page template
- **WHEN** a developer uses the "New Renderer Page" template
- **THEN** the template SHALL contain a reminder that Gateway HTTP endpoints MUST NOT be called directly from renderer code
- **AND** the template SHALL require using Main-process proxy channels (`hostapi:fetch`, `gateway:httpProxy`)

### Requirement: Templates include build and test integration reminders
Every template SHALL include a section reminding the implementer to update relevant build, lint, and test commands.

#### Scenario: Completing implementation from a template
- **WHEN** a developer finishes implementing from any template
- **THEN** the template SHALL remind them to run `pnpm run lint`, `pnpm run typecheck`, and relevant unit tests
- **AND** for communication-related changes, the template SHALL remind them to run `pnpm run comms:replay` and `pnpm run comms:compare`

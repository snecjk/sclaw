# service-dev-server

## ADDED Requirements

### Requirement: Dev server lifecycle management
The Main process SHALL manage user project dev servers through a central registry supporting start, stop, and status query per app, spawning Vite with the managed Node runtime environment and an automatically allocated free port.

#### Scenario: Start dev server
- **WHEN** a start is requested for an app whose dependencies are installed
- **THEN** the manager SHALL allocate a free port, spawn the dev server with the managed Node on PATH, and probe the port via HTTP until ready
- **AND** SHALL notify the renderer with the preview URL once the probe succeeds

#### Scenario: Port collision avoidance
- **WHEN** two apps run dev servers concurrently
- **THEN** each SHALL receive a distinct free port

### Requirement: Log capture and crash recovery
The manager SHALL capture stdout/stderr into a bounded in-memory buffer per app, and SHALL restart a crashed dev server with exponential backoff, escalating to agent diagnosis after repeated failures.

#### Scenario: Dev server crashes
- **WHEN** the dev server process exits unexpectedly
- **THEN** the manager SHALL restart it with backoff up to a bounded retry count
- **AND** after retries are exhausted, SHALL surface the captured log to the project agent for diagnosis

### Requirement: Process cleanup on shutdown
The manager SHALL terminate all managed dev server process trees when the app quits or when the owning workbench/app is closed, leaving no orphan processes.

#### Scenario: App quit
- **WHEN** SClaw quits (including `before-quit`)
- **THEN** every managed dev server process tree SHALL be terminated

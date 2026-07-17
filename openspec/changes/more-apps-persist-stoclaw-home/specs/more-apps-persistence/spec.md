## ADDED Requirements

### Requirement: More Apps registry persists under user home

The system SHALL persist the More Apps user registry (external apps, installed IDs, and favorite IDs) as a JSON document under `~/.stoclaw/more-apps/` in the Main process, not in renderer `localStorage` as the source of truth.

#### Scenario: Restart keeps installed external apps

- **WHEN** the user has added an external app and restarts StoClaw without deleting `~/.stoclaw`
- **THEN** the external app SHALL still appear in the More Apps installed/market lists after hydrate

#### Scenario: Reinstall keeps registry when home config remains

- **WHEN** the user reinstalls the StoClaw application binary but `~/.stoclaw/more-apps/` is unchanged
- **THEN** the persisted external apps, installed IDs, and favorite IDs SHALL still load

### Requirement: Renderer accesses registry via host-api

The renderer MUST read and write the More Apps registry through host-api (`hostApiFetch` / `src/lib/host-api.ts` entry points). Pages and components MUST NOT call `window.electron.ipcRenderer.invoke` directly for this data, and MUST NOT treat `localStorage` as the durable source of truth after migration.

#### Scenario: Load registry

- **WHEN** the More Apps store hydrates
- **THEN** it SHALL request the registry from a Main-owned host-api route and update in-memory state from the response

#### Scenario: Save registry

- **WHEN** the user adds, updates, removes, installs, uninstalls, or favorites an app
- **THEN** the renderer SHALL persist the updated registry via host-api to Main disk storage

### Requirement: One-time localStorage migration

The system SHALL support a one-time migration that imports legacy `stoclaw:more-apps:external`, `stoclaw:more-apps:installed`, and `stoclaw:more-apps:favorites` values into the home-directory registry when the on-disk registry is empty, and SHALL clear those localStorage keys after a successful import.

#### Scenario: Empty disk imports localStorage

- **WHEN** on-disk More Apps registry is empty (or missing) and the renderer still has legacy localStorage data
- **THEN** Main SHALL write that data to `~/.stoclaw/more-apps/` and the renderer SHALL remove the legacy keys

#### Scenario: Non-empty disk is not overwritten by migration

- **WHEN** on-disk More Apps registry already contains data and the renderer posts a migrate payload
- **THEN** Main MUST NOT overwrite the on-disk registry with the migrate payload

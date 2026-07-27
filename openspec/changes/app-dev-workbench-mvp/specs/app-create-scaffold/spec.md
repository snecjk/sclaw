# app-create-scaffold

## ADDED Requirements

### Requirement: One-step app creation wizard
The system SHALL provide an app creation wizard collecting app name, project type (frontend / frontend+backend), and target directory (with a sensible default such as `~/SClawApps/<name>`), and SHALL complete local initialization within seconds without waiting for dependency installation.

#### Scenario: Successful creation
- **WHEN** the user submits the wizard with a valid name and directory
- **THEN** the system SHALL copy the built-in template into the target directory, run `git init` with an initial commit (when git is available), create a workspace via session-catalog, and ensure the project agent
- **AND** SHALL navigate the user to the workbench immediately while `npm install` continues in the background

#### Scenario: Target directory already exists and is non-empty
- **WHEN** the chosen target directory exists and is not empty
- **THEN** the wizard SHALL block creation and show a clear message asking the user to pick another location

#### Scenario: Wizard theming
- **WHEN** the wizard is displayed in light or dark mode
- **THEN** all surfaces, text, borders, focus/hover/disabled states SHALL use semantic theme tokens per docs/sto-design.md with readable contrast in both modes

### Requirement: Monorepo template content
The template SHALL produce a monorepo layout containing `frontend/` (React + Vite + TypeScript), a placeholder `backend/`, `docs/api/` for company API markdown docs, and a root `.npmrc` pointing at the company snpm registry, without modifying any user-global configuration.

#### Scenario: Template instantiation
- **WHEN** the template is copied for a new app
- **THEN** app-specific values (app name) SHALL be substituted in `package.json` and the index page
- **AND** the generated `.npmrc` SHALL set the snpm registry so that background install works without VPN

### Requirement: Background dependency installation
The system SHALL run `npm install` in the background using the managed Node runtime with `npm_config_cache` pointed at `~/.stoclaw/npm-cache`, reporting phase progress (environment preparing / installing / starting / ready) to the workbench as one continuous progress indication.

#### Scenario: Install failure
- **WHEN** `npm install` exits non-zero
- **THEN** the workbench SHALL show a non-technical error state with a retry action
- **AND** the raw log SHALL be available to the agent for diagnosis, not surfaced to the user by default

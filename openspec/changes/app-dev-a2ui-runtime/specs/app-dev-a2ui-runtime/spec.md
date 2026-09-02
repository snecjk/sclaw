## ADDED Requirements

### Requirement: A2UI page assets drive preview
The default user-app template SHALL render the active page from A2UI v0.9 message assets under `pages/`, using `@a2ui/react` and `@a2ui/web_core`, without requiring hand-written business JSX for standard CRUD preview.

#### Scenario: Load home page messages
- **WHEN** a newly created app starts the Vite preview
- **THEN** the host MUST process `pages/home.page.json` through `MessageProcessor` and render at least one A2UI surface

#### Scenario: AI edits page asset only
- **WHEN** the page layout must change for a standard list/form/detail request
- **THEN** the supported workflow MUST be editing `pages/*.page.json` (and contracts), not replacing the runtime host

### Requirement: Single-package app root
New apps created from the default template MUST be a single frontend package with root `package.json`, `src/`, and `index.html` (no required `frontend/` subdirectory).

#### Scenario: Validate template
- **WHEN** SClaw prepares the default engineering template
- **THEN** it MUST accept a directory that contains root `package.json` as a valid template

#### Scenario: Dev server cwd
- **WHEN** the workbench starts the preview server for a single-package app
- **THEN** npm MUST run with cwd at the app root that contains `package.json`

### Requirement: Dark-mode readable host chrome
The A2UI host shell chrome (page background, primary text, borders) MUST use CSS variables with light and dark values so preview text remains readable in both modes.

#### Scenario: Dark background contrast
- **WHEN** the user OS or host prefers dark color scheme
- **THEN** the welcome/host background and foreground MUST switch via semantic CSS variables (not light-only hardcoded white fills)

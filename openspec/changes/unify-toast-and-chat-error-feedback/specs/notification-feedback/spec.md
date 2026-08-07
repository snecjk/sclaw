## ADDED Requirements

### Requirement: Toast anchors to main content top-center

Global Sonner toasts SHALL appear at the horizontal center of the visible main-content region and near its top, not the full window including the sidebar. Horizontal offset SHALL be derived from AppShell `effectiveSidebarWidth` (and any shell-exported L0 gutter), and SHALL NOT hard-code `72` or `260` as the width source. When no sidebar is present, toasts MUST center on the viewport (`effectiveSidebarWidth = 0`).

#### Scenario: Expanded sidebar centers on main content

- **WHEN** the sidebar is effectively expanded and a toast is shown
- **THEN** the toast horizontal center MUST be offset from viewport center by half of (`effectiveSidebarWidth` + shell gutter if applicable)

#### Scenario: Provincial collapsed recenters with zero sidebar width

- **WHEN** the provincial sidebar is effectively collapsed
- **THEN** the toast position MUST recompute using `effectiveSidebarWidth = 0` (NOT the full-legacy `72px` rail width)

#### Scenario: Full legacy collapsed rail

- **WHEN** `layoutVariant` is `full` and the sidebar is collapsed to the 72px rail
- **THEN** the toast offset MUST use `effectiveSidebarWidth = 72` from the AppShell snapshot (still not a hard-coded parallel formula in Toaster)

#### Scenario: No-sidebar routes

- **WHEN** the current route has no sidebar (login, setup, sprite, float-icon, provincial Settings)
- **THEN** the toaster MUST use viewport `50%` horizontal center (`effectiveSidebarWidth = 0`)

### Requirement: Four semantic toast surfaces

Each toast type MUST render with its design-spec background, border, border-radius, and icon color. The CSS overrides use `globals.css` semantic variables and `.sto-global-toaster` namespace selector.

| type | bg | border | icon | radius |
| --- | --- | --- | --- | --- |
| info / normal / default | `--sto-toast-info-bg` | `--sto-toast-info-border` | `--sto-toast-info-icon` | 8px |
| warning | `--sto-toast-warning-bg` | `--sto-toast-warning-border` | `--sto-toast-warning-icon` | 8px |
| error | `--sto-toast-error-bg` | `--sto-toast-error-border` | `--sto-toast-error-icon` | 8px |
| success | `--sto-toast-success-bg` | `--sto-toast-success-border` | `--sto-toast-success-icon` | 10px |

### Requirement: Preserve existing Sonner behaviors

Sonner styled structure is preserved (richColors enabled). Title, description, action, cancel, close button, loading, and promise behaviors MUST NOT regress. Sonner built-in status icons are used; custom Lucide icons are not substituted.

## ADDED Requirements

### Requirement: Toast anchors to main content top-center

Global Sonner toasts SHALL appear at the horizontal center of the visible main-content region and near its top, not the full window including the sidebar. When no sidebar is present, toasts MUST center on the viewport.

#### Scenario: Expanded sidebar centers on main content

- **WHEN** the sidebar is expanded and a toast is shown
- **THEN** the toast horizontal center MUST be offset from viewport center by half the sidebar width

#### Scenario: Collapsed sidebar recenters

- **WHEN** the sidebar collapses
- **THEN** the toast position MUST recompute from the current sidebar collapsed width (72px)

#### Scenario: No-sidebar routes

- **WHEN** the current route has no sidebar (login, setup, sprite)
- **THEN** the toaster MUST use viewport `50%` horizontal center

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

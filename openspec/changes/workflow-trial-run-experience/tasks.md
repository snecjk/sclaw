## 1. StoClaw State Contract

- [x] 1.1 Extend the Host workflow bridge state type, validators, and message tests with `cancelled`, `failed`, and `completed`, while retaining the authenticated envelope and stale-message rejection (Requirement: Trial-run bridge state remains authenticated and current)
- [x] 1.2 Add a focused local-run-to-display-state mapper for starting, active, waiting, cancelled, failed, timeout, interrupted, and completed statuses (Requirement: Trial-run terminal state is synchronized to the embedded header)
- [x] 1.3 Update embedded trial-run coordination to send stable terminal states, release completed requests, preserve current run identity, and reset only on a new workflow/iframe session (Requirement: Trial-run terminal state is synchronized to the embedded header; Requirement: Trial-run bridge state remains authenticated and current)
- [x] 1.4 Add unit tests for terminal mapping, terminal persistence, old request/run rejection, workflow switch reset, and launch-error separation from runtime failure (Requirement: Trial-run terminal state is synchronized to the embedded header; Requirement: Trial-run bridge state remains authenticated and current)

## 2. Drawer Lifecycle and Safe Rerun

- [x] 2.1 Separate drawer close from confirmation cancellation so closing a running drawer only updates visibility and never sends `idle` or stops the run (Requirement: Trial-run lifecycle is independent from drawer visibility)
- [x] 2.2 Route embedded cancelled `继续运行` to the existing save-before-rerun coordinator and create a new run instead of calling `resumeWorkflowRun` for the cancelled run (Requirement: Cancelled continue starts a new complete trial run)
- [x] 2.3 Preserve the cancelled history record and test that continue uses a new request and new run ID, including save/preparation failure paths (Requirement: Cancelled continue starts a new complete trial run)
- [x] 2.4 Test close-while-running, terminal-after-close, reopen/history access, workflow switch, and late-event isolation (Requirement: Trial-run lifecycle is independent from drawer visibility)

## 3. Compact Trial-Run Drawer

- [x] 3.1 Split shared result presentation into explicit trial and detail modes while retaining shared timeline, artifact, version, and status adapters (Requirement: Trial and detail drawer presentations are isolated)
- [x] 3.2 Implement the 500px responsive trial drawer with 52px header, 12px body insets, 476×42px status row, bordered 10–12px cards, and fixed 60px action footer containing a full-width 36px-high, 10px-radius primary button (Requirement: Trial-run mode uses the approved compact result drawer)
- [x] 3.3 Implement running, cancelled, failed, completed-process-collapsed, and completed-process-expanded visual states; preserve prior events in non-success terminals and place the collapsed process control in the completed status row (Requirement: Trial-run mode uses the approved compact result drawer)
- [x] 3.4 Implement the approved dot-and-line timeline geometry, right-aligned timestamps, indented details, internal thin scrolling, and artifact header expand/open/download controls (Requirement: Trial-run mode uses the approved compact result drawer)
- [x] 3.5 Preserve approval and supplemental-input controls inside the running process area with validation, keyboard focus, and non-color feedback (Requirement: Interactive waiting states remain operable in the compact drawer)
- [x] 3.6 Reuse existing i18n namespaces or add localized strings for every new or changed user-visible label; do not add unlocalized JSX copy (Requirement: Trial-run mode uses the approved compact result drawer)
- [ ] 3.7 Add component tests for all five approved visual states, footer geometry, completion expansion, timeline alignment, artifact actions, long output, empty artifacts, waiting states, narrow width, and detail-mode regression (Requirement: Trial-run mode uses the approved compact result drawer; Requirement: Interactive waiting states remain operable in the compact drawer; Requirement: Trial and detail drawer presentations are isolated)

## 4. memory-center-web Terminal Header State

- [x] 4.1 Extend Web bridge types, validators, and controller tests with `cancelled`, `failed`, and `completed`, separating active request identity from retained display state (Requirement: Trial-run terminal state is synchronized to the embedded header; Requirement: Trial-run bridge state remains authenticated and current)
- [x] 4.2 Render running, cancelled, failed, and completed status badges in the existing approved header without reordering or redesigning its normal controls (Requirement: Trial-run terminal state is synchronized to the embedded header)
- [x] 4.3 Allow a new trial-run request after a stable terminal state while rejecting duplicate and stale request IDs (Requirement: Trial-run bridge state remains authenticated and current)
- [x] 4.4 Add Web component/controller tests for all status labels, retained terminal state, new-request transition, standalone behavior, icon-plus-text semantics, and capability fallback (Requirement: Trial-run terminal state is synchronized to the embedded header; Requirement: Trial and detail drawer presentations are isolated)

## 5. Theme, Accessibility, and Visual QA

- [x] 5.1 Implement drawer and header status styling with Brand, Success, Warning, Danger, Text, Fill, and Border semantic tokens from `docs/sto-design.md`; check changed components for hardcoded light-only colors (Requirement: Trial-run terminal state is synchronized to the embedded header; Requirement: Trial-run mode uses the approved compact result drawer)
- [ ] 5.2 Verify light/dark backgrounds, text, borders, icons, focus-visible, hover, disabled, loading, empty, and error states (Requirement: Trial-run terminal state is synchronized to the embedded header; Requirement: Trial-run mode uses the approved compact result drawer)
- [ ] 5.3 Verify keyboard operation, Esc/close behavior, status icon-plus-text semantics, reduced motion, long text, 500px target width, and narrow-window max-width behavior (Requirement: Trial-run mode uses the approved compact result drawer; Requirement: Interactive waiting states remain operable in the compact drawer)
- [ ] 5.4 Capture implementation screenshots and compare them side by side with all five approved views from MasterGo node `48:46129`, checking title/header, notice, status row, timeline, timestamps, card borders/radii, completion collapsed/expanded hierarchy, artifact icons, scrollbars, footer, and button geometry while preserving the already approved header structure (Requirement: Trial-run mode uses the approved compact result drawer; Requirement: Trial-run terminal state is synchronized to the embedded header)

## 6. Cross-Project Verification and Documentation

- [ ] 6.1 Run focused StoClaw unit tests, typecheck, and targeted lint for bridge, coordinator, route, drawer, approval/input, and detail-mode changes (Requirement: Trial-run bridge state remains authenticated and current; Requirement: Trial and detail drawer presentations are isolated)
- [x] 6.2 Run focused memory-center-web protocol, controller, header, typecheck, and lint verification (Requirement: Trial-run terminal state is synchronized to the embedded header; Requirement: Trial-run bridge state remains authenticated and current)
- [x] 6.3 Run `pnpm run comms:replay` and `pnpm run comms:compare` in StoClaw because iframe state delivery changes (Requirement: Trial-run bridge state remains authenticated and current)
- [ ] 6.4 Manually verify running-close-background-complete, cancel-continue-new-run, failed-rerun, completed process/artifact accordions, waiting approval/input, workflow switch, stale message, light/dark, macOS, and Windows flows (Requirement: Trial-run lifecycle is independent from drawer visibility; Requirement: Cancelled continue starts a new complete trial run; Requirement: Interactive waiting states remain operable in the compact drawer)
- [x] 6.5 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` in affected repositories and update them only if the behavior or bridge contract is user- or integrator-visible (Requirement: Trial-run terminal state is synchronized to the embedded header)
- [x] 6.6 Confirm no `memory-center` production code, terminal lock, package manifests, lockfiles, build scripts, packaging configuration, or CI/CD files changed (Requirement: Cancelled continue starts a new complete trial run)

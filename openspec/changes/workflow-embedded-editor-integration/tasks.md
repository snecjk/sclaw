## 1. Backend Version Contract

- [ ] 1.1 Extend `memory-center/tests/core/test_workflow_version_history.py` to assert that saving an existing draft returns the same `versionId`, `versionStatus=draft`, and normalized `schemaVersion` (Requirement: Trial run persists the current canvas before execution)
- [ ] 1.2 Extend the published-version save case to assert that a new draft is created without changing `activeVersionId` or `activeVersionStatus` (Requirement: Trial run persists the current canvas before execution)
- [ ] 1.3 Run the focused backend workflow-version suite and record the result; do not modify production APIs unless these existing semantics fail (Requirement: Trial run persists the current canvas before execution)

## 2. Web Bridge Protocol and Persistence Controller

- [ ] 2.1 Extract StoClaw bridge constants, message types, builders, and validators from `WorkflowDesignerPage.tsx` into a focused protocol module (Requirement: Workflow bridge messages are authenticated and idempotent)
- [ ] 2.2 Add protocol tests for Host init, editor ready, try-run request/state, save-draft request/response/error, back request, and invalid envelope rejection (Requirement: Workflow bridge messages are authenticated and idempotent)
- [ ] 2.3 Add a pure Web bridge controller that gates capabilities, deduplicates request IDs, locks save state, forces `persistWorkflowDefinition`, and replies with the saved draft snapshot (Requirement: Trial run persists the current canvas before execution; Requirement: Save and trial-run states are coordinated)
- [ ] 2.4 Test unchanged-canvas forced save, AI lock rejection, missing version ID, duplicate request reuse, stale state rejection, and failed save recovery (Requirement: Save failures never run stale workflow content; Requirement: Embedded trial run entry is capability gated)

## 3. Web Unified Header and Navigation

- [ ] 3.1 Extract a testable `WorkflowDesignerTopbar` component containing the approved 52px left/right layout and no central version summary (Requirement: Embedded workflow editor uses one business header; Requirement: Version status is consolidated in the version list)
- [ ] 3.2 Show trial run only after `localTrialRun` capability negotiation; keep it hidden in standalone Web and disabled during AI generation, save, preparation, or running (Requirement: Embedded trial run entry is capability gated; Requirement: Save and trial-run states are coordinated)
- [ ] 3.3 Route embedded back through existing Web leave protection before sending `workflow-back-request`; preserve Web-router navigation in standalone mode (Requirement: Embedded back navigation preserves Web leave protection)
- [ ] 3.4 Apply MasterGo 52px geometry with semantic theme tokens, macOS safe area, and light/dark hover/focus/disabled coverage (Requirement: Header preserves native controls and theme accessibility)
- [ ] 3.5 Add component and controller tests proving the approved button order, title/time single row, removed version summary, standalone behavior, and theme-state hooks (Requirement: Embedded workflow editor uses one business header; Requirement: Header preserves native controls and theme accessibility)

## 4. StoClaw Bridge Session

- [ ] 4.1 Extend `src/lib/workflow-iframe-bridge.ts` with the same capability and business-message contract used by Web, retaining legacy performance and draft messages for rollout compatibility (Requirement: Workflow bridge messages are authenticated and idempotent)
- [ ] 4.2 Add Host validator tests covering origin-independent message shape checks and rejection of missing protocol, nonce, workflow ID, request ID, state, or payload fields (Requirement: Workflow bridge messages are authenticated and idempotent)
- [ ] 4.3 Extend `WorkflowMcIframeEditorHandle` with persisted-save request and try-run-state methods; send Host init on iframe load and accept editor-ready, try-run, and back events only from the expected iframe/origin (Requirement: Embedded workflow editor uses one business header; Requirement: Embedded trial run entry is capability gated)
- [ ] 4.4 Test one-pending-request behavior, 30-second timeout, late response rejection, iframe unmount cancellation, workflow switch cancellation, and handshake fallback (Requirement: Save failures never run stale workflow content; Requirement: Workflow bridge messages are authenticated and idempotent)

## 5. StoClaw Trial-Run Orchestration

- [ ] 5.1 Extract the duplicated edit/generate route trial-run preparation into a focused coordinator that preserves the current confirmation, requests persisted Web draft, and calls `beginTryRun` only after success (Requirement: Trial run requires explicit confirmation; Requirement: Trial run persists the current canvas before execution)
- [ ] 5.2 Synchronize `confirming/saving/preparing/running/error/idle` to Web and block repeated launches while a request or run is active (Requirement: Save and trial-run states are coordinated)
- [ ] 5.3 Keep saved drafts when startup inputs are cancelled, and never create a run on save error, timeout, missing version ID, or stale response (Requirement: Save failures never run stale workflow content)
- [ ] 5.4 Test cancel-before-save, save-before-begin ordering, exact version-ID forwarding, rerun persistence, duplicate click suppression, startup cancellation, and run-start failure recovery (Requirement: Trial run requires explicit confirmation; Requirement: Save failures never run stale workflow content)

## 6. StoClaw Shell and Native Chrome

- [ ] 6.1 Track `embeddedHeaderOwned` separately from `editorActive`; reset ownership on iframe fallback, workflow route change, and route unmount (Requirement: Embedded workflow editor uses one business header)
- [ ] 6.2 Hide ContentHeader and remove its body-height reservation only after the capability handshake succeeds; preserve the current fallback before readiness (Requirement: Embedded workflow editor uses one business header)
- [ ] 6.3 Reassign Windows chrome ownership to the shell overlay while the ContentHeader is hidden; preserve native macOS traffic lights (Requirement: Header preserves native controls and theme accessibility)
- [ ] 6.4 Extend shell and chrome-owner tests for new-Web/new-Host, new-Host/old-Web, Windows, macOS, light, and dark combinations (Requirement: Header preserves native controls and theme accessibility)

## 7. Cross-Project Verification and Documentation

- [ ] 7.1 Run focused backend, Web, and StoClaw test suites plus both TypeScript type checks and targeted lint checks (Requirement: Workflow bridge messages are authenticated and idempotent)
- [ ] 7.2 Run `pnpm run comms:replay` and `pnpm run comms:compare` in StoClaw because iframe request/response delivery changed (Requirement: Workflow bridge messages are authenticated and idempotent)
- [ ] 7.3 Manually verify the complete compatibility matrix, slow network, 5xx, iframe reload, duplicate messages, unchanged canvas, existing draft, published version, AI lock, and startup cancellation (Requirement: Save failures never run stale workflow content; Requirement: Embedded trial run entry is capability gated)
- [ ] 7.4 Verify MasterGo node `48:45962`, light/dark themes, keyboard focus, macOS safe area, and Windows minimize/maximize/close controls (Requirement: Header preserves native controls and theme accessibility)
- [ ] 7.5 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` in all affected repositories and update only where the embedded workflow contract is user- or integrator-visible (Requirement: Embedded workflow editor uses one business header)

# Workflow Header Handoff and Local History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove intermediate workflow header states and expose the existing Host local-run history dialog from the final Web-owned header.

**Architecture:** Host owns a three-state header negotiation boundary and keeps the iframe masked until authenticated editor readiness. The Web header sends a new authenticated local-history intent through the existing v1 bridge; Host continues to own the dialog and IPC data.

**Tech Stack:** React 19, TypeScript, Zustand, iframe `postMessage`, Vitest.

## Global Constraints

- Do not add, install, remove, or upgrade dependencies.
- Do not modify package manager, build, packaging, lockfile, CI, or release configuration.
- Preserve exact origin/source/workflowId/nonce/requestId authentication.
- Keep old-Web Host-header fallback.
- Run only focused tests plus TypeScript and scoped lint.

---

### Task 1: Extend the bridge with local-history intent

**Files:**
- Modify: `src/lib/workflow-iframe-bridge.ts`
- Modify: `src/pages/Workflow/components/workflow-iframe-session.ts`
- Modify: `src/pages/Workflow/components/workflow-mc-iframe-editor.tsx`
- Modify: `tests/unit/workflow-iframe-bridge.test.ts`
- Modify: `tests/unit/workflow-iframe-session.test.ts`
- Modify in Web repo: `src/agent-workflow/sto-claw-workflow-bridge.ts`
- Modify in Web repo: `src/agent-workflow/sto-claw-workflow-bridge-controller.ts`
- Modify in Web repo: matching bridge/controller tests

**Interfaces:**
- Produces Host capability `localRunHistory`.
- Produces message `workflow-local-run-history-request` with the existing authenticated envelope.
- Produces Web controller method `requestLocalRunHistory(): string | null`.

- [ ] Add failing tests for capability validation, message validation/builder, controller gating, and ready-only Host dispatch.
- [ ] Run the five focused test files and confirm failures identify the missing protocol.
- [ ] Add the minimum symmetric Host/Web protocol types, validators, builder, controller method, and Host callback.
- [ ] Re-run the focused tests until green.

### Task 2: Gate header handoff through an explicit negotiation state

**Files:**
- Modify: `src/stores/workflow-ui.ts`
- Modify: `src/components/layout/MainLayout.tsx`
- Modify: `src/pages/Workflow/workflow-routes.tsx`
- Modify: `src/pages/Workflow/components/workflow-mc-iframe-editor.tsx`
- Modify: `tests/unit/workflow-embedded-header-layout.test.ts`
- Modify: `tests/unit/workflow-editor-session-boundary.test.tsx`

**Interfaces:**
- Produces `embeddedHeaderOwner: 'negotiating' | 'host' | 'web'`.
- Web editor readiness transitions `negotiating -> web`.
- Load failure/timeout transitions `negotiating -> host`.

- [ ] Add failing tests proving negotiating hides Host ContentHeader and keeps editor presentation blocked until ready.
- [ ] Confirm the focused tests fail against the current boolean state.
- [ ] Replace the ambiguous boolean ownership state with the three-state owner and connect ready/reset/fallback transitions.
- [ ] Re-run the focused tests until green.

### Task 3: Add the Web topbar button and verify the small integration surface

**Files:**
- Modify in Web repo: `src/agent-workflow/components/WorkflowDesignerTopbar.tsx`
- Modify in Web repo: `src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx`
- Modify in Web repo: `src/agent-workflow/pages/WorkflowDesignerPage.tsx`
- Modify in Host repo: `src/pages/Workflow/workflow-routes.tsx`

**Interfaces:**
- Consumes `localRunHistory` and `requestLocalRunHistory()` from Task 1.
- Invokes existing Host `setLocalRunHistoryOpen(true)`.

- [ ] Add a failing Topbar test for `试运行 < 本地运行记录 < 发布` and a callback test.
- [ ] Add the capability-gated Web button and wire it to the controller.
- [ ] Wire the authenticated Host callback to the existing local-history dialog state.
- [ ] Run focused Host/Web tests, both TypeScript checks, scoped ESLint, and `git diff --check`.
- [ ] Manually verify initial loading, final single header, local-history dialog, fallback, and back navigation.


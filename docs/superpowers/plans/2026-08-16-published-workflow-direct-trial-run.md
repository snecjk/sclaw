# Published Workflow Direct Trial Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run an unchanged published workflow directly by its published version without creating a draft, while preserving save-before-run for all existing draft paths.

**Architecture:** `memory-center-web` classifies the request and supplies an authenticated published-version snapshot through the existing v1 Bridge. `sto-claw` routes published snapshots directly into the startup dialog and keeps the current confirmation/persist flow for `persist-draft`. The backend is unchanged because it already accepts an explicit published version for trial runs.

**Tech Stack:** React 18/TypeScript/Vitest (`memory-center-web`), React 19/TypeScript/Vitest/Electron (`sto-claw`), postMessage Bridge v1.

## Global Constraints

- Do not modify `memory-center` production code.
- Do not install, update, or remove dependencies; do not modify lockfiles or build configuration.
- Preserve unrelated working-tree changes in all three repositories.
- Keep Bridge protocol identity `stoclaw-workflow-bridge/v1` and all existing origin/source/nonce/request validation.
- In StoClaw React 19 code, do not add `useCallback`, `useMemo`, or `React.memo` beyond existing documented exceptions.
- Use TDD: every behavior change must first fail for the expected missing behavior.

---

### Task 1: Classify Web Trial-Run Requests

**Files:**
- Modify: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/sto-claw-workflow-bridge.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/sto-claw-workflow-bridge-controller.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/pages/WorkflowDesignerPage.tsx`
- Test: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts`

**Interfaces:**
- Produces `StoClawTryRunPreparation = { mode: "persist-draft" } | { mode: "use-current-published"; snapshot: StoClawRunnableWorkflowSnapshot }`.
- Extends `workflow-try-run-request` with the preparation object; Host defaults a missing field from an older Web build to `persist-draft`.

- [ ] Add a failing controller test asserting an unchanged published workflow posts `use-current-published` with its exact version ID and does not invoke persistence.
- [ ] Add a failing controller test asserting dirty published and draft workflows post `persist-draft`.
- [ ] Run `pnpm exec vitest run src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts` and verify failures are caused by the missing preparation payload.
- [ ] Add strict request payload types/builders/validators and a page callback that classifies from current `versionStatus` plus the current persisted snapshot comparison.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Route Published Snapshots in StoClaw

**Files:**
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/lib/workflow-iframe-bridge.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/pages/Workflow/components/workflow-mc-iframe-editor.tsx`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/pages/Workflow/hooks/use-embedded-workflow-try-run.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/pages/Workflow/workflow-routes.tsx`
- Create: `/Users/tiancanyang/Documents/sto-claw/sto-claw/tests/unit/use-embedded-workflow-try-run.test.tsx`

**Interfaces:**
- `onTryRunRequest(request)` receives the validated request DTO rather than only a request ID.
- `requestFromWeb(request)` opens confirmation only for `persist-draft`; a valid published snapshot calls `beginTryRun(snapshot)` directly.

- [ ] Write failing Hook tests proving published direct-run skips confirmation and persistence, while `persist-draft` retains both.
- [ ] Run the focused Hook test and verify the direct-run assertion fails for the expected reason.
- [ ] Extend the Host Bridge validator and iframe callback to carry the preparation DTO.
- [ ] Implement the minimal Hook branch: send `preparing`, normalize the published snapshot, and call `beginTryRun`; keep the existing save branch unchanged.
- [ ] Re-run focused Hook and Bridge tests and verify they pass.

### Task 3: Correct Published-Run Presentation

**Files:**
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/pages/WorkflowDesigner/hooks/use-designer-try-run.ts`
- Test: `/Users/tiancanyang/Documents/sto-claw/sto-claw/tests/unit/use-designer-try-run.test.tsx` or the nearest existing trial-run Hook test.

**Interfaces:**
- `isDraftSnapshot` is true only when `snapshot.versionStatus === "draft"`.

- [ ] Add a failing test showing a published snapshot does not set the draft badge state.
- [ ] Run the focused test and verify the current `snapshot != null` behavior fails it.
- [ ] Replace presence-based draft detection with version-status detection.
- [ ] Re-run the focused test and verify it passes.

### Task 4: Cross-Repository Verification

**Files:**
- Inspect: `/Users/tiancanyang/Documents/sto-claw/sto-claw/README.md`
- Inspect: `/Users/tiancanyang/Documents/sto-claw/sto-claw/README.zh-CN.md`
- Inspect: `/Users/tiancanyang/Documents/sto-claw/sto-claw/README.ja-JP.md`

- [ ] Run focused Web Bridge tests and Web typecheck.
- [ ] Run focused StoClaw Bridge/Hook tests and StoClaw typecheck.
- [ ] Run `pnpm run comms:replay` and `pnpm run comms:compare` in StoClaw.
- [ ] Review the three README files; update only if they document the changed trial-run persistence behavior.
- [ ] Report changed files, verification evidence, and any unrelated pre-existing warnings without staging unrelated files.

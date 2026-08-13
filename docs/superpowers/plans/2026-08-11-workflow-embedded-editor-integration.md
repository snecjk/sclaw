# Workflow Embedded Editor Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the embedded workflow designer under one Web-owned 52px business header and guarantee that every confirmed StoClaw trial run executes the server-confirmed draft saved from the current canvas.

**Architecture:** `memory-center-web` owns workflow UI and WorkflowDefinition persistence; `sto-claw` owns confirmation, startup inputs, native chrome, local runtime, and iframe orchestration; `memory-center` keeps its current single-draft version semantics. A capability-gated `postMessage` bridge coordinates header ownership, save-before-run, back navigation, state, timeout, and idempotency without exposing canvas definitions to the Host.

**Tech Stack:** Python 3.10/FastAPI/SQLAlchemy/pytest (`memory-center`), React 18/TypeScript/Vite/Vitest/React Flow (`memory-center-web`), Electron/React 19/TypeScript/Zustand/Vitest (`sto-claw`).

## Global Constraints

- Repository roots are `/Users/tiancanyang/Documents/sto-claw/memory-center`, `/Users/tiancanyang/Documents/sto-claw/memory-center-web`, and `/Users/tiancanyang/Documents/sto-claw/sto-claw`; never treat them as one Git repository.
- Before implementation, protect the existing dirty Web changes, especially `WorkflowDesignerPage.tsx`, `styles.css`, AI workflow files, and docs. Require the user to commit/stash them or explicitly authorize inclusion; never overwrite or accidentally stage them.
- Preserve the existing uncommitted StoClaw change in `src/lib/surfaces.ts`; it removes inherited bottom padding for `.sto-workflow-mc-editor` and is compatible with this design.
- Do not run package-manager install/update/remove commands, modify dependency versions, lockfiles, build/package configuration, CI, or build scripts.
- In StoClaw React 19 code, do not introduce `useCallback`, `useMemo`, or `React.memo` unless the documented dependency-array or expensive-computation exception applies.
- `memory-center` agents MUST NOT run `git commit` or `git push`; report backend changes and a suggested commit message for the user to commit manually.
- Keep the bridge protocol string `stoclaw-workflow-bridge/v1` during rollout. Add capability-gated message types instead of breaking existing performance and legacy draft messages.
- Every business bridge envelope MUST validate protocol, message type, expected `origin`, exact `event.source`, nonce, workflow ID, request ID, and payload schema before changing UI or runtime state.
- Trial-run persistence MUST call the existing Web `persistWorkflowDefinition()` even when dirty-state is false. It MUST update an existing draft and create a draft only when editing a published version.
- A save failure, timeout, invalid response, iframe reload, route change, or stale request MUST terminate the attempt; never run a previously known version ID as fallback.
- UI geometry follows MasterGo node `48:45962`; colors and all light/dark states use semantic tokens consistent with `docs/sto-design.md`, not light-only hardcoded fills.
- StoClaw renderer backend calls remain behind existing host-api/api-client boundaries; do not add direct page-level IPC or Gateway fetches.
- Because iframe request/response delivery changes, final verification MUST run `pnpm run comms:replay` and `pnpm run comms:compare`.

---

### Task 1: Lock the Existing Backend Draft Contract

**Requirements:** `Trial run persists the current canvas before execution`

**Files:**
- Modify: `/Users/tiancanyang/Documents/sto-claw/memory-center/tests/core/test_workflow_version_history.py`
- Inspect only unless tests reveal a regression: `/Users/tiancanyang/Documents/sto-claw/memory-center/src/services/workflow_service.py:2049`

**Interfaces:**
- Consumes: `WorkflowService.save_workflow(workflow_id, definition, updated_by, updated_by_name)`.
- Produces: a verified response contract containing `versionId`, `versionStatus`, `schemaVersion`, `activeVersionId`, and `activeVersionStatus`; no new endpoint.

- [ ] **Step 1: Add a failing assertion for existing-draft identity**

Extend `test_save_workflow_keeps_published_active_version_when_existing_draft_exists` so it captures the result and asserts the same draft is returned:

```python
result = service.save_workflow(
    "wf_123",
    {
        "schemaVersion": "workflow/v2",
        "id": "wf_123",
        "versionId": "ver_draft_current",
        "name": "合同审核流（草稿继续修改）",
        "description": "测试流程",
        "nodes": [],
        "edges": [],
    },
    updated_by="E001",
)

assert repo.created_version_args is None
assert result["versionId"] == "ver_draft_current"
assert result["versionStatus"] == "draft"
assert result["schemaVersion"] == "workflow/v2"
assert result["activeVersionId"] == 201
assert result["activeVersionStatus"] == "published"
```

- [ ] **Step 2: Strengthen the published-to-draft case**

Extend `test_save_workflow_keeps_published_active_version_when_creating_draft`:

```python
assert result["versionId"] == "ver_restored_new"
assert result["versionStatus"] == "draft"
assert result["activeVersionId"] == 201
assert result["activeVersionStatus"] == "published"
assert repo.updated_active_version is None
```

- [ ] **Step 3: Run the focused backend suite**

Run:

```bash
python -m pytest tests/core/test_workflow_version_history.py -q
```

Expected: all tests pass without production changes. If an assertion fails, stop and reconcile the approved design with actual backend semantics before editing service code.

- [ ] **Step 4: Prepare the backend handoff without committing**

Run:

```bash
git diff -- tests/core/test_workflow_version_history.py
git status --short
```

Report the changed test file and suggest commit message `test(workflow): lock trial-run draft version contract`. Do not run `git commit` or `git push` in this repository.

---

### Task 2: Extract and Test the Web Bridge Protocol

**Requirements:** `Workflow bridge messages are authenticated and idempotent`, `Embedded trial run entry is capability gated`

**Files:**
- Create: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/sto-claw-workflow-bridge.ts`
- Create: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/sto-claw-workflow-bridge.test.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/pages/WorkflowDesignerPage.tsx:168`

**Interfaces:**
- Consumes: existing `resolveStoClawParentReplyOrigin()` and `isStoClawEmbedded()` from `src/lib/stoclaw-embed.ts`.
- Produces:
  - `STOCLAW_WORKFLOW_BRIDGE_PROTOCOL = "stoclaw-workflow-bridge/v1"`
  - message constants for host init, editor ready, try-run request/state, save-draft request/response/error, back request, performance metric, and legacy draft messages
  - `StoClawTryRunState = "idle" | "confirming" | "saving" | "preparing" | "running" | "error"`
  - validators named `isStoClawHostInitMessage`, `isStoClawSaveDraftRequestMessage`, and `isStoClawTryRunStateMessage`
  - builders named `buildStoClawEditorReadyMessage`, `buildStoClawTryRunRequestMessage`, `buildStoClawBackRequestMessage`, `buildStoClawSaveDraftResponseMessage`, and `buildStoClawSaveDraftErrorMessage`

- [ ] **Step 1: Write failing validator tests**

```ts
import { describe, expect, it } from "vitest";
import {
  STOCLAW_WORKFLOW_BRIDGE_PROTOCOL,
  isStoClawHostInitMessage,
  isStoClawSaveDraftRequestMessage,
  isStoClawTryRunStateMessage,
} from "./sto-claw-workflow-bridge.js";

const envelope = {
  protocol: STOCLAW_WORKFLOW_BRIDGE_PROTOCOL,
  workflowId: "wf_123",
  nonce: "nonce-1",
  requestId: "req-1",
};

describe("StoClaw workflow bridge protocol", () => {
  it("accepts a capability-bearing host init", () => {
    expect(isStoClawHostInitMessage({
      ...envelope,
      type: "workflow-host-init",
      capabilities: ["localTrialRun", "hostBack"],
    })).toBe(true);
  });

  it.each(["protocol", "workflowId", "nonce", "requestId"])(
    "rejects a save request without %s",
    (field) => {
      const value: Record<string, unknown> = {
        ...envelope,
        type: "workflow-save-draft-request",
      };
      delete value[field];
      expect(isStoClawSaveDraftRequestMessage(value)).toBe(false);
    },
  );

  it("rejects an unknown try-run state", () => {
    expect(isStoClawTryRunStateMessage({
      ...envelope,
      type: "workflow-try-run-state",
      state: "finished",
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the protocol test and verify failure**

Run:

```bash
pnpm exec vitest run src/agent-workflow/sto-claw-workflow-bridge.test.ts
```

Expected: FAIL because the protocol module does not exist.

- [ ] **Step 3: Implement the exact shared message contract**

Use discriminated interfaces. The save response payload must be:

```ts
export type StoClawSavedDraftSnapshot = {
  workflowId: string;
  workflowVersionId: string | number;
  schemaVersion: "workflow/v2";
  versionStatus: "draft";
  startup: {
    schema: WorkflowStartupSchemaResponse["schema"] | null;
    defaultValues: Record<string, unknown>;
  };
};
```

All builders must require `{ workflowId, nonce, requestId }`. Keep the existing performance message compatible; it is telemetry and may remain without `requestId`.

- [ ] **Step 4: Move page-local bridge constants and draft validator into the module**

Replace the constants and `isStoClawDraftRequest()` currently declared around `WorkflowDesignerPage.tsx:168-220` with imports. Do not change behavior yet.

- [ ] **Step 5: Run focused tests and type-check**

```bash
pnpm exec vitest run src/agent-workflow/sto-claw-workflow-bridge.test.ts
pnpm run type-check
pnpm exec eslint src/agent-workflow/sto-claw-workflow-bridge.ts src/agent-workflow/sto-claw-workflow-bridge.test.ts
```

Expected: PASS with no TypeScript or lint errors.

- [ ] **Step 6: Commit the protocol extraction after confirming a clean baseline**

```bash
git add src/agent-workflow/sto-claw-workflow-bridge.ts src/agent-workflow/sto-claw-workflow-bridge.test.ts src/agent-workflow/pages/WorkflowDesignerPage.tsx
git commit -m "refactor(workflow): extract StoClaw bridge protocol"
```

Do not run this commit step while unrelated user changes remain mixed into `WorkflowDesignerPage.tsx`.

---

### Task 3: Build the Web Save-Before-Run Bridge Controller

**Requirements:** `Trial run persists the current canvas before execution`, `Save and trial-run states are coordinated`, `Save failures never run stale workflow content`, `Workflow bridge messages are authenticated and idempotent`

**Files:**
- Create: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/sto-claw-workflow-bridge-controller.ts`
- Create: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/pages/WorkflowDesignerPage.tsx:799`

**Interfaces:**
- Consumes protocol types from Task 2 and a page-owned persistence callback.
- Produces:

```ts
export type StoClawWorkflowBridgeControllerOptions = {
  workflowId: string;
  nonce: string;
  parentWindow: Window;
  getCurrentWorkflow: () => WorkflowDefinition | undefined;
  isEditorLocked: () => boolean;
  persistCurrentDraft: () => Promise<WorkflowDefinition>;
  onHostCapabilities: (capabilities: readonly string[]) => void;
  onTryRunState: (state: StoClawTryRunState) => void;
};

export type StoClawWorkflowBridgeController = {
  handleMessage: (event: MessageEvent<unknown>) => Promise<void>;
  requestTryRun: () => string | null;
  requestBack: () => string | null;
  dispose: () => void;
};
```

- [ ] **Step 1: Write failing controller tests for forced persistence and deduplication**

```ts
it("persists even when the page reports no dirty changes", async () => {
  const persistCurrentDraft = vi.fn().mockResolvedValue({
    schemaVersion: "workflow/v2",
    id: "wf_123",
    versionId: "ver_draft_current",
    versionStatus: "draft",
    name: "流程",
    version: 3,
    nodes: [],
    edges: [],
    startupSchema: null,
  });
  const controller = createController({ persistCurrentDraft });

  await controller.handleMessage(saveRequestEvent("req-1"));

  expect(persistCurrentDraft).toHaveBeenCalledTimes(1);
  expect(parentPostMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "workflow-save-draft-response",
      requestId: "req-1",
      workflowVersionId: "ver_draft_current",
      versionStatus: "draft",
    }),
    expectedTargetOrigin,
  );
});

it("does not persist twice for the same request id", async () => {
  const event = saveRequestEvent("req-1");
  await Promise.all([controller.handleMessage(event), controller.handleMessage(event)]);
  expect(persistCurrentDraft).toHaveBeenCalledTimes(1);
});
```

Also add cases for AI/editor lock, wrong `event.source`, wrong origin resolution, save rejection, missing `versionId`, non-v2 schema, and `dispose()`.

- [ ] **Step 2: Run the controller tests and verify failure**

```bash
pnpm exec vitest run src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement one in-flight save per request ID**

The controller must cache `Promise<WorkflowDefinition>` by `requestId`, post one response/error, and reject stale messages after `dispose()`. Validate `event.source === parentWindow`, nonce, and workflow ID before touching the cache.

Use the persisted response—not the pre-save workflow—to build the snapshot:

```ts
const saved = await options.persistCurrentDraft();
if (!saved.versionId || saved.schemaVersion !== "workflow/v2" || saved.versionStatus !== "draft") {
  throw new Error("草稿保存成功但未返回可运行版本号");
}
return buildStoClawSaveDraftResponseMessage({
  workflowId: saved.id,
  workflowVersionId: saved.versionId,
  schemaVersion: saved.schemaVersion,
  versionStatus: saved.versionStatus,
  startup: { schema: saved.startupSchema ?? null, defaultValues: {} },
  nonce: options.nonce,
  requestId,
});
```

- [ ] **Step 4: Integrate the controller with the page without using `saveWorkflow()`**

The automatic path must call `persistWorkflowDefinition(workflowRef.current)` directly so the existing manual-save `isDirty` early return cannot skip the PUT. Set a dedicated `isSavingForTrialRun` state around this callback; do not show the manual “草稿已保存” toast.

- [ ] **Step 5: Replace the old draft listener**

Remove the page effect that only returns `current.versionId`. Register the controller message listener and dispose it on route/workflow/nonce changes. Keep legacy performance reporting.

- [ ] **Step 6: Verify controller and existing workflow tests**

```bash
pnpm exec vitest run src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts src/agent-workflow/ai-workflow-ui.test.ts
pnpm run type-check
```

Expected: PASS; existing AI generation behavior remains unchanged.

- [ ] **Step 7: Commit the Web controller**

```bash
git add src/agent-workflow/sto-claw-workflow-bridge-controller.ts src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts src/agent-workflow/pages/WorkflowDesignerPage.tsx
git commit -m "feat(workflow): persist embedded draft before trial run"
```

---

### Task 4: Implement the Unified Web Header and Back Navigation

**Requirements:** `Embedded workflow editor uses one business header`, `Embedded trial run entry is capability gated`, `Embedded back navigation preserves Web leave protection`, `Version status is consolidated in the version list`, `Header preserves native controls and theme accessibility`

**Files:**
- Create: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/components/WorkflowDesignerTopbar.tsx`
- Create: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx`
- Modify: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/pages/WorkflowDesignerPage.tsx:2789`
- Modify: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/styles.css:4761`
- Verify existing: `/Users/tiancanyang/Documents/sto-claw/memory-center-web/src/agent-workflow/components/HistoryVersionsDrawer.tsx:95`

**Interfaces:**
- Consumes Task 3 controller outputs: negotiated Host capabilities, `StoClawTryRunState`, `requestTryRun()`, and `requestBack()`.
- Produces a stateless `WorkflowDesignerTopbar` whose props explicitly control title editing, button visibility, disabled states, and callbacks.

- [ ] **Step 1: Write failing static-markup tests**

```tsx
import { renderToStaticMarkup } from "react-dom/server";

it("renders the approved embedded action order", () => {
  const html = renderToStaticMarkup(
    <WorkflowDesignerTopbar
      {...baseProps}
      embedded
      hostCapabilities={["localTrialRun", "hostBack"]}
      trialRunState="idle"
    />,
  );
  expect(html.indexOf("版本列表")).toBeLessThan(html.indexOf("保存草稿"));
  expect(html.indexOf("保存草稿")).toBeLessThan(html.indexOf("试运行"));
  expect(html.indexOf("试运行")).toBeLessThan(html.indexOf("发布"));
  expect(html).not.toContain("当前编辑版本");
  expect(html).not.toContain("当前生效版本");
});

it("hides local trial run in standalone Web", () => {
  const html = renderToStaticMarkup(
    <WorkflowDesignerTopbar {...baseProps} embedded={false} hostCapabilities={[]} trialRunState="idle" />,
  );
  expect(html).not.toContain("试运行");
});
```

Add tests for `保存中…`, `准备中…`, `运行中`, AI lock, title/time single-row markup, and back-button visibility.

- [ ] **Step 2: Run the component test and verify failure**

```bash
pnpm exec vitest run src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Extract the existing topbar into the focused component**

Move only topbar rendering. Keep workflow state and actions in `WorkflowDesignerPage`. Remove `.topbar-version-summary` markup. Version status remains in `HistoryVersionsDrawer` through `currentEditingVersionId` and `activeVersion`.

- [ ] **Step 4: Wire capability-gated trial run**

Derive the label with a pure function:

```ts
export function trialRunActionLabel(state: StoClawTryRunState): string {
  if (state === "saving") return "保存中…";
  if (state === "preparing") return "准备中…";
  if (state === "running") return "运行中";
  return "试运行";
}
```

Show the action only for negotiated `localTrialRun`. Disable it for AI generation, confirmation, saving, preparation, running, publishing, or an existing blocking operation.

- [ ] **Step 5: Preserve leave protection before embedded back**

Refactor `confirmDiscardAndNavigate(to)` into an action-based helper:

```ts
function confirmDiscardAndRun(onLeave: () => void) {
  if (!shouldWarnOnLeave) {
    onLeave();
    return;
  }
  setPendingConfirm({
    title: isDirty ? "未保存修改且草稿未发布" : "存在未发布的草稿",
    description: isDirty
      ? "离开后未保存修改将丢失，是否继续？"
      : "当前草稿尚未发布，是否继续离开？",
    confirmLabel: "继续离开",
    variant: isDirty ? "danger" : "primary",
    onConfirm: onLeave,
  });
}
```

Standalone back passes `() => navigate("/workflows-workbench")`; embedded back passes `() => bridgeController.requestBack()`.

- [ ] **Step 6: Apply geometry and semantic theme styles**

Set the designer topbar to 52px total height, title/time in one row, and approved action sizing/order. Add an embedded macOS safe-start class or CSS variable; do not render fake traffic lights. Replace light-only fills in changed selectors with existing semantic variables for header background, body text, muted text, border, hover, focus-visible, disabled, and error states. Preserve responsive behavior without reintroducing the version summary.

- [ ] **Step 7: Lock definition interaction only during automatic save**

Mark the canvas/editor body `inert` and `aria-busy="true"` while `isSavingForTrialRun`; keep the topbar visible with saving feedback. Ensure title edit, save, publish, and trial run are disabled during this state.

- [ ] **Step 8: Run focused UI tests, type-check, and lint**

```bash
pnpm exec vitest run src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx src/agent-workflow/components/WorkflowCanvasEmptyState.test.tsx src/agent-workflow/components/AiWorkflowBuilderControls.test.tsx
pnpm run type-check
pnpm exec eslint src/agent-workflow/components/WorkflowDesignerTopbar.tsx src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx src/agent-workflow/pages/WorkflowDesignerPage.tsx
```

Expected: PASS. Manually inspect both light and dark themes before committing.

- [ ] **Step 9: Commit the unified Web header**

```bash
git add src/agent-workflow/components/WorkflowDesignerTopbar.tsx src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx src/agent-workflow/pages/WorkflowDesignerPage.tsx src/agent-workflow/styles.css
git commit -m "feat(workflow): unify embedded designer header"
```

---

### Task 5: Extend and Test the StoClaw Bridge Contract

**Requirements:** `Workflow bridge messages are authenticated and idempotent`, `Embedded trial run entry is capability gated`

**Files:**
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/lib/workflow-iframe-bridge.ts`
- Create: `/Users/tiancanyang/Documents/sto-claw/sto-claw/tests/unit/workflow-iframe-bridge.test.ts`

**Interfaces:**
- Consumes the exact string values and payload fields defined in Web Task 2.
- Produces Host-side types and validators:
  - `WorkflowEditorReadyMessage`
  - `WorkflowTryRunRequestMessage`
  - `WorkflowBackRequestMessage`
  - `WorkflowSaveDraftResponseMessage`
  - `WorkflowSaveDraftErrorMessage`
  - `WorkflowTryRunState`
  - `isWorkflowEditorReady`, `isWorkflowTryRunRequest`, `isWorkflowBackRequest`, `isWorkflowSaveDraftResponse`, `isWorkflowSaveDraftError`

- [ ] **Step 1: Write failing Host validator tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  isWorkflowEditorReady,
  isWorkflowSaveDraftResponse,
  isWorkflowTryRunRequest,
} from '@/lib/workflow-iframe-bridge';

const envelope = {
  protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  workflowId: 'wf_123',
  nonce: 'nonce-1',
  requestId: 'req-1',
};

it('accepts editor capabilities', () => {
  expect(isWorkflowEditorReady({
    ...envelope,
    type: 'workflow-editor-ready',
    capabilities: ['ownsHeader', 'persistBeforeTrialRun'],
  })).toBe(true);
});

it('requires a persisted draft response', () => {
  expect(isWorkflowSaveDraftResponse({
    ...envelope,
    type: 'workflow-save-draft-response',
    workflowVersionId: 'ver_3',
    schemaVersion: 'workflow/v2',
    versionStatus: 'draft',
    startup: { schema: null, defaultValues: {} },
  })).toBe(true);
});
```

Add table tests that remove each required field and reject `versionStatus: "published"` for the save-before-run response.

- [ ] **Step 2: Run the test and verify failure**

```bash
pnpm exec vitest run tests/unit/workflow-iframe-bridge.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement the Host contract without breaking legacy messages**

Retain `WORKFLOW_DRAFT_REQUEST/RESPONSE/ERROR` and performance types for compatibility. Add the new constants and strict validators beside them. Use arrays of exact capability strings; reject arbitrary values.

- [ ] **Step 4: Run tests and type-check**

```bash
pnpm exec vitest run tests/unit/workflow-iframe-bridge.test.ts
pnpm run typecheck
pnpm exec eslint src/lib/workflow-iframe-bridge.ts tests/unit/workflow-iframe-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the Host protocol**

```bash
git add src/lib/workflow-iframe-bridge.ts tests/unit/workflow-iframe-bridge.test.ts
git commit -m "feat(workflow): extend embedded editor bridge contract"
```

---

### Task 6: Add Host Handshake and Persisted-Snapshot Request Management

**Requirements:** `Embedded workflow editor uses one business header`, `Save failures never run stale workflow content`, `Workflow bridge messages are authenticated and idempotent`

**Files:**
- Create: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/pages/Workflow/components/workflow-iframe-request-manager.ts`
- Create: `/Users/tiancanyang/Documents/sto-claw/sto-claw/tests/unit/workflow-iframe-request-manager.test.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/pages/Workflow/components/workflow-mc-iframe-editor.tsx`

**Interfaces:**
- Consumes Task 5 message builders/validators.
- Produces:

```ts
export interface WorkflowMcIframeEditorHandle {
  requestLegacyDraftSnapshot: () => Promise<WorkflowDraftSnapshot>;
  requestPersistedDraftSnapshot: (requestId: string) => Promise<WorkflowDraftSnapshot>;
  sendTryRunState: (requestId: string, state: WorkflowTryRunState, message?: string) => void;
}

export interface WorkflowMcIframeEditorProps {
  workflowId: string;
  prompt?: string;
  promptCacheId?: string;
  onEditorCapabilitiesChange?: (ready: boolean) => void;
  onTryRunRequest?: (requestId: string) => void;
  onBackRequest?: () => void;
}
```

- [ ] **Step 1: Write failing request-manager tests**

Cover one in-flight request, matching response resolution, error rejection, timeout, late response ignore, and `dispose()`:

```ts
it('ignores a response after timeout', async () => {
  vi.useFakeTimers();
  const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
  const pending = manager.begin('req-1');
  await vi.advanceTimersByTimeAsync(30_000);
  await expect(pending).rejects.toThrow('未能保存当前画布草稿');
  expect(manager.resolve(savedResponse('req-1'))).toBe(false);
});
```

- [ ] **Step 2: Run the manager test and verify failure**

```bash
pnpm exec vitest run tests/unit/workflow-iframe-request-manager.test.ts
```

- [ ] **Step 3: Implement the focused request manager**

The manager owns only request ID, promise, timer, and terminal cleanup. It must not know React, iframe origin, workflow ID, or runtime behavior. `begin()` returns the existing promise if the same request is already pending and rejects a different concurrent save request.

- [ ] **Step 4: Send capability init after iframe load**

On iframe load, post:

```ts
{
  protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  type: WORKFLOW_HOST_INIT,
  requestId: handshakeRequestId,
  workflowId,
  nonce: bridgeNonce,
  capabilities: ['localTrialRun', 'hostBack'],
}
```

Resend the same init when a valid `designer_mounted` performance metric arrives and editor readiness is still false. This closes the onload/effect race without creating a new handshake identity.

- [ ] **Step 5: Accept editor-ready, try-run, and back events**

Before invoking callbacks, require:

```ts
event.origin === expectedOrigin
event.source === iframeRef.current?.contentWindow
payload.nonce === bridgeNonce
payload.workflowId === workflowId
```

Editor-ready must match the handshake request ID and include both `ownsHeader` and `persistBeforeTrialRun` before reporting `ready=true`.

- [ ] **Step 6: Implement persisted-save requests and state messages**

`requestPersistedDraftSnapshot(requestId)` posts `workflow-save-draft-request` and resolves only a matching strict save response. Keep the existing legacy request method for new-Host/old-Web fallback. `sendTryRunState()` posts only when iframe and expected origin are available.

- [ ] **Step 7: Cancel on iframe lifecycle changes**

On component unmount, iframe source change, workflow ID change, or iframe load reset: dispose pending requests, clear readiness, and call `onEditorCapabilitiesChange(false)`.

- [ ] **Step 8: Run focused Host tests**

```bash
pnpm exec vitest run tests/unit/workflow-iframe-bridge.test.ts tests/unit/workflow-iframe-request-manager.test.ts
pnpm run typecheck
pnpm exec eslint src/pages/Workflow/components/workflow-iframe-request-manager.ts src/pages/Workflow/components/workflow-mc-iframe-editor.tsx tests/unit/workflow-iframe-request-manager.test.ts
```

- [ ] **Step 9: Commit the iframe bridge session**

```bash
git add src/pages/Workflow/components/workflow-iframe-request-manager.ts src/pages/Workflow/components/workflow-mc-iframe-editor.tsx tests/unit/workflow-iframe-request-manager.test.ts
git commit -m "feat(workflow): coordinate embedded editor capabilities"
```

---

### Task 7: Orchestrate Confirm → Save → Prepare → Run in StoClaw

**Requirements:** `Trial run requires explicit confirmation`, `Trial run persists the current canvas before execution`, `Save and trial-run states are coordinated`, `Save failures never run stale workflow content`

**Files:**
- Create: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/pages/Workflow/hooks/use-embedded-workflow-try-run.ts`
- Create: `/Users/tiancanyang/Documents/sto-claw/sto-claw/tests/unit/use-embedded-workflow-try-run.test.tsx`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/pages/Workflow/workflow-routes.tsx:110`

**Interfaces:**
- Consumes Task 6 handle and existing `useDesignerTryRun().begin`.
- Produces:

```ts
export interface EmbeddedWorkflowTryRunController {
  confirmOpen: boolean;
  requestInFlight: boolean;
  requestFromWeb: (requestId: string) => void;
  requestFromHostFallback: () => void;
  cancelConfirmation: () => void;
  confirmAndPrepare: () => Promise<void>;
  rerun: () => Promise<void>;
}
```

- [ ] **Step 1: Write failing orchestration tests**

Using `renderHook`, prove ordering and cancellation:

```tsx
it('saves before beginning the local trial run', async () => {
  const order: string[] = [];
  requestPersistedDraftSnapshot.mockImplementation(async () => {
    order.push('save');
    return savedSnapshot;
  });
  beginTryRun.mockImplementation(() => order.push('begin'));

  const { result } = renderHook(() => useEmbeddedWorkflowTryRun(options));
  act(() => result.current.requestFromWeb('req-1'));
  await act(() => result.current.confirmAndPrepare());

  expect(order).toEqual(['save', 'begin']);
  expect(beginTryRun).toHaveBeenCalledWith(savedSnapshot);
});

it('does not save when confirmation is cancelled', () => {
  act(() => result.current.requestFromWeb('req-1'));
  act(() => result.current.cancelConfirmation());
  expect(requestPersistedDraftSnapshot).not.toHaveBeenCalled();
  expect(sendTryRunState).toHaveBeenLastCalledWith('req-1', 'idle');
});
```

Add save rejection, missing editor handle, duplicate Web request, active-run block, rerun saves again, and startup-cancel state reset cases.

- [ ] **Step 2: Run the hook test and verify failure**

```bash
pnpm exec vitest run tests/unit/use-embedded-workflow-try-run.test.tsx
```

- [ ] **Step 3: Implement the hook with plain functions**

Do not add `useCallback` or `useMemo`. Store the active request ID and source in state/ref. The sequence after confirmation must be:

```ts
sendTryRunState(requestId, 'saving');
const snapshot = await editor.requestPersistedDraftSnapshot(requestId);
sendTryRunState(requestId, 'preparing');
beginTryRun(snapshot);
```

On error, send `error` with the message, show one StoClaw toast, then return Web to `idle`. Never call `beginTryRun` in a catch/finally fallback.

- [ ] **Step 4: Preserve legacy fallback deliberately**

When the visible Host ContentHeader is still the compatibility owner because editor capabilities are not ready, `requestFromHostFallback()` may use `requestLegacyDraftSnapshot()`. The new Web-owned trial-run path must always use persisted save. Keep these paths explicit so legacy behavior cannot leak into the negotiated path.

- [ ] **Step 5: Replace duplicated edit/generate route state**

Use the hook in both `WorkflowEditRoute` and the AI-generation route. The Web `onTryRunRequest` opens the existing `ConfirmDialog` with exact message:

```text
试运行前将自动保存当前画布为草稿，是否继续？
```

Keep existing `StartupRunDialog`, `TestRunDrawer`, and local history components. When startup dialog is cancelled, leave the saved draft intact and synchronize Web to idle without creating a run.

- [ ] **Step 6: Ensure run-state synchronization reaches terminal state**

Map existing `useDesignerTryRun` flags to `running` while a local run is active and back to `idle` when it completes/closes. If local startup fails, send `error` once and retain the saved draft.

- [ ] **Step 7: Run orchestration and local-run tests**

```bash
pnpm exec vitest run tests/unit/use-embedded-workflow-try-run.test.tsx tests/unit/workflow-run-started-at.test.ts tests/unit/workflow-designer-persist.test.ts
pnpm run typecheck
pnpm exec eslint src/pages/Workflow/hooks/use-embedded-workflow-try-run.ts src/pages/Workflow/workflow-routes.tsx tests/unit/use-embedded-workflow-try-run.test.tsx
```

- [ ] **Step 8: Commit orchestration**

```bash
git add src/pages/Workflow/hooks/use-embedded-workflow-try-run.ts src/pages/Workflow/workflow-routes.tsx tests/unit/use-embedded-workflow-try-run.test.tsx
git commit -m "feat(workflow): save draft before embedded trial run"
```

---

### Task 8: Switch Header and Windows Chrome Ownership After Handshake

**Requirements:** `Embedded workflow editor uses one business header`, `Header preserves native controls and theme accessibility`

**Files:**
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/stores/workflow-ui.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/components/layout/MainLayout.tsx:90`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/hooks/use-windows-chrome-owner.ts`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/components/layout/app-shell-chrome-overlay.tsx`
- Modify carefully, preserving the existing user diff: `/Users/tiancanyang/Documents/sto-claw/sto-claw/src/lib/surfaces.ts:771`
- Modify: `/Users/tiancanyang/Documents/sto-claw/sto-claw/tests/unit/windows-chrome-owner.test.tsx`
- Create: `/Users/tiancanyang/Documents/sto-claw/sto-claw/tests/unit/workflow-embedded-header-layout.test.ts`

**Interfaces:**
- Consumes `onEditorCapabilitiesChange(ready)` from Task 6.
- Produces `embeddedHeaderOwned: boolean`, `setEmbeddedHeaderOwned(boolean)`, and a pure `shouldHideWorkflowContentHeader()` selector.

- [ ] **Step 1: Write failing store/layout tests**

```ts
it('hides the Host header only after negotiated ownership', () => {
  expect(shouldHideWorkflowContentHeader({ editorActive: true, embeddedHeaderOwned: false })).toBe(false);
  expect(shouldHideWorkflowContentHeader({ editorActive: true, embeddedHeaderOwned: true })).toBe(true);
  expect(shouldHideWorkflowContentHeader({ editorActive: false, embeddedHeaderOwned: true })).toBe(false);
});
```

Extend `windows-chrome-owner.test.tsx`:

```ts
expect(resolveWindowsChromeOwner({
  isProvincial: true,
  pathname: '/workflow/wf_123/edit',
  browserOverlayOpen: false,
  appPlazaVisible: false,
  contentHeaderVisible: false,
})).toBe('shell-fallback');
```

- [ ] **Step 2: Run layout tests and verify failure**

```bash
pnpm exec vitest run tests/unit/workflow-embedded-header-layout.test.ts tests/unit/windows-chrome-owner.test.tsx
```

- [ ] **Step 3: Extend workflow UI ownership state**

Add `embeddedHeaderOwned` separately from `editorActive`. `editorActive` continues collapsing the sidebar; `embeddedHeaderOwned` controls only the business header/body reservation/chrome owner. Reset it to false on workflow route unmount, workflow ID change, iframe readiness loss, and compatibility fallback.

- [ ] **Step 4: Derive effective ContentHeader visibility in MainLayout**

`ProvincialMainCard` must compute one effective `hideContentHeader` value and pass the same value to both header rendering and `MainCardBody`. This removes both the header DOM and its padding/height reservation only after handshake success.

- [ ] **Step 5: Move Windows controls to shell fallback when the header is hidden**

Add `contentHeaderVisible` to `resolveWindowsChromeOwner`. If false on a provincial workflow route, return `shell-fallback`; `AppShellChromeOverlay` then renders the existing `WindowsWindowControls`. Do not add iframe messages for minimize/maximize/close.

- [ ] **Step 6: Preserve the current surfaces diff**

Keep the existing `.sto-workflow-mc-editor` marker and `has-[.sto-workflow-mc-editor]:pb-0` behavior. Adjust only the minimum class needed to let the iframe occupy the newly freed header height; do not discard the user's bottom-padding fix.

- [ ] **Step 7: Run shell tests, type-check, and targeted lint**

```bash
pnpm exec vitest run tests/unit/workflow-embedded-header-layout.test.ts tests/unit/windows-chrome-owner.test.tsx tests/unit/content-header-layout.test.tsx tests/unit/app-shell-surface-tokens.test.ts
pnpm run typecheck
pnpm exec eslint src/stores/workflow-ui.ts src/components/layout/MainLayout.tsx src/hooks/use-windows-chrome-owner.ts src/components/layout/app-shell-chrome-overlay.tsx tests/unit/workflow-embedded-header-layout.test.ts tests/unit/windows-chrome-owner.test.tsx
```

- [ ] **Step 8: Commit shell ownership only after separating the pre-existing surfaces change**

```bash
git add src/stores/workflow-ui.ts src/components/layout/MainLayout.tsx src/hooks/use-windows-chrome-owner.ts src/components/layout/app-shell-chrome-overlay.tsx tests/unit/workflow-embedded-header-layout.test.ts tests/unit/windows-chrome-owner.test.tsx
git commit -m "feat(workflow): hand embedded header chrome ownership to Web"
```

Stage `src/lib/surfaces.ts` only if the user has confirmed that its existing changes belong in this implementation commit.

---

### Task 9: Cross-Repository Verification, Documentation, and OpenSpec Closure

**Requirements:** all requirements in `workflow-embedded-editor-integration/spec.md`

**Files:**
- Modify as required: `/Users/tiancanyang/Documents/sto-claw/sto-claw/README.md`
- Modify as required: `/Users/tiancanyang/Documents/sto-claw/sto-claw/README.zh-CN.md`
- Modify as required: `/Users/tiancanyang/Documents/sto-claw/sto-claw/README.ja-JP.md`
- Review equivalents in `memory-center-web` and `memory-center`
- Update checkboxes: `/Users/tiancanyang/Documents/sto-claw/sto-claw/openspec/changes/workflow-embedded-editor-integration/tasks.md`

**Interfaces:**
- Consumes all prior tasks.
- Produces verified new-Host/new-Web behavior plus safe new/old compatibility behavior.

- [ ] **Step 1: Run the backend contract test**

```bash
cd /Users/tiancanyang/Documents/sto-claw/memory-center
python -m pytest tests/core/test_workflow_version_history.py -q
```

Expected: PASS.

- [ ] **Step 2: Run Web workflow tests and static checks**

```bash
cd /Users/tiancanyang/Documents/sto-claw/memory-center-web
pnpm exec vitest run src/agent-workflow/sto-claw-workflow-bridge.test.ts src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx
pnpm run type-check
pnpm exec eslint src/agent-workflow/sto-claw-workflow-bridge.ts src/agent-workflow/sto-claw-workflow-bridge-controller.ts src/agent-workflow/components/WorkflowDesignerTopbar.tsx src/agent-workflow/pages/WorkflowDesignerPage.tsx
```

Expected: PASS.

- [ ] **Step 3: Run StoClaw workflow/shell tests and checks**

```bash
cd /Users/tiancanyang/Documents/sto-claw/sto-claw
pnpm exec vitest run tests/unit/workflow-iframe-bridge.test.ts tests/unit/workflow-iframe-request-manager.test.ts tests/unit/use-embedded-workflow-try-run.test.tsx tests/unit/workflow-embedded-header-layout.test.ts tests/unit/windows-chrome-owner.test.tsx tests/unit/content-header-layout.test.tsx
pnpm run typecheck
pnpm run comms:replay
pnpm run comms:compare
```

Expected: all focused tests and typecheck pass; communication comparison reports no unexplained regression.

- [ ] **Step 4: Exercise the compatibility matrix manually**

Verify each combination:

| Host | Web | Expected header | Expected trial run |
|---|---|---|---|
| New | New | One Web-owned 52px header | Web button → confirm → PUT → returned draft ID → local run |
| New | Old | Existing Host fallback header | Legacy snapshot flow remains available; no blank header |
| Old | New | Existing Host behavior | Web does not show capability-gated trial run |
| Standalone browser | New | Web header and Web back | No local trial-run button |

- [ ] **Step 5: Exercise failure and concurrency cases manually**

Verify: unchanged canvas, existing draft, published version, AI generation lock, cancel confirmation, cancel startup inputs, slow PUT, PUT 5xx, missing version ID, iframe reload during save, route switch during save, duplicate try-run request, duplicate save response, local Agent startup failure, and rerun after editing.

Expected: no stale-version fallback and at most one local run per request ID.

- [ ] **Step 6: Perform visual and accessibility QA**

Compare against MasterGo `48:45962` at the target viewport. Check 52px height, title/time single row, action order, removed central version summary, version drawer badges, keyboard order, focus-visible, hover, disabled labels, light/dark contrast, macOS traffic-light safe area, and Windows minimize/maximize/close.

- [ ] **Step 7: Review documentation in all three repositories**

Update README files only if they describe the workflow embed, trial-run contract, or integration API. If no update is required, record that review in the implementation handoff rather than making a no-op edit.

- [ ] **Step 8: Close OpenSpec task traceability**

Mark each verified checkbox in `openspec/changes/workflow-embedded-editor-integration/tasks.md`. Confirm every requirement has at least one passing automated or manual acceptance item.

- [ ] **Step 9: Commit StoClaw docs and task closure**

```bash
git add openspec/changes/workflow-embedded-editor-integration/tasks.md README.md README.zh-CN.md README.ja-JP.md
git commit -m "docs(workflow): close embedded editor integration spec"
```

Only stage README files that actually changed. Backend changes remain a manual user commit per `memory-center/AGENTS.md`.

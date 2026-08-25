# Workflow Result Drawer Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one click on a completed workflow notification close the matching trial-run drawer and open the matching global run-detail drawer.

**Architecture:** Add a renderer-local handoff coordinator that lets the active trial drawer claim a result-open request by `runId` and complete it after React commits the closed state. `WorkflowCompletionNotifier` remains the owner of global detail loading and opening; `useDesignerTryRun` remains the owner of the page trial drawer.

**Tech Stack:** React 19, TypeScript, Radix Dialog/Sheet, Sonner, Vitest, Testing Library.

## Global Constraints

- Change only the StoClaw renderer; do not modify Main/Renderer protocols or frontend/backend APIs.
- Only a visible trial drawer with the same `runId` may claim the handoff.
- Do not use fixed-duration timeouts to sequence the drawers.
- Preserve existing notification copy, trial-run styling, run data models, and detail-load error handling.
- Do not add dependencies or modify package/build configuration.
- Do not add new `useCallback`, `useMemo`, or `React.memo` wrappers.

---

## File Structure

- Create `src/lib/workflow-result-drawer-handoff.ts`: a small renderer-local request/claim/complete coordinator with no React or run-data ownership.
- Create `tests/unit/workflow-result-drawer-handoff.test.ts`: coordinator contract tests.
- Modify `src/pages/WorkflowDesigner/hooks/use-designer-try-run.ts`: claim matching requests, close the trial drawer, and complete after the closed state commits.
- Modify `tests/unit/use-designer-try-run.test.tsx`: hook-level matching, mismatch, and cleanup coverage.
- Modify `src/components/workflow/WorkflowCompletionNotifier.tsx`: route both toast and OS-notification opens through the coordinator.
- Create `tests/unit/workflow-completion-notifier.test.tsx`: verify the detail drawer waits for an acknowledged handoff and opens directly when unclaimed.

### Task 1: Renderer-local handoff coordinator

**Files:**
- Create: `src/lib/workflow-result-drawer-handoff.ts`
- Create: `tests/unit/workflow-result-drawer-handoff.test.ts`

**Interfaces:**
- Produces: `subscribeWorkflowResultDrawerHandoff(listener): () => void`
- Produces: `requestWorkflowResultDrawerHandoff(runId: string, openResult: () => void): boolean`
- Listener input: `{ runId: string; complete: () => void }`
- Listener return: `true` when it claims the request, otherwise `false`

- [ ] **Step 1: Write failing coordinator tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  requestWorkflowResultDrawerHandoff,
  subscribeWorkflowResultDrawerHandoff,
} from '@/lib/workflow-result-drawer-handoff';

describe('workflow result drawer handoff', () => {
  it('waits for the claiming listener and opens exactly once', () => {
    const openResult = vi.fn();
    let complete: (() => void) | undefined;
    const unsubscribe = subscribeWorkflowResultDrawerHandoff((request) => {
      if (request.runId !== 'run-1') return false;
      complete = request.complete;
      return true;
    });

    expect(requestWorkflowResultDrawerHandoff('run-1', openResult)).toBe(true);
    expect(openResult).not.toHaveBeenCalled();
    complete?.();
    complete?.();
    expect(openResult).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('opens immediately when no listener claims the run', () => {
    const openResult = vi.fn();
    expect(requestWorkflowResultDrawerHandoff('run-other', openResult)).toBe(false);
    expect(openResult).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the coordinator test and verify RED**

Run: `pnpm exec vitest run tests/unit/workflow-result-drawer-handoff.test.ts`

Expected: FAIL because `@/lib/workflow-result-drawer-handoff` does not exist.

- [ ] **Step 3: Implement the minimal coordinator**

```ts
export interface WorkflowResultDrawerHandoffRequest {
  runId: string;
  complete: () => void;
}

type WorkflowResultDrawerHandoffListener = (
  request: WorkflowResultDrawerHandoffRequest,
) => boolean;

const listeners = new Set<WorkflowResultDrawerHandoffListener>();

export function subscribeWorkflowResultDrawerHandoff(
  listener: WorkflowResultDrawerHandoffListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestWorkflowResultDrawerHandoff(
  runId: string,
  openResult: () => void,
): boolean {
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    openResult();
  };
  for (const listener of listeners) {
    if (listener({ runId, complete })) return true;
  }
  complete();
  return false;
}
```

- [ ] **Step 4: Run the coordinator test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/workflow-result-drawer-handoff.test.ts`

Expected: both tests PASS with no warning output.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/workflow-result-drawer-handoff.ts tests/unit/workflow-result-drawer-handoff.test.ts
git commit -m "feat(workflow): coordinate result drawer handoff"
```

### Task 2: Trial drawer claim and close acknowledgement

**Files:**
- Modify: `src/pages/WorkflowDesigner/hooks/use-designer-try-run.ts:90-380`
- Modify: `tests/unit/use-designer-try-run.test.tsx`

**Interfaces:**
- Consumes: `subscribeWorkflowResultDrawerHandoff(listener): () => void` from Task 1
- Produces: matching active drawer closes first, then calls the request's idempotent `complete()` after React commits `isDrawerOpen=false`

- [ ] **Step 1: Extend the hook mock and add a failing matching-run test**

```ts
let handoffListener: ((request: { runId: string; complete: () => void }) => boolean) | undefined;

vi.mock('@/lib/workflow-result-drawer-handoff', () => ({
  subscribeWorkflowResultDrawerHandoff: vi.fn((listener) => {
    handoffListener = listener;
    return () => { handoffListener = undefined; };
  }),
}));

it('closes a matching open trial drawer before completing result handoff', async () => {
  const { result } = renderHook(() => useDesignerTryRun({
    workflowId: 'wf-1',
    startupSchema: null,
    canStart: () => true,
  }));
  vi.mocked(getRunViaIpc).mockResolvedValue(runtimeFixture('run-1'));
  await act(async () => { await result.current.openExistingRun('run-1'); });
  const complete = vi.fn();

  await act(async () => {
    expect(handoffListener?.({ runId: 'run-1', complete })).toBe(true);
  });

  expect(result.current.isDrawerOpen).toBe(false);
  expect(complete).toHaveBeenCalledTimes(1);
});
```

Add a second assertion using `run-other`: the listener returns `false`, keeps `isDrawerOpen=true`, and does not call `complete`.

- [ ] **Step 2: Run the hook test and verify RED**

Run: `pnpm exec vitest run tests/unit/use-designer-try-run.test.tsx`

Expected: FAIL because the hook does not subscribe to or claim handoff requests.

- [ ] **Step 3: Implement claim, close, commit acknowledgement, and cleanup**

Add a `pendingResultHandoffRef`. Subscribe in an effect that checks both `isDrawerOpen` and `runIdRef.current`. On a match, store `complete`, set the drawer closed, and return `true`. In a second effect keyed by `isDrawerOpen`, consume and clear the stored callback only when the drawer is closed. Add an unmount cleanup that consumes any remaining callback so route changes cannot strand the global result open.

```ts
const pendingResultHandoffRef = useRef<(() => void) | null>(null);

useEffect(() => subscribeWorkflowResultDrawerHandoff(({ runId: requestedRunId, complete }) => {
  if (!isDrawerOpen || runIdRef.current !== requestedRunId) return false;
  if (!pendingResultHandoffRef.current) pendingResultHandoffRef.current = complete;
  setIsDrawerOpen(false);
  return true;
}), [isDrawerOpen]);

useEffect(() => {
  if (isDrawerOpen || !pendingResultHandoffRef.current) return;
  const complete = pendingResultHandoffRef.current;
  pendingResultHandoffRef.current = null;
  complete();
}, [isDrawerOpen]);

useEffect(() => () => {
  const complete = pendingResultHandoffRef.current;
  pendingResultHandoffRef.current = null;
  complete?.();
}, []);
```

- [ ] **Step 4: Run hook and coordinator tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/workflow-result-drawer-handoff.test.ts tests/unit/use-designer-try-run.test.tsx`

Expected: all tests PASS; matching run closes and completes, mismatched run remains open.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/pages/WorkflowDesigner/hooks/use-designer-try-run.ts tests/unit/use-designer-try-run.test.tsx
git commit -m "fix(workflow): close trial drawer before result details"
```

### Task 3: Route notification opens through the handoff

**Files:**
- Modify: `src/components/workflow/WorkflowCompletionNotifier.tsx:38-123`
- Create: `tests/unit/workflow-completion-notifier.test.tsx`

**Interfaces:**
- Consumes: `requestWorkflowResultDrawerHandoff(runId, openResult): boolean` from Task 1
- Preserves: `openDetails(sessionKey, runId, workflowName?)` as the only detail load/state entry point

- [ ] **Step 1: Write a failing notifier test for deferred and direct opens**

Mock `subscribeHostEvent` to capture the `workflow:status-update` callback, mock Sonner to capture the success toast options, mock `getRunViaIpc`, and render the notifier in `MemoryRouter`. Mock the coordinator so the first test captures but does not immediately call `openResult`.

```ts
await act(async () => statusHandler?.({
  sessionKey: 'designer-try-run',
  runId: 'run-1',
  status: 'completed',
  workflowId: 'wf-1',
}));
act(() => successToastOptions.action.onClick());
expect(screen.queryByTestId('workflow-detail-open')).not.toBeInTheDocument();
await act(async () => deferredOpenResult?.());
expect(screen.getByTestId('workflow-detail-open')).toBeInTheDocument();
expect(getRunViaIpc).toHaveBeenCalledWith('run-1', 'detail');
```

Add a direct-open case where the mocked coordinator immediately calls `openResult`. Also capture `workflow:completion-open` and assert it uses the same coordinator entry.

- [ ] **Step 2: Run the notifier test and verify RED**

Run: `pnpm exec vitest run tests/unit/workflow-completion-notifier.test.tsx`

Expected: FAIL because the toast action and OS event call `openDetails` directly instead of the coordinator.

- [ ] **Step 3: Route both open sources through one handoff-aware function**

Inside the existing effect, add this local entry point and use it from both `onCompletionOpen` and the toast action:

```ts
const openDetailsAfterHandoff = (
  sessionKey: string,
  runId: string,
  workflowName?: string,
) => {
  requestWorkflowResultDrawerHandoff(runId, () => {
    void openDetails(sessionKey, runId, workflowName);
  });
};
```

Do not change notification deduplication, detail fetch behavior, routing, or rendering.

- [ ] **Step 4: Run all targeted tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/workflow-result-drawer-handoff.test.ts tests/unit/use-designer-try-run.test.tsx tests/unit/workflow-completion-notifier.test.tsx tests/unit/test-run-drawer.test.tsx`

Expected: all targeted tests PASS.

- [ ] **Step 5: Run static and communication regression checks**

Run:

```bash
pnpm exec eslint src/lib/workflow-result-drawer-handoff.ts src/pages/WorkflowDesigner/hooks/use-designer-try-run.ts src/components/workflow/WorkflowCompletionNotifier.tsx tests/unit/workflow-result-drawer-handoff.test.ts tests/unit/use-designer-try-run.test.tsx tests/unit/workflow-completion-notifier.test.tsx
pnpm run comms:replay
pnpm run comms:compare
git diff --check
```

Expected: ESLint has no new errors; communication replay and comparison pass; diff check is clean.

- [ ] **Step 6: Review documentation impact**

Inspect `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. This is a bug fix to an existing interaction and does not change public behavior or interfaces, so record no README change unless inspection finds text that explicitly describes the old two-click behavior.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/components/workflow/WorkflowCompletionNotifier.tsx tests/unit/workflow-completion-notifier.test.tsx
git commit -m "fix(workflow): open run result with one click"
```

### Task 4: Manual acceptance

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes the completed implementation from Tasks 1-3.
- Produces acceptance evidence for the exact user interaction.

- [ ] **Step 1: Start or reuse the development app**

Run: `pnpm dev`

Expected: Vite, Electron, Host API, and Gateway remain running.

- [ ] **Step 2: Verify the matching active-drawer flow**

Start a workflow trial run, keep the trial drawer open until completion, and click the success toast action once.

Expected: the trial drawer closes and the same run's global detail drawer opens from that single click; the detail header and result content are visible.

- [ ] **Step 3: Verify the no-active-drawer flow**

Close the trial drawer while another trial run continues, wait for completion, and click the success toast action once.

Expected: the detail drawer opens directly with one click.

- [ ] **Step 4: Inspect final repository state**

Run: `git status --short && git log -5 --oneline`

Expected: only the pre-existing untracked `docs/workflow-cr-handoff-2026-08-12.md` remains outside commits; implementation commits are present.

# 工作流试运行体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在嵌入式工作流编辑器中实现与 MasterGo 对齐的 500px 试运行结果抽屉，并让 StoClaw 抽屉与 memory-center-web 顶栏持续展示同一运行中/取消/失败/完成状态。

**Architecture:** `sto-claw` 继续作为本地运行事实来源，通过纯状态映射器把本地 run 状态转换为 bridge 展示状态，同时驱动本地 trial drawer；`memory-center-web` 的 bridge controller 分离 active request 与 retained display state，并只在现有顶栏中增加状态徽标。取消态“继续运行”复用保存最新草稿后创建新 run 的链路，`memory-center` 不做任何生产代码变更。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Tailwind/shadcn Sheet、lucide-react、authenticated `postMessage` iframe bridge。

## Global Constraints

- 不修改 `package.json`、任何 lockfile、构建/打包脚本、CI/CD 或依赖版本，不执行安装/升级/移除依赖命令。
- 不修改 `memory-center` 生产代码、终态锁、数据库或运行 API。
- `sto-claw` renderer 后端调用继续经过 `src/lib/host-api.ts` / `src/lib/api-client.ts`；不新增直接 `window.electron.ipcRenderer.invoke(...)` 或 Gateway HTTP 调用。
- React 19 新代码不增加 `useCallback`、`useMemo` 或 `React.memo`；effect 中的函数逻辑优先内联。
- 视觉必须覆盖 4 类状态、5 个视图：运行中、取消、失败、完成-过程收起、完成-过程展开。
- Trial drawer 目标宽度 500px，Header 52px，正文左右 12px，状态条 476×42px，Footer 60px，底部按钮 476×36px、圆角 10px；窄窗口不得横向溢出。
- 颜色使用 Brand、Success、Warning、Danger、Text、Fill、Border 语义 token，并覆盖文字+图标、focus-visible、hover、disabled、浅色和深色状态。
- 保留等待审批、补充输入、执行事件、产物打开/下载和 detail 模式；trial 新视觉不得改写历史运行详情和完成通知信息结构。
- 当前两个前端仓库都有未提交且与目标文件重叠的用户改动。执行阶段允许编辑，但不得自动暂存或提交包含既有用户改动的文件；每个任务先完成测试 checkpoint，待用户整理前置提交后再使用文中建议 commit message。

---

## File Map

### sto-claw

- `src/lib/workflow-iframe-bridge.ts`：Host bridge 状态联合类型与消息发送契约。
- `src/pages/Workflow/hooks/workflow-try-run-display-state.ts`：新增纯函数，本地 run status → bridge 稳定展示状态。
- `src/pages/Workflow/hooks/use-embedded-workflow-try-run.ts`：当前 request/run 绑定、稳定终态发送、session 失效与重跑编排。
- `src/pages/Workflow/workflow-routes.tsx`：抽屉关闭、取消态继续、新状态参数接线。
- `src/pages/WorkflowDesigner/components/test-run-drawer-model.ts`：新增 timeline、artifact、view/status 等纯数据适配。
- `src/pages/WorkflowDesigner/components/test-run-trial-view.tsx`：新增 500px trial 专属五状态视觉与交互。
- `src/pages/WorkflowDesigner/components/test-run-drawer.tsx`：共享 Sheet 入口，显式选择 `trial` / `detail`。
- `src/i18n/locales/{zh,en,ja}/workflow.json`：新增试运行抽屉文案。
- `tests/unit/workflow-try-run-display-state.test.ts`：新增状态映射测试。
- `tests/unit/use-embedded-workflow-try-run.test.tsx`：终态保持、旧 run 拒绝、新 request 测试。
- `tests/unit/workflow-embedded-trial-run-wiring.test.ts`：新增 route 关闭/继续接线约束测试。
- `tests/unit/test-run-drawer-model.test.ts`：新增 timeline/artifact/view 纯函数测试。
- `tests/unit/test-run-drawer.test.tsx`：新增五视图、等待态、detail 回归和可访问性测试。

### memory-center-web

- `src/agent-workflow/sto-claw-workflow-bridge.ts`：Web bridge 状态类型与 validator。
- `src/agent-workflow/sto-claw-workflow-bridge-controller.ts`：active request 与 retained display state 生命周期。
- `src/agent-workflow/sto-claw-workflow-bridge.test.ts`：terminal validator 测试。
- `src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts`：终态释放、新请求、旧消息隔离测试。
- `src/agent-workflow/components/WorkflowTrialRunStatusBadge.tsx`：新增运行状态徽标。
- `src/agent-workflow/components/WorkflowTrialRunStatusBadge.test.tsx`：新增四状态语义测试。
- `src/agent-workflow/components/WorkflowDesignerTopbar.tsx`：把徽标插入现有标题/保存时间区域，不改变操作顺序。
- `src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx`：顶栏结构、终态和主题 token 回归。
- `src/agent-workflow/styles.css`：徽标几何和语义状态 token。
- `src/agent-workflow/workflow-designer-header-state.test.ts`：workflow/nonce session 重置测试。

---

### Task 1: StoClaw bridge terminal contract and pure status mapper

**Files:**
- Modify: `src/lib/workflow-iframe-bridge.ts:17`
- Create: `src/pages/Workflow/hooks/workflow-try-run-display-state.ts`
- Modify: `tests/unit/workflow-iframe-bridge.test.ts`
- Create: `tests/unit/workflow-try-run-display-state.test.ts`

**Interfaces:**
- Consumes: `WorkflowRunStatus` from `src/types/workflow.ts`.
- Produces: `WorkflowTryRunState` including `cancelled | failed | completed`; `mapWorkflowRunStatusToTryRunState(status)` returning `running | cancelled | failed | completed | null`.

- [ ] **Step 1: Write failing bridge and mapper tests**

```ts
import { describe, expect, it } from 'vitest';
import { mapWorkflowRunStatusToTryRunState } from '@/pages/Workflow/hooks/workflow-try-run-display-state';

describe('mapWorkflowRunStatusToTryRunState', () => {
  it.each([
    ['pending', 'running'],
    ['running', 'running'],
    ['waiting_approval', 'running'],
    ['waiting_input', 'running'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['timeout', 'failed'],
    ['interrupted', 'failed'],
    ['completed', 'completed'],
    [undefined, null],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(mapWorkflowRunStatusToTryRunState(status)).toBe(expected);
  });
});
```

在 `tests/unit/workflow-iframe-bridge.test.ts` 增加类型/消息用例，验证 `cancelled`、`failed`、`completed` 可以作为 `sendTryRunState` 的状态值，其他字符串仍被 TypeScript/validator 拒绝。

- [ ] **Step 2: Run tests and verify the new module/terminal members are missing**

Run:

```bash
pnpm exec vitest run tests/unit/workflow-iframe-bridge.test.ts tests/unit/workflow-try-run-display-state.test.ts
```

Expected: FAIL，因为 mapper 文件尚不存在，且 `WorkflowTryRunState` 尚未包含三个终态。

- [ ] **Step 3: Extend the state union and implement the pure mapper**

```ts
export type WorkflowTryRunState =
  | 'idle'
  | 'confirming'
  | 'saving'
  | 'preparing'
  | 'running'
  | 'cancelled'
  | 'failed'
  | 'completed'
  | 'error';
```

```ts
import type { WorkflowTryRunState } from '@/lib/workflow-iframe-bridge';

export type WorkflowTryRunDisplayState = Extract<
  WorkflowTryRunState,
  'running' | 'cancelled' | 'failed' | 'completed'
>;

export function mapWorkflowRunStatusToTryRunState(
  status: string | null | undefined,
): WorkflowTryRunDisplayState | null {
  if (['pending', 'running', 'waiting_approval', 'waiting_input'].includes(status ?? '')) return 'running';
  if (status === 'cancelled') return 'cancelled';
  if (['failed', 'timeout', 'interrupted'].includes(status ?? '')) return 'failed';
  if (status === 'completed') return 'completed';
  return null;
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run tests/unit/workflow-iframe-bridge.test.ts tests/unit/workflow-try-run-display-state.test.ts
pnpm run typecheck
```

Expected: focused tests PASS; typecheck reports no new errors from these files.

- [ ] **Step 5: Record checkpoint**

Review:

```bash
git diff --check -- src/lib/workflow-iframe-bridge.ts src/pages/Workflow/hooks/workflow-try-run-display-state.ts tests/unit/workflow-iframe-bridge.test.ts tests/unit/workflow-try-run-display-state.test.ts
```

Suggested commit after the overlapping user changes are separated: `feat(workflow): add trial run terminal states`.

---

### Task 2: Bind terminal display state to the current request and run

**Files:**
- Modify: `src/pages/Workflow/hooks/use-embedded-workflow-try-run.ts:11-365`
- Modify: `src/pages/Workflow/workflow-routes.tsx:120-214`
- Modify: `tests/unit/use-embedded-workflow-try-run.test.tsx`
- Create: `tests/unit/workflow-embedded-trial-run-wiring.test.ts`

**Interfaces:**
- Consumes: `mapWorkflowRunStatusToTryRunState`, `runId: string | null`, `runStatus: string | null | undefined`.
- Produces: stable terminal message exactly once for the request/run pair; `rerun()` always creates a fresh request; drawer close only changes local visibility.

- [ ] **Step 1: Add failing coordinator tests for completion, cancellation, stale run and session reset**

Extend the hook test setup with `runId` and `runStatus`, then add:

```ts
it('retains a completed terminal state instead of returning to idle', async () => {
  const run = setup({ runId: null, runStatus: null });
  act(() => run.result.current.requestFromWeb('req-1'));
  await act(() => run.result.current.confirmAndPrepare());
  run.rerender({ ...run.base, isRunStarting: true, runId: null, runStatus: null });
  run.rerender({ ...run.base, isRunStarting: false, isRunActive: true, runId: 'run-1', runStatus: 'running' });
  run.rerender({ ...run.base, isRunStarting: false, isRunActive: false, runId: 'run-1', runStatus: 'completed' });

  await waitFor(() => expect(run.editor.sendTryRunState).toHaveBeenLastCalledWith('req-1', 'completed'));
  expect(run.editor.sendTryRunState).not.toHaveBeenCalledWith('req-1', 'idle');
});

it('ignores a late terminal status from the previous run after rerun starts', async () => {
  const run = setup({ runId: 'run-old', runStatus: 'cancelled' });
  await act(() => run.result.current.rerun());
  run.rerender({ ...run.base, runId: 'run-old', runStatus: 'cancelled' });
  expect(run.editor.sendTryRunState).not.toHaveBeenCalledWith('host-1', 'cancelled');
});
```

- [ ] **Step 2: Add a failing route wiring guard**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Workflow/workflow-routes.tsx'), 'utf8');

describe('embedded trial run wiring', () => {
  it('closes only the drawer and creates a new run for cancelled continue', () => {
    const closeHandler = source.match(/const closeRunDrawer = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    expect(closeHandler).toContain('tryRun.closeDrawer()');
    expect(closeHandler).not.toContain('cancelConfirmation');
    expect(source).toContain('onContinue={() => void embeddedTryRun.rerun()}');
    expect(source).not.toContain('onContinue={() => void tryRun.continueRun()}');
  });
});
```

- [ ] **Step 3: Run focused tests and confirm old idle/continue behavior fails**

Run:

```bash
pnpm exec vitest run tests/unit/use-embedded-workflow-try-run.test.tsx tests/unit/workflow-embedded-trial-run-wiring.test.ts
```

Expected: FAIL because the hook still sends `idle`, and route close/continue still call the old handlers.

- [ ] **Step 4: Add run identity to the active request and send stable terminal states once**

Use this shape:

```ts
interface ActiveTryRunRequest {
  requestId: string;
  epoch: number;
  workflowId: string;
  sessionIdentity: string;
  editor: WorkflowMcIframeEditorHandle | null;
  source: TryRunRequestSource;
  phase: TryRunRequestPhase;
  runId: string | null;
  terminalState: 'cancelled' | 'failed' | 'completed' | null;
}
```

Extend the options:

```ts
runId: string | null;
runStatus: string | null | undefined;
```

In the lifecycle effect:

```ts
const displayState = mapWorkflowRunStatusToTryRunState(runStatus);
if (running && request && current) {
  if (request.phase !== 'running') sendState(request, 'running');
  request.phase = 'running';
  if (runId) request.runId = runId;
} else if (
  request &&
  current &&
  request.phase === 'running' &&
  request.runId &&
  request.runId === runId &&
  displayState &&
  displayState !== 'running' &&
  request.terminalState === null
) {
  request.terminalState = displayState;
  sendState(request, displayState);
  activeRequestRef.current = null;
}
```

Do not send `idle` on a runtime terminal. Keep `error → idle` only for save/prepare/start failures that never establish a terminal local run.

- [ ] **Step 5: Separate drawer close and connect continue to fresh rerun**

```tsx
const closeRunDrawer = () => {
  tryRun.closeDrawer();
};

const embeddedTryRun = useEmbeddedWorkflowTryRun({
  // existing fields
  runId: tryRun.runId,
  runStatus: tryRun.executionState?.status,
});

<TestRunDrawer
  variant="trial"
  onClose={closeRunDrawer}
  onContinue={() => void embeddedTryRun.rerun()}
  onRerun={() => void embeddedTryRun.rerun()}
/>
```

The standalone designer/detail consumer may retain `tryRun.continueRun()`; only embedded trial continue changes semantics.

- [ ] **Step 6: Run focused tests and session regression tests**

Run:

```bash
pnpm exec vitest run tests/unit/use-embedded-workflow-try-run.test.tsx tests/unit/workflow-embedded-trial-run-wiring.test.ts tests/unit/workflow-editor-session-boundary.test.tsx tests/unit/workflow-iframe-session.test.ts
```

Expected: PASS, including old request replay, workflow switch and unmount rejection.

- [ ] **Step 7: Record checkpoint**

Review:

```bash
git diff --check -- src/pages/Workflow/hooks/use-embedded-workflow-try-run.ts src/pages/Workflow/workflow-routes.tsx tests/unit/use-embedded-workflow-try-run.test.tsx tests/unit/workflow-embedded-trial-run-wiring.test.ts
```

Suggested commit after prerequisite changes are separated: `fix(workflow): retain embedded trial run terminal state`.

---

### Task 3: Build the compact five-view trial drawer without regressing detail mode

**Files:**
- Create: `src/pages/WorkflowDesigner/components/test-run-drawer-model.ts`
- Create: `src/pages/WorkflowDesigner/components/test-run-trial-view.tsx`
- Modify: `src/pages/WorkflowDesigner/components/test-run-drawer.tsx:1-411`
- Modify: `src/i18n/locales/zh/workflow.json`
- Modify: `src/i18n/locales/en/workflow.json`
- Modify: `src/i18n/locales/ja/workflow.json`
- Create: `tests/unit/test-run-drawer-model.test.ts`
- Create: `tests/unit/test-run-drawer.test.tsx`

**Interfaces:**
- Consumes: existing `WorkflowRunResponse`, `WorkflowExecutionState`, trial callbacks and `variant`.
- Produces: `resolveTrialRunView`, `buildTrialRunTimeline`, `collectTrialRunArtifacts`, and a `TrialRunView` renderer. `TestRunDrawer` remains the public shared component.

- [ ] **Step 1: Write failing pure-model tests**

```ts
describe('test run drawer model', () => {
  it.each([
    [{ isStarting: true, status: null, launchError: null }, 'running'],
    [{ isStarting: false, status: 'cancelled', launchError: null }, 'cancelled'],
    [{ isStarting: false, status: 'timeout', launchError: null }, 'failed'],
    [{ isStarting: false, status: 'completed', launchError: null }, 'completed'],
  ] as const)('resolves $expected view', (input, expected) => {
    expect(resolveTrialRunView(input)).toBe(expected);
  });

  it('coalesces streaming deltas and deduplicates artifacts', () => {
    expect(buildTrialRunTimeline(runWithTwoAgentDeltas, null)).toEqual([
      expect.objectContaining({ label: '实时输出', detail: '第一段第二段' }),
    ]);
    expect(collectTrialRunArtifacts(runWithDuplicateArtifact, null)).toHaveLength(1);
  });
});
```

Use explicit fixtures with one local file artifact and one HTTP artifact so open/download target selection is covered.

- [ ] **Step 2: Write failing component tests for exact geometry and five views**

```tsx
it('renders the approved running geometry and fixed cancel action', () => {
  render(<TestRunDrawer {...runningProps} variant="trial" open />);
  expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-[min(500px,100vw)]');
  expect(screen.getByText('关闭弹窗后不会中断运行')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '取消运行' })).toHaveClass('h-9', 'rounded-[10px]');
});

it.each([
  ['cancelled', '运行已取消', '继续运行'],
  ['failed', '运行失败', '重新运行'],
] as const)('renders %s with prior timeline and footer action', (status, label, action) => {
  renderDrawer(status);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByText('Agent开始执行')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
});

it('collapses and expands completed execution independently from artifacts', () => {
  renderDrawer('completed');
  expect(screen.queryByTestId('trial-run-process-card')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开执行过程' }));
  expect(screen.getByTestId('trial-run-process-card')).toBeInTheDocument();
  expect(screen.getByTestId('trial-run-artifact-card')).toBeInTheDocument();
});
```

Add separate assertions for approval buttons, JSON validation feedback, artifact open/download disabled state, visible focus labels and `variant="detail"` retaining “运行详情”.

- [ ] **Step 3: Run tests and verify the new model/view files are missing**

Run:

```bash
pnpm exec vitest run tests/unit/test-run-drawer-model.test.ts tests/unit/test-run-drawer.test.tsx
```

Expected: FAIL because the pure model and compact trial view do not exist.

- [ ] **Step 4: Extract pure model helpers without changing rendered behavior**

Move the existing formatting/timeline/artifact logic into the model module and export typed values:

```ts
export type TrialRunView = 'running' | 'completed' | 'failed' | 'cancelled';
export type TrialRunTimelineItem = {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string;
  tone: 'default' | 'running' | 'success' | 'danger' | 'tool' | 'artifact';
};

export function resolveTrialRunView(input: {
  isStarting: boolean;
  isRunActive?: boolean;
  status: string | null | undefined;
  launchError: string | null;
}): TrialRunView {
  if (input.launchError || ['failed', 'timeout', 'interrupted'].includes(input.status ?? '')) return 'failed';
  if (input.status === 'cancelled') return 'cancelled';
  if (input.status === 'completed') return 'completed';
  return 'running';
}
```

Keep artifact opening through `invokeIpc('shell:openPath', path)` / `openExternalUrl(url)`; implement download with the existing host API file-read pattern for local files and an external URL for remote files. Do not introduce a new direct IPC channel.

- [ ] **Step 5: Implement the trial-only 500px structure**

The root geometry must use these classes:

```tsx
<SheetContent
  side="right"
  className="flex w-full flex-col gap-0 border-l border-border bg-background p-0 text-foreground sm:max-w-[min(500px,100vw)]"
>
  <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-3">
    <h2 className="text-sm font-semibold">{t('trialRun.resultTitle')}</h2>
    <CloseButton />
  </header>
  <div className="min-h-0 flex-1 overflow-hidden px-3 py-2">
    <TrialRunStateContent />
  </div>
  <footer className="flex h-[60px] shrink-0 items-center border-t border-border px-3">
    <Button className="h-9 w-full rounded-[10px]">{footerLabel}</Button>
  </footer>
</SheetContent>
```

Use a 42px status row; 1px border and 10–12px radius cards; a dot-and-line timeline with title left/time right; thin internal vertical scrolling. Completed defaults to process collapsed, with an `aria-expanded` control on the status row; expansion inserts the process card above the artifact card. Running alone shows the “close does not stop” notice. Cancelled/failed preserve the timeline.

- [ ] **Step 6: Preserve waiting approval/input and artifact actions**

For invalid JSON, render a visible message rather than silently swallowing parse errors:

```tsx
try {
  props.onSubmitInput?.(JSON.parse(inputJson));
  setInputError(null);
} catch {
  setInputError(t('trialRun.inputInvalid'));
}
```

Artifact header buttons require `aria-label`, `title`, `disabled={!target}` and `focus-visible:ring-2`. Status icons use `aria-hidden`; state text remains visible so color is never the only signal.

- [ ] **Step 7: Keep detail presentation isolated**

Branch before the new trial JSX:

```tsx
if (props.variant === 'detail') {
  return <DetailRunDrawer {...props} timeline={timeline} artifacts={artifacts} />;
}
return <TrialRunDrawerView {...props} timeline={timeline} artifacts={artifacts} />;
```

Do not change `WorkflowCompletionNotifier` or history detail callbacks beyond passing/retaining `variant="detail"` where needed.

- [ ] **Step 8: Add localized strings in all existing workflow namespaces**

Use the same key structure in zh/en/ja:

```json
{
  "trialRun": {
    "resultTitle": "试运行结果",
    "runningNotice": "工作流正在运行，可能需要一些时间。关闭弹窗后不会中断运行。",
    "running": "运行中",
    "cancelled": "运行已取消",
    "failed": "运行失败",
    "completed": "运行完成",
    "process": "执行过程",
    "artifact": "产物名称",
    "cancel": "取消运行",
    "continue": "继续运行",
    "rerun": "重新运行",
    "inputInvalid": "请输入有效的 JSON"
  }
}
```

Translate the values for English and Japanese; keep the key set identical.

- [ ] **Step 9: Run component, type and targeted lint verification**

Run:

```bash
pnpm exec vitest run tests/unit/test-run-drawer-model.test.ts tests/unit/test-run-drawer.test.tsx tests/unit/workflow-card-scheduled-task.test.tsx
pnpm run typecheck
pnpm exec eslint src/pages/WorkflowDesigner/components/test-run-drawer.tsx src/pages/WorkflowDesigner/components/test-run-trial-view.tsx src/pages/WorkflowDesigner/components/test-run-drawer-model.ts tests/unit/test-run-drawer.test.tsx tests/unit/test-run-drawer-model.test.ts
```

Expected: PASS; detail-mode regression remains green; no JSX hardcoded copy added outside the locale files.

- [ ] **Step 10: Record checkpoint**

Review exact class geometry and no-overflow behavior:

```bash
git diff --check -- src/pages/WorkflowDesigner/components/test-run-drawer.tsx src/pages/WorkflowDesigner/components/test-run-trial-view.tsx src/pages/WorkflowDesigner/components/test-run-drawer-model.ts src/i18n/locales/zh/workflow.json src/i18n/locales/en/workflow.json src/i18n/locales/ja/workflow.json tests/unit/test-run-drawer.test.tsx tests/unit/test-run-drawer-model.test.ts
```

Suggested commit after prerequisite changes are separated: `feat(workflow): align trial run drawer with MasterGo`.

---

### Task 4: Retain terminal display state in memory-center-web bridge controller

**Files:**
- Modify: `../memory-center-web/src/agent-workflow/sto-claw-workflow-bridge.ts:15-163`
- Modify: `../memory-center-web/src/agent-workflow/sto-claw-workflow-bridge.test.ts`
- Modify: `../memory-center-web/src/agent-workflow/sto-claw-workflow-bridge-controller.ts:43-200`
- Modify: `../memory-center-web/src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts`
- Modify: `../memory-center-web/src/agent-workflow/workflow-designer-header-state.test.ts`

**Interfaces:**
- Consumes: authenticated Host `workflow-try-run-state` messages.
- Produces: terminal validator support; release of active request on `cancelled | failed | completed`; retained `onTryRunState(terminal)` display until a new request/session.

- [ ] **Step 1: Write failing validator and controller tests**

```ts
it.each(['cancelled', 'failed', 'completed'] as const)('accepts %s as a stable terminal state', (state) => {
  expect(isStoClawTryRunStateMessage({
    ...envelope,
    type: STOCLAW_WORKFLOW_TRY_RUN_STATE,
    state,
  })).toBe(true);
});

it('releases the request after terminal state and ignores its late idle', async () => {
  const onTryRunState = vi.fn();
  const { controller, parentWindow } = createController({ onTryRunState });
  const first = controller.requestTryRun()!;
  await controller.handleMessage(tryRunStateEvent(parentWindow, first, 'running'));
  await controller.handleMessage(tryRunStateEvent(parentWindow, first, 'completed'));
  const second = controller.requestTryRun();
  await controller.handleMessage(tryRunStateEvent(parentWindow, first, 'idle'));

  expect(second).not.toBeNull();
  expect(onTryRunState).toHaveBeenLastCalledWith('completed');
});
```

Add a second test where a new request has started and a late terminal from the old request is ignored.

- [ ] **Step 2: Run Web bridge tests and confirm terminal states fail validation**

Run from `../memory-center-web`:

```bash
pnpm exec vitest run src/agent-workflow/sto-claw-workflow-bridge.test.ts src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts src/agent-workflow/workflow-designer-header-state.test.ts
```

Expected: FAIL because terminal states are absent and do not release the request.

- [ ] **Step 3: Extend the Web union/validator and split terminal release from display state**

```ts
export type StoClawTryRunState =
  | 'idle'
  | 'confirming'
  | 'saving'
  | 'preparing'
  | 'running'
  | 'cancelled'
  | 'failed'
  | 'completed'
  | 'error';

const isStableTerminal = (state: StoClawTryRunState) =>
  state === 'cancelled' || state === 'failed' || state === 'completed';
```

Inside the authenticated state handler:

```ts
options.onTryRunState(message.state);
if (message.state === 'saving') activeTryRunSavingReported = true;
if (message.state === 'idle' || isStableTerminal(message.state)) {
  activeTryRunRequestId = null;
  activeTryRunSavingReported = false;
}
```

When `activeTryRunRequestId === null`, only accept the existing `saving` recovery path. This makes late `idle`/terminal events from a released request harmless. `requestTryRun()` sets the new active ID before any Host reply.

- [ ] **Step 4: Run focused tests and type-check**

Run from `../memory-center-web`:

```bash
pnpm exec vitest run src/agent-workflow/sto-claw-workflow-bridge.test.ts src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts src/agent-workflow/workflow-designer-header-state.test.ts
pnpm run type-check
```

Expected: PASS; workflow/nonce mismatch still resolves to `idle` and empty capabilities.

- [ ] **Step 5: Record checkpoint**

Review from `../memory-center-web`:

```bash
git diff --check -- src/agent-workflow/sto-claw-workflow-bridge.ts src/agent-workflow/sto-claw-workflow-bridge.test.ts src/agent-workflow/sto-claw-workflow-bridge-controller.ts src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts src/agent-workflow/workflow-designer-header-state.test.ts
```

Suggested commit after prerequisite changes are separated: `feat(workflow): retain local trial run terminal state`.

---

### Task 5: Add the four-state badge to the existing approved Web header

**Files:**
- Create: `../memory-center-web/src/agent-workflow/components/WorkflowTrialRunStatusBadge.tsx`
- Create: `../memory-center-web/src/agent-workflow/components/WorkflowTrialRunStatusBadge.test.tsx`
- Modify: `../memory-center-web/src/agent-workflow/components/WorkflowDesignerTopbar.tsx:1-213`
- Modify: `../memory-center-web/src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx`
- Modify: `../memory-center-web/src/agent-workflow/styles.css:4769-5051`

**Interfaces:**
- Consumes: `StoClawTryRunState` already passed to `WorkflowDesignerTopbar`.
- Produces: an icon+text badge for `running | cancelled | failed | completed`; returns `null` for startup/idle/error states.

- [ ] **Step 1: Write failing badge and header placement tests**

```tsx
it.each([
  ['running', '运行中', 'running'],
  ['cancelled', '运行已取消', 'warning'],
  ['failed', '运行失败', 'danger'],
  ['completed', '运行完成', 'success'],
] as const)('renders %s with icon and semantic tone', (state, label, tone) => {
  const html = renderToStaticMarkup(<WorkflowTrialRunStatusBadge state={state} />);
  expect(html).toContain(label);
  expect(html).toContain(`workflow-trial-status--${tone}`);
  expect(html).toContain('aria-label');
});

it('keeps the approved action order while placing status beside save time', () => {
  const html = renderToStaticMarkup(<WorkflowDesignerTopbar {...baseProps} trialRunState="completed" />);
  expect(html.indexOf('最近保存')).toBeLessThan(html.indexOf('运行完成'));
  expect(html.indexOf('版本列表')).toBeLessThan(html.indexOf('保存草稿'));
  expect(html.indexOf('保存草稿')).toBeLessThan(html.indexOf('试运行'));
  expect(html.indexOf('试运行')).toBeLessThan(html.indexOf('发布'));
});
```

Update the old light-only assertion so it verifies semantic variables and a scoped dark override rather than forbidding dark support.

- [ ] **Step 2: Run focused Topbar tests and confirm the badge is absent**

Run from `../memory-center-web`:

```bash
pnpm exec vitest run src/agent-workflow/components/WorkflowTrialRunStatusBadge.test.tsx src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx
```

Expected: FAIL because the badge component and terminal labels do not exist.

- [ ] **Step 3: Implement the badge with semantic config**

```tsx
const STATUS_CONFIG = {
  running: { label: '运行中', tone: 'running', Icon: LoaderCircle },
  cancelled: { label: '运行已取消', tone: 'warning', Icon: CircleAlert },
  failed: { label: '运行失败', tone: 'danger', Icon: CircleX },
  completed: { label: '运行完成', tone: 'success', Icon: CircleCheck },
} as const;

export function WorkflowTrialRunStatusBadge({ state }: { state: StoClawTryRunState }) {
  const config = state in STATUS_CONFIG
    ? STATUS_CONFIG[state as keyof typeof STATUS_CONFIG]
    : null;
  if (!config) return null;
  const { Icon } = config;
  return (
    <span
      className={`workflow-trial-status workflow-trial-status--${config.tone}`}
      aria-label={`试运行状态：${config.label}`}
    >
      <Icon size={12} aria-hidden />
      {config.label}
    </span>
  );
}
```

Do not animate the running icon when `prefers-reduced-motion: reduce` is active.

- [ ] **Step 4: Insert the badge without moving existing actions**

Inside `topbar-meta topbar-meta-inline`, immediately after the save time:

```tsx
<span className="topbar-meta-item">最近保存：{savedAt}</span>
<WorkflowTrialRunStatusBadge state={trialRunState} />
```

Keep `trialRunActionLabel()` limited to `saving/preparing/running`; after a stable terminal the existing button reads “试运行” and can start a new request.

- [ ] **Step 5: Add light/dark-compatible semantic CSS**

Define scoped variables on `.workflow-designer-topbar` and consume them in the badge:

```css
.workflow-designer-topbar {
  --workflow-status-running-text: #ff6700;
  --workflow-status-running-bg: #fff3e8;
  --workflow-status-warning-text: #d46b08;
  --workflow-status-warning-bg: #fff7e6;
  --workflow-status-danger-text: #e5484d;
  --workflow-status-danger-bg: #fff1f0;
  --workflow-status-success-text: #1f9d55;
  --workflow-status-success-bg: #edf9f0;
}

.workflow-trial-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 20px;
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
}
```

Use the project’s configured Tailwind class strategy and add `.dark .workflow-designer-topbar { ... }` overrides for the status surface/text variables; do not alter component layout. Preserve the already approved header dimensions, safe areas and action order.

- [ ] **Step 6: Run Web component, type and lint tests**

Run from `../memory-center-web`:

```bash
pnpm exec vitest run src/agent-workflow/components/WorkflowTrialRunStatusBadge.test.tsx src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx src/agent-workflow/workflow-designer-header-state.test.ts
pnpm run type-check
pnpm exec eslint src/agent-workflow/components/WorkflowTrialRunStatusBadge.tsx src/agent-workflow/components/WorkflowTrialRunStatusBadge.test.tsx src/agent-workflow/components/WorkflowDesignerTopbar.tsx src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx
```

Expected: PASS; standalone Web still hides the local trial-run action/status.

- [ ] **Step 7: Record checkpoint**

Review from `../memory-center-web`:

```bash
git diff --check -- src/agent-workflow/components/WorkflowTrialRunStatusBadge.tsx src/agent-workflow/components/WorkflowTrialRunStatusBadge.test.tsx src/agent-workflow/components/WorkflowDesignerTopbar.tsx src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx src/agent-workflow/styles.css
```

Suggested commit after prerequisite changes are separated: `feat(workflow): show trial run status in embedded header`.

---

### Task 6: Cross-project regression, communication replay and visual acceptance

**Files:**
- Modify only if behavior/contract needs user-facing documentation: `README.md`, `README.zh-CN.md`, `README.ja-JP.md` in affected repositories.
- Do not modify: any `memory-center` production file.

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: evidence that bridge delivery, drawer UI, detail mode and both repositories remain compatible.

- [ ] **Step 1: Run the complete focused StoClaw suite**

Run from `sto-claw`:

```bash
pnpm exec vitest run \
  tests/unit/workflow-iframe-bridge.test.ts \
  tests/unit/workflow-try-run-display-state.test.ts \
  tests/unit/use-embedded-workflow-try-run.test.tsx \
  tests/unit/workflow-embedded-trial-run-wiring.test.ts \
  tests/unit/workflow-iframe-request-manager.test.ts \
  tests/unit/workflow-iframe-session.test.ts \
  tests/unit/test-run-drawer-model.test.ts \
  tests/unit/test-run-drawer.test.tsx \
  tests/unit/workflow-editor-session-boundary.test.tsx
pnpm run typecheck
```

Expected: all focused tests PASS and typecheck exits 0.

- [ ] **Step 2: Run communication replay and compare**

Run from `sto-claw`:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

Expected: replay completes and compare reports no communication regression outside the explicitly extended terminal states.

- [ ] **Step 3: Run the complete focused memory-center-web suite**

Run from `../memory-center-web`:

```bash
pnpm exec vitest run \
  src/agent-workflow/sto-claw-workflow-bridge.test.ts \
  src/agent-workflow/sto-claw-workflow-bridge-controller.test.ts \
  src/agent-workflow/workflow-designer-header-state.test.ts \
  src/agent-workflow/components/WorkflowTrialRunStatusBadge.test.tsx \
  src/agent-workflow/components/WorkflowDesignerTopbar.test.tsx
pnpm run type-check
pnpm run lint
```

Expected: all tests, type-check and lint PASS.

- [ ] **Step 4: Perform the five-view visual comparison**

Capture and compare these exact states side by side with MasterGo node `48:46129` and the approved five-panel image:

1. Running: notice + status + expanded timeline + cancel.
2. Cancelled: retained timeline + continue.
3. Failed: error + retained timeline + rerun.
4. Completed collapsed: process control in status row + artifact card filling content.
5. Completed expanded: process card above artifact card + rerun.

For each state record: 500px width, 52px header, 42px status row, 12px horizontal inset, card radius/border, timestamp alignment, thin scrollbar, artifact actions, 60px footer, 36px full-width button, keyboard focus, narrow-window overflow, light and dark semantic contrast.

- [ ] **Step 5: Manually verify lifecycle scenarios**

Verify in this order:

```text
start → close drawer → run continues → header completes
start → cancel → old run remains CANCELLED → continue → save latest draft → new runId
start → fail → rerun → old late event does not replace new state
running → waiting_approval → approve/reject remains usable
running → waiting_input → invalid JSON shows error → valid JSON submits
switch workflow/iframe session → old terminal event is ignored → new header is idle
open historical run/detail notification → detail layout and actions remain present
open memory-center-web standalone → local Host status/drawer remains inactive
```

- [ ] **Step 6: Review documentation and forbidden-file scope**

Run:

```bash
git diff --name-only
git -C ../memory-center-web diff --name-only
git -C ../memory-center diff --name-only
```

Confirm no package manifests, lockfiles, scripts, build config, CI files or `memory-center` production files were changed by this feature. Review all three README variants; only update them if the bridge terminal contract or user-visible workflow behavior needs explanation.

- [ ] **Step 7: Final diff review and handoff**

Run:

```bash
git diff --check
git -C ../memory-center-web diff --check
```

Report passing commands, any pre-existing unrelated failures, changed files grouped by repository, visual QA evidence, and suggested commit messages. Do not stage or commit overlapping dirty files without the user first separating their existing changes.

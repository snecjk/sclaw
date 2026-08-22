import { forwardRef } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headerOptions: vi.fn(),
  embedded: {
    confirmOpen: false,
    requestInFlight: false,
  },
  designer: {
    runId: null as string | null,
    isStartupDialogOpen: false,
    isStarting: false,
    isRunActive: false,
  },
}));

vi.mock('@/hooks/use-workflow-editor-content-header', () => ({
  useWorkflowEditorContentHeader: (options: unknown) => mocks.headerOptions(options),
}));

vi.mock('@/pages/Workflow/hooks/use-embedded-workflow-try-run', () => ({
  useEmbeddedWorkflowTryRun: () => ({
    ...mocks.embedded,
    requestFromHostFallback: vi.fn(),
    requestFromWeb: vi.fn(),
    cancelConfirmation: vi.fn(),
    confirmAndPrepare: vi.fn(),
    rerun: vi.fn(),
    invalidateSession: vi.fn(),
  }),
}));

vi.mock('@/pages/WorkflowDesigner/hooks/use-designer-try-run', () => ({
  useDesignerTryRun: () => ({
    run: null,
    executionState: null,
    runWorkflowVersion: null,
    isCancelling: false,
    isDrawerOpen: false,
    isDraftSnapshot: false,
    startupSchema: null,
    startupDefaultValues: {},
    runtimeUploadNodes: [],
    launchError: null,
    begin: vi.fn(),
    confirmStartup: vi.fn(),
    cancelStartupDialog: vi.fn(),
    cancel: vi.fn(),
    continueRun: vi.fn(),
    rerun: vi.fn(),
    openExistingRun: vi.fn(),
    closeDrawer: vi.fn(),
    decideApproval: vi.fn(),
    submitInput: vi.fn(),
    ...mocks.designer,
  }),
}));

vi.mock('@/pages/Workflow/components/workflow-mc-iframe-editor', () => ({
  WorkflowMcIframeEditor: forwardRef(function WorkflowMcIframeEditorMock() {
    return <div data-testid="workflow-editor" />;
  }),
}));

vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/pages/WorkflowDesigner/components/startup-run-dialog', () => ({ StartupRunDialog: () => null }));
vi.mock('@/pages/WorkflowDesigner/components/test-run-drawer', () => ({ TestRunDrawer: () => null }));
vi.mock('@/pages/WorkflowDesigner/components/local-run-history-dialog', () => ({ LocalRunHistoryDialog: () => null }));

import { WorkflowRoutes } from '@/pages/Workflow/workflow-routes';

function routeView() {
  return (
    <MemoryRouter initialEntries={['/workflow/wf-1']}>
      <Routes>
        <Route path="/workflow/*" element={<WorkflowRoutes />} />
      </Routes>
    </MemoryRouter>
  );
}

function lastHeaderOptions(): { backDisabled?: boolean } {
  return mocks.headerOptions.mock.calls.at(-1)?.[0] as { backDisabled?: boolean };
}

describe('workflow editor fallback back lock', () => {
  beforeEach(() => {
    mocks.headerOptions.mockClear();
    Object.assign(mocks.embedded, { confirmOpen: false, requestInFlight: false });
    Object.assign(mocks.designer, {
      runId: null,
      isStartupDialogOpen: false,
      isStarting: false,
      isRunActive: false,
    });
  });

  it.each([
    ['confirmation', { confirmOpen: true }, {}],
    ['draft request', { requestInFlight: true }, {}],
    ['startup dialog', {}, { isStartupDialogOpen: true }],
    ['run startup', {}, { isStarting: true }],
  ])('locks fallback back navigation during %s', (_name, embedded, designer) => {
    Object.assign(mocks.embedded, embedded);
    Object.assign(mocks.designer, designer);

    render(routeView());

    expect(lastHeaderOptions().backDisabled).toBe(true);
  });

  it('allows fallback back navigation once a starting active run has a stable run id', () => {
    Object.assign(mocks.designer, {
      runId: 'run-new',
      isStarting: true,
      isRunActive: true,
    });

    render(routeView());

    expect(lastHeaderOptions().backDisabled).toBe(false);
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowEditorSessionBoundary } from '@/pages/Workflow/workflow-routes';
import { useWorkflowUiStore } from '@/stores/workflow-ui';

function SessionProbe({ workflowId, onBegin }: { workflowId: string; onBegin: (versionId: string) => void }) {
  const [startupVersion, setStartupVersion] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div>
      <span>{workflowId}</span>
      <span>{startupVersion ?? 'no-startup'}</span>
      <span>{drawerOpen ? 'drawer-open' : 'drawer-closed'}</span>
      <button type="button" onClick={() => setStartupVersion(`${workflowId}-version`)}>prepare</button>
      <button type="button" onClick={() => setDrawerOpen(true)}>run</button>
      <button type="button" onClick={() => startupVersion && onBegin(startupVersion)}>begin</button>
    </div>
  );
}

describe('WorkflowEditorSessionBoundary', () => {
  it('remounts startup snapshot and run UI when the workflow id changes', () => {
    const onBegin = vi.fn();
    const { rerender } = render(
      <WorkflowEditorSessionBoundary workflowId="wf-a">
        <SessionProbe workflowId="wf-a" onBegin={onBegin} />
      </WorkflowEditorSessionBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    expect(screen.getByText('wf-a-version')).toBeInTheDocument();
    expect(screen.getByText('drawer-open')).toBeInTheDocument();

    rerender(
      <WorkflowEditorSessionBoundary workflowId="wf-b">
        <SessionProbe workflowId="wf-b" onBegin={onBegin} />
      </WorkflowEditorSessionBoundary>,
    );

    expect(screen.getByText('no-startup')).toBeInTheDocument();
    expect(screen.getByText('drawer-closed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'begin' }));
    expect(onBegin).not.toHaveBeenCalledWith('wf-a-version');
  });

  it('resets embedded header ownership when the workflow id changes', () => {
    useWorkflowUiStore.setState({ embeddedHeaderOwned: false });
    const { rerender } = render(
      <WorkflowEditorSessionBoundary workflowId="wf-a">
        <span>workflow-a</span>
      </WorkflowEditorSessionBoundary>,
    );
    act(() => useWorkflowUiStore.getState().setEmbeddedHeaderOwned(true));

    rerender(
      <WorkflowEditorSessionBoundary workflowId="wf-b">
        <span>workflow-b</span>
      </WorkflowEditorSessionBoundary>,
    );

    expect(useWorkflowUiStore.getState().embeddedHeaderOwned).toBe(false);
  });

  it('resets embedded header ownership when the workflow route unmounts', () => {
    useWorkflowUiStore.setState({ embeddedHeaderOwned: false });
    const { unmount } = render(
      <WorkflowEditorSessionBoundary workflowId="wf-a">
        <span>workflow-a</span>
      </WorkflowEditorSessionBoundary>,
    );
    act(() => useWorkflowUiStore.getState().setEmbeddedHeaderOwned(true));

    unmount();

    expect(useWorkflowUiStore.getState().embeddedHeaderOwned).toBe(false);
  });
});

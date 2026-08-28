import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  AppShellLayoutProvider,
  useAppShellLayout,
} from '@/components/layout/app-shell-layout-context';
import { useChatPreviewPanel } from '@/hooks/use-chat-preview-panel';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useWorkflowUiStore } from '@/stores/workflow-ui';

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (s: { workflowCardStates: Record<string, never> }) => unknown) =>
    selector({ workflowCardStates: {} }),
}));

vi.mock('@/hooks/use-session-workflow-preview', () => ({
  useSessionWorkflowPreview: () => ({
    workflowId: null,
    showEditWorkflow: false,
  }),
}));

vi.mock('@/lib/session-workflow-context', () => ({
  filterSessionWorkflowCardStates: () => ({}),
}));

vi.mock('@/lib/file-preview-debug', () => ({
  logFilePreview: vi.fn(),
}));

const previewFile: AttachedFileMeta = {
  filePath: '/tmp/a.md',
  fileName: 'a.md',
  mimeType: 'text/markdown',
  fileSize: 12,
  preview: null,
};

vi.mock('@/pages/Chat/message-utils', () => ({
  usePreviewableFiles: () => [previewFile],
}));

function messageStub(): RawMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: [{ type: 'text', text: 'hi' }],
    timestamp: Date.now(),
  } as unknown as RawMessage;
}

function PreviewControls() {
  const preview = useChatPreviewPanel([messageStub()], 'agent:main:s1');
  return (
    <>
      <button type="button" onClick={() => preview.openArtifactPreview(previewFile)}>
        open preview
      </button>
      <button type="button" onClick={preview.expandPreview}>
        expand preview
      </button>
      <button type="button" onClick={preview.restorePreview}>
        restore preview
      </button>
    </>
  );
}

function PreviewShellProbe({ showPreviewControls = true }: { showPreviewControls?: boolean }) {
  const { snapshot } = useAppShellLayout();
  return (
    <>
      <div
        data-testid="preview-shell-probe"
        data-width={String(snapshot.effectiveSidebarWidth)}
        data-user={snapshot.collapseReasons.user ? '1' : '0'}
        data-context={snapshot.collapseReasons.context ? '1' : '0'}
      />
      {showPreviewControls ? <PreviewControls /> : null}
    </>
  );
}

function PreviewShellHarness({ showPreviewControls = true }: { showPreviewControls?: boolean }) {
  return (
    <MemoryRouter>
      <AppShellLayoutProvider>
        <PreviewShellProbe showPreviewControls={showPreviewControls} />
      </AppShellLayoutProvider>
    </MemoryRouter>
  );
}

describe('useChatPreviewPanel PreviewMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_STOCLAW_SIDEBAR_LAYOUT', 'provincial');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    useSettingsStore.setState({ sidebarCollapsed: false, sidebarPreferredWidth: 260 });
    useWorkflowUiStore.setState({ editorActive: false });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('starts closed and opens to split', () => {
    const { result } = renderHook(() => useChatPreviewPanel([messageStub()], 'agent:main:s1'));
    expect(result.current.previewMode).toBe('closed');
    expect(result.current.showPreviewPanel).toBe(false);

    act(() => {
      result.current.openPreviewPanel();
    });

    expect(result.current.previewMode).toBe('split');
    expect(result.current.isPreviewSplit).toBe(true);
    expect(result.current.showPreviewPanel).toBe(true);
  });

  it('supports split → expanded → restore → split', () => {
    const { result } = renderHook(() => useChatPreviewPanel([messageStub()], 'agent:main:s1'));

    act(() => {
      result.current.openArtifactPreview(previewFile);
    });
    expect(result.current.previewMode).toBe('split');

    act(() => {
      result.current.expandPreview();
    });
    expect(result.current.previewMode).toBe('expanded');
    expect(result.current.isPreviewExpanded).toBe(true);

    act(() => {
      result.current.restorePreview();
    });
    expect(result.current.previewMode).toBe('split');
  });

  it('closes from split and expanded', () => {
    const { result } = renderHook(() => useChatPreviewPanel([messageStub()], 'agent:main:s1'));

    act(() => {
      result.current.openPreviewPanel();
      result.current.expandPreview();
    });
    expect(result.current.previewMode).toBe('expanded');

    act(() => {
      result.current.closePreviewPanel();
    });
    expect(result.current.previewMode).toBe('closed');
  });

  it('resets to closed on session change', () => {
    const { result, rerender } = renderHook(
      ({ sessionKey }) => useChatPreviewPanel([messageStub()], sessionKey),
      { initialProps: { sessionKey: 'agent:main:a' } },
    );

    act(() => {
      result.current.openPreviewPanel();
      result.current.expandPreview();
    });
    expect(result.current.previewMode).toBe('expanded');

    rerender({ sessionKey: 'agent:main:b' });
    expect(result.current.previewMode).toBe('closed');
    expect(result.current.activePreviewFilePath).toBeNull();
  });

  it('temporarily collapses the real AppShell only while preview is expanded', () => {
    render(<PreviewShellHarness />);
    const probe = screen.getByTestId('preview-shell-probe');

    expect(probe.getAttribute('data-width')).toBe('260');

    fireEvent.click(screen.getByRole('button', { name: 'open preview' }));
    expect(probe.getAttribute('data-width')).toBe('260');

    fireEvent.click(screen.getByRole('button', { name: 'expand preview' }));
    expect(probe.getAttribute('data-width')).toBe('0');
    expect(probe.getAttribute('data-context')).toBe('1');
    expect(probe.getAttribute('data-user')).toBe('0');
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'restore preview' }));
    expect(probe.getAttribute('data-width')).toBe('260');
    expect(probe.getAttribute('data-context')).toBe('0');
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(false);
  });

  it('clears the real AppShell preview context when the preview hook unmounts', () => {
    const view = render(<PreviewShellHarness />);
    const probe = screen.getByTestId('preview-shell-probe');

    fireEvent.click(screen.getByRole('button', { name: 'open preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'expand preview' }));
    expect(probe.getAttribute('data-width')).toBe('0');

    view.rerender(<PreviewShellHarness showPreviewControls={false} />);
    expect(probe.getAttribute('data-width')).toBe('260');
    expect(probe.getAttribute('data-context')).toBe('0');
  });

  it('owns expand/restore in the shared Header action group without DOM Fullscreen', () => {
    const panelSrc = readPreviewPanelSource();
    const headerActionsSrc = readHeaderActionsSource();
    expect(panelSrc).not.toContain('requestFullscreen');
    expect(panelSrc).not.toContain('exitFullscreen');
    expect(panelSrc).not.toContain('onExpandWorkspace');
    expect(panelSrc).not.toContain('onRestoreWorkspace');
    expect(headerActionsSrc).toContain('data-slot="preview-workspace-layout-toggle"');
    expect(headerActionsSrc).toContain('onExpandWorkspace');
    expect(headerActionsSrc).toContain('onRestoreWorkspace');
    expect(headerActionsSrc.indexOf('data-slot="preview-workspace-layout-toggle"')).toBeLessThan(
      headerActionsSrc.indexOf('<ChatPreviewToggleHeaderAction'),
    );
  });
});

function readPreviewPanelSource(): string {
  // inline require via fs to avoid importing React tree
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(process.cwd(), 'src/pages/Chat/ChatPreviewPanel.tsx'), 'utf8');
}

function readHeaderActionsSource(): string {
  // inline require via fs to avoid importing the whole tooltip tree
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(process.cwd(), 'src/pages/Chat/ChatSearchBar.tsx'), 'utf8');
}

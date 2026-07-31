import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatPreviewPanel } from '@/hooks/use-chat-preview-panel';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';

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

describe('useChatPreviewPanel PreviewMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('does not use DOM Fullscreen for expand/restore', () => {
    const panelSrc = readPreviewPanelSource();
    expect(panelSrc).not.toContain('requestFullscreen');
    expect(panelSrc).not.toContain('exitFullscreen');
    expect(panelSrc).toContain('onExpandWorkspace');
    expect(panelSrc).toContain('onRestoreWorkspace');
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

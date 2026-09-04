/**
 * T04 版本页 AppDevDiffViewer 组件渲染测试：
 * 消费 diffRequest → 拉 diff → 文件清单（M/A/D 徽章 + +N −M）→ Monaco DiffEditor 收全文对；
 * 二进制/超大文件只显示统计；空态/错误态正常。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDevDiffViewer } from '@/components/app-dev/AppDevDiffViewer';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';

const mocks = vi.hoisted(() => ({
  diffAppCheckpoint: vi.fn(),
  ensureMonacoConfigured: vi.fn(),
  diffEditorProps: { current: null as Record<string, unknown> | null },
}));

vi.mock('@/lib/app-dev-api', () => ({
  diffAppCheckpoint: (...args: unknown[]) => mocks.diffAppCheckpoint(...args),
}));
vi.mock('@/lib/monaco-setup', () => ({
  ensureMonacoConfigured: () => mocks.ensureMonacoConfigured(),
  languageFromPath: (path: string) => (path.endsWith('.ts') || path.endsWith('.tsx') ? 'typescript' : 'plaintext'),
}));
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: (props: Record<string, unknown>) => {
    mocks.diffEditorProps.current = props;
    return <div data-testid="mock-diff-editor" />;
  },
}));

const WORKBENCH_DEFAULTS = {
  mode: 'preview',
  stageCollapsed: false,
  device: 'desktop',
  tuneMode: 'chat',
  diffRequest: null,
  versionRestoreRequest: null,
} as const;

const DIFF = {
  hash: 'abc123def456',
  parentHash: 'fff000eee111',
  subject: '对话修改 · 把标题改蓝',
  files: [
    {
      path: 'src/pages/home.page.json',
      status: 'M' as const,
      added: 26,
      removed: 60,
      original: '{\n  "title": "旧标题"\n}',
      modified: '{\n  "title": "新标题"\n}',
    },
    {
      path: 'src/new.ts',
      status: 'A' as const,
      added: 3,
      removed: 0,
      original: '',
      modified: 'const a = 1;\nconst b = 2;\nconst c = 3;\n',
    },
    {
      path: 'assets/logo.png',
      status: 'A' as const,
      added: null,
      removed: null,
      binary: true,
    },
  ],
};

describe('AppDevDiffViewer（版本页行级 diff）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.diffEditorProps.current = null;
    localStorage.clear();
    useAppDevWorkbenchStore.setState({ ...WORKBENCH_DEFAULTS });
  });

  it('无 diffRequest：显示空态引导', () => {
    render(<AppDevDiffViewer workspaceId="ws-1" />);
    expect(screen.getByTestId('app-dev-diff-empty')).toHaveTextContent('版本对比');
    expect(screen.getByTestId('app-dev-diff-empty')).toHaveTextContent('查看修改');
    expect(mocks.diffAppCheckpoint).not.toHaveBeenCalled();
  });

  it('消费 diffRequest：拉取 diff、渲染文件清单与 DiffEditor 全文对，请求被清空', async () => {
    mocks.diffAppCheckpoint.mockResolvedValue(DIFF);
    useAppDevWorkbenchStore.setState({ diffRequest: { hash: 'abc123def456' } });

    render(<AppDevDiffViewer workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-editor')).toBeInTheDocument();
    });
    // 请求-消费：处理后清空
    expect(useAppDevWorkbenchStore.getState().diffRequest).toBeNull();
    expect(mocks.diffAppCheckpoint).toHaveBeenCalledWith('ws-1', 'abc123def456', undefined);

    // 头部：subject + parent→hash + 文件数
    const viewer = screen.getByTestId('app-dev-diff-viewer');
    expect(viewer).toHaveTextContent('对话修改 · 把标题改蓝');
    expect(viewer).toHaveTextContent('fff000e → abc123d');
    expect(viewer).toHaveTextContent('3 个文件');

    // 文件清单：M/A 徽章 + +N −M 着色；二进制文件显示「二进制」
    const list = screen.getByTestId('app-dev-diff-file-list');
    expect(list).toHaveTextContent('src/pages/home.page.json');
    expect(list).toHaveTextContent('+26');
    expect(list).toHaveTextContent('−60');
    expect(list).toHaveTextContent('二进制');
    expect(screen.getByText('+26')).toHaveClass('text-[var(--sto-success-primary)]');
    expect(screen.getByText('−60')).toHaveClass('text-[var(--sto-danger-primary)]');

    // 默认选中第一个文本文件：DiffEditor 收到 original/modified 全文对
    const props = mocks.diffEditorProps.current!;
    expect(props.original).toBe('{\n  "title": "旧标题"\n}');
    expect(props.modified).toBe('{\n  "title": "新标题"\n}');
    expect(props.language).toBe('plaintext');
    expect((props.options as Record<string, unknown>).readOnly).toBe(true);
    expect((props.options as Record<string, unknown>).renderSideBySide).toBe(true);
  });

  it('切换文件：新增文件 original 为空；二进制文件只显示统计占位', async () => {
    mocks.diffAppCheckpoint.mockResolvedValue(DIFF);
    useAppDevWorkbenchStore.setState({ diffRequest: { hash: 'abc123def456' } });
    render(<AppDevDiffViewer workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByTestId('mock-diff-editor')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /src\/new\.ts/ }));
    await waitFor(() => {
      expect(mocks.diffEditorProps.current?.modified).toBe('const a = 1;\nconst b = 2;\nconst c = 3;\n');
    });
    expect(mocks.diffEditorProps.current?.original).toBe('');
    expect(mocks.diffEditorProps.current?.language).toBe('typescript');

    fireEvent.click(screen.getByRole('button', { name: /logo\.png/ }));
    await waitFor(() => {
      expect(screen.getByText('二进制文件，仅显示变更统计')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mock-diff-editor')).not.toBeInTheDocument();
  });

  it('首个版本（parentHash 为 null）：头部标注「首个版本」', async () => {
    mocks.diffAppCheckpoint.mockResolvedValue({
      ...DIFF,
      parentHash: null,
      files: [DIFF.files[1]],
    });
    useAppDevWorkbenchStore.setState({ diffRequest: { hash: 'abc123def456' } });
    render(<AppDevDiffViewer workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('app-dev-diff-viewer')).toHaveTextContent('首个版本');
    });
  });

  it('diff 拉取失败：显示错误态', async () => {
    mocks.diffAppCheckpoint.mockResolvedValue(null);
    useAppDevWorkbenchStore.setState({ diffRequest: { hash: 'gone' } });
    render(<AppDevDiffViewer workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('app-dev-diff-error')).toHaveTextContent('无法读取该版本的差异');
    });
  });
});

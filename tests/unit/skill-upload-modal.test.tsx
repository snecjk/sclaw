import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SkillUploadModal } from '@/components/skill-plaza/SkillUploadModal';
import { SkillPlazaHeader } from '@/components/skill-plaza/SkillPlazaHeader';

const mocks = vi.hoisted(() => ({
  invokeIpc: vi.fn(),
  uploadSkill: vi.fn(),
  setActiveTab: vi.fn(),
  setSearchQuery: vi.fn(),
  fetchConnectors: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => mocks.invokeIpc(...args),
}));

vi.mock('@/stores/skill-plaza', () => {
  const state = {
    uploadSkill: mocks.uploadSkill,
    mySkills: [],
    activeTab: 'all' as const,
    searchQuery: '',
    setActiveTab: mocks.setActiveTab,
    setSearchQuery: mocks.setSearchQuery,
  };
  const useSkillPlazaStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useSkillPlazaStore };
});

vi.mock('@/stores/connectors', () => {
  const state = {
    loading: false,
    fetchList: mocks.fetchConnectors,
  };
  return {
    useConnectorsStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

function renderModal() {
  return render(<SkillUploadModal open onClose={vi.fn()} />);
}

function createDataTransfer(file: File, useItems = true) {
  return {
    dropEffect: 'none',
    items: useItems
      ? [{ kind: 'file', getAsFile: () => file }]
      : [],
    files: useItems ? [] : [file],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SkillUploadModal source selection', () => {
  beforeEach(() => {
    mocks.invokeIpc.mockReset();
    mocks.uploadSkill.mockReset();
    mocks.setActiveTab.mockReset();
  });

  it('opens separate file and directory dialogs and stays idle when canceled', async () => {
    mocks.invokeIpc.mockResolvedValue({ canceled: true, filePaths: [] });
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '选择技能文件' }));
    await waitFor(() => {
      expect(mocks.invokeIpc).toHaveBeenCalledWith(
        'dialog:open',
        expect.objectContaining({
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Skill Package', extensions: ['zip', 'md'] }],
        }),
      );
    });

    mocks.invokeIpc.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '选择技能文件夹' }));
    await waitFor(() => {
      expect(mocks.invokeIpc).toHaveBeenCalledWith(
        'dialog:open',
        expect.objectContaining({ properties: ['openDirectory', 'multiSelections'] }),
      );
    });

    expect(screen.getByRole('button', { name: '选择技能文件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择技能文件夹' })).toBeInTheDocument();
    expect(mocks.invokeIpc).toHaveBeenCalledTimes(1);
  });

  it('routes file and folder selections through the existing preview validation', async () => {
    mocks.invokeIpc
      .mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\skills\\demo.zip'] })
      .mockResolvedValueOnce({ valid: true })
      .mockResolvedValueOnce({ size: 1024, isDirectory: false, isFile: true });
    const { unmount } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: '选择技能文件' }));
    await waitFor(() => {
      expect(mocks.invokeIpc).toHaveBeenCalledWith(
        'file:validateSkillUpload',
        'C:\\skills\\demo.zip',
      );
    });
    unmount();

    mocks.invokeIpc.mockReset();
    mocks.invokeIpc
      .mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\skills\\demo'] })
      .mockResolvedValueOnce({ valid: true })
      .mockResolvedValueOnce({ size: 0, isDirectory: true, isFile: false });
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '选择技能文件夹' }));
    await waitFor(() => {
      expect(mocks.invokeIpc).toHaveBeenCalledWith(
        'file:validateSkillUpload',
        'C:\\skills\\demo',
      );
    });
  });

  it('preserves copy drag feedback and clears it when the item leaves', () => {
    renderModal();
    const dropZone = screen.getByRole('button', { name: /拖拽.*到此处/ });
    const dataTransfer = createDataTransfer(new File(['skill'], 'SKILL.md'));

    fireEvent.dragOver(dropZone, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(dropZone.className).toContain('bg-[#00B54B]/10');

    fireEvent.dragLeave(dropZone, { dataTransfer });
    expect(dropZone.className).not.toContain('bg-[#00B54B]/10');
  });

  it('keeps the legacy File.path drag fallback and prevents the default drop', async () => {
    mocks.invokeIpc.mockImplementation((channel: string) => {
      if (channel === 'file:validateSkillUpload') return Promise.resolve({ valid: true });
      if (channel === 'file:stat') {
        return Promise.resolve({ size: 12, isDirectory: false, isFile: true });
      }
      return Promise.resolve(undefined);
    });
    renderModal();
    const dropZone = screen.getByRole('button', { name: /拖拽.*到此处/ });
    const file = new File(['skill'], 'SKILL.md');
    Object.defineProperty(file, 'path', { value: 'C:\\skills\\SKILL.md' });
    const dropEvent = createEvent.drop(dropZone);
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: createDataTransfer(file),
    });

    fireEvent(dropZone, dropEvent);

    expect(dropEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(mocks.invokeIpc).toHaveBeenCalledWith(
        'file:validateSkillUpload',
        'C:\\skills\\SKILL.md',
      );
    });
  });

  it('keeps the preload getPathForFile drag path fallback', async () => {
    mocks.invokeIpc.mockImplementation((channel: string) => {
      if (channel === 'file:validateSkillUpload') return Promise.resolve({ valid: true });
      if (channel === 'file:stat') {
        return Promise.resolve({ size: 0, isDirectory: true, isFile: false });
      }
      return Promise.resolve(undefined);
    });
    const getPathForFile = vi.fn(() => 'C:\\skills\\folder-skill');
    Object.assign(window.electron, { getPathForFile });
    renderModal();
    const dropZone = screen.getByRole('button', { name: /拖拽.*到此处/ });
    const file = new File([], 'folder-skill');

    fireEvent.drop(dropZone, {
      dataTransfer: createDataTransfer(file, false),
    });

    await waitFor(() => {
      expect(getPathForFile).toHaveBeenCalledWith(file);
      expect(mocks.invokeIpc).toHaveBeenCalledWith(
        'file:validateSkillUpload',
        'C:\\skills\\folder-skill',
      );
    });
  });

  it('uses semantic theme classes for both source buttons', () => {
    renderModal();

    for (const name of ['选择技能文件', '选择技能文件夹']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('border-border');
      expect(button.className).toContain('bg-background');
      expect(button.className).toContain('hover:bg-muted/60');
      expect(button.className).toContain('focus-visible:ring-ring');
      expect(button.className).not.toMatch(/#[0-9a-f]{3,8}/i);
    }

    expect(screen.getByText('推荐')).toHaveClass('text-primary', 'bg-primary/10');
  });

  it('validates every selected folder and uploads them sequentially', async () => {
    const folders = [
      'C:\\skills\\first',
      'C:\\skills\\second',
      'C:\\skills\\third',
    ];
    mocks.invokeIpc.mockImplementation((channel: string) => {
      if (channel === 'dialog:open') {
        return Promise.resolve({ canceled: false, filePaths: folders });
      }
      if (channel === 'file:validateSkillUpload') return Promise.resolve({ valid: true });
      return Promise.resolve(undefined);
    });
    const resolveUploads: Array<(value: string) => void> = [];
    mocks.uploadSkill.mockImplementation(
      () => new Promise<string>((resolve) => resolveUploads.push(resolve)),
    );
    const onClose = vi.fn();
    const onUploadSuccess = vi.fn();
    render(<SkillUploadModal open onClose={onClose} onUploadSuccess={onUploadSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: '选择技能文件夹' }));

    await waitFor(() => {
      expect(screen.getByText('已选择 3 个技能文件夹')).toBeInTheDocument();
      expect(screen.getByText('first、second 等 3 个文件夹')).toBeInTheDocument();
    });
    expect(mocks.invokeIpc.mock.calls.filter(([channel]) => channel === 'file:validateSkillUpload'))
      .toEqual(folders.map((folder) => ['file:validateSkillUpload', folder]));

    fireEvent.click(screen.getByRole('button', { name: '安装' }));

    await waitFor(() => {
      expect(screen.getByText('正在安装 1/3...')).toBeInTheDocument();
      expect(mocks.uploadSkill).toHaveBeenCalledTimes(1);
    });
    resolveUploads[0]('first');
    await waitFor(() => {
      expect(screen.getByText('正在安装 2/3...')).toBeInTheDocument();
      expect(mocks.uploadSkill).toHaveBeenCalledTimes(2);
    });
    resolveUploads[1]('second');
    await waitFor(() => {
      expect(screen.getByText('正在安装 3/3...')).toBeInTheDocument();
      expect(mocks.uploadSkill).toHaveBeenCalledTimes(3);
    });
    resolveUploads[2]('third');
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onUploadSuccess).toHaveBeenCalledTimes(1);
    });
    expect(mocks.uploadSkill.mock.calls.map(([path]) => path)).toEqual(folders);
  });

  it('shows two selected folder names instead of the file-size placeholder', async () => {
    const folders = ['C:\\skills\\weather', 'C:\\skills\\headphone'];
    mocks.invokeIpc.mockImplementation((channel: string) => {
      if (channel === 'dialog:open') {
        return Promise.resolve({ canceled: false, filePaths: folders });
      }
      if (channel === 'file:validateSkillUpload') return Promise.resolve({ valid: true });
      return Promise.resolve(undefined);
    });
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '选择技能文件夹' }));

    await waitFor(() => {
      expect(screen.getByText('已选择 2 个技能文件夹')).toBeInTheDocument();
      expect(screen.getByText('weather、headphone')).toBeInTheDocument();
    });
    expect(screen.queryByText('-')).not.toBeInTheDocument();
  });

  it('selects, previews, and uploads multiple skill files', async () => {
    const files = ['C:\\skills\\weather.zip', 'C:\\skills\\SKILL.md'];
    mocks.invokeIpc.mockImplementation((channel: string) => {
      if (channel === 'dialog:open') {
        return Promise.resolve({ canceled: false, filePaths: files });
      }
      if (channel === 'file:validateSkillUpload') return Promise.resolve({ valid: true });
      return Promise.resolve(undefined);
    });
    mocks.uploadSkill.mockResolvedValue('installed');
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '选择技能文件' }));

    await waitFor(() => {
      expect(screen.getByText('已选择 2 个技能文件')).toBeInTheDocument();
      expect(screen.getByText('weather.zip、SKILL.md')).toBeInTheDocument();
    });
    expect(screen.queryByText('-')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '安装' }));
    await waitFor(() => expect(mocks.uploadSkill).toHaveBeenCalledTimes(2));
    expect(mocks.uploadSkill.mock.calls.map(([path]) => path)).toEqual(files);
  });

  it('stops a multi-folder upload after a failure and reports completed count', async () => {
    const folders = [
      'C:\\skills\\first',
      'C:\\skills\\second',
      'C:\\skills\\third',
    ];
    mocks.invokeIpc.mockImplementation((channel: string) => {
      if (channel === 'dialog:open') {
        return Promise.resolve({ canceled: false, filePaths: folders });
      }
      if (channel === 'file:validateSkillUpload') return Promise.resolve({ valid: true });
      return Promise.resolve(undefined);
    });
    mocks.uploadSkill
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(new Error('second failed'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '选择技能文件夹' }));
    await screen.findByText('已选择 3 个技能文件夹');
    fireEvent.click(screen.getByRole('button', { name: '安装' }));

    await waitFor(() => {
      expect(screen.getByText('已完成 1/3，后续上传已停止：second failed')).toBeInTheDocument();
    });
    expect(mocks.uploadSkill).toHaveBeenCalledTimes(2);
    expect(mocks.uploadSkill.mock.calls.map(([path]) => path)).toEqual(folders.slice(0, 2));
  });

  it('closes the modal after a successful single-file upload', async () => {
    const onClose = vi.fn();
    const onUploadSuccess = vi.fn();
    mocks.invokeIpc.mockImplementation((channel: string) => {
      if (channel === 'dialog:open') {
        return Promise.resolve({ canceled: false, filePaths: ['C:\\skills\\demo.zip'] });
      }
      if (channel === 'file:validateSkillUpload') return Promise.resolve({ valid: true });
      return Promise.resolve(undefined);
    });
    mocks.uploadSkill.mockResolvedValue('demo');
    render(<SkillUploadModal open onClose={onClose} onUploadSuccess={onUploadSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: '选择技能文件' }));
    await screen.findByRole('button', { name: '安装' });
    fireEvent.click(screen.getByRole('button', { name: '安装' }));

    await waitFor(() => {
      expect(mocks.uploadSkill).toHaveBeenCalledWith('C:\\skills\\demo.zip');
      expect(onUploadSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
    expect(screen.queryByRole('button', { name: '查看技能' })).not.toBeInTheDocument();
  });

  it.each([
    ['C:\\skills\\broken.zip', '选择技能文件'],
    ['C:\\skills\\notes.md', '选择技能文件'],
    ['C:\\skills\\missing-skill-md', '选择技能文件夹'],
  ])('keeps the existing validation feedback for invalid source %s', async (path, buttonName) => {
    mocks.invokeIpc
      .mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      .mockResolvedValueOnce({ valid: false });
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    await waitFor(() => {
      expect(screen.getByText('请选择有效的 .zip、SKILL.md 或包含 SKILL.md 的技能文件夹')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '选择技能文件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择技能文件夹' })).toBeInTheDocument();
  });
});

describe('Skill Plaza header composition', () => {
  beforeEach(() => {
    mocks.invokeIpc.mockReset();
    mocks.setActiveTab.mockReset();
    mocks.setSearchQuery.mockReset();
    mocks.fetchConnectors.mockReset();
  });

  it('keeps search debounce and folder IPC in the header owner', () => {
    vi.useFakeTimers();
    render(
      <SkillPlazaHeader
        section="skills"
        onSectionChange={vi.fn()}
      />,
    );

    const searchbox = screen.getByRole('searchbox');
    fireEvent.change(searchbox, { target: { value: 'pdf' } });
    vi.advanceTimersByTime(299);
    expect(mocks.setSearchQuery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mocks.setSearchQuery).toHaveBeenCalledWith('pdf');

    fireEvent.click(screen.getByRole('button', { name: '文件夹' }));
    expect(mocks.invokeIpc).toHaveBeenCalledWith('open-skill-folder');
    expect(searchbox.parentElement?.className).toContain(
      'dark:bg-[var(--sto-control-bg)]',
    );
  });

  it('keeps section changes and the upload modal in the header owner', () => {
    const onSectionChange = vi.fn();
    render(
      <SkillPlazaHeader
        section="skills"
        onSectionChange={onSectionChange}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '连接器' }));
    expect(onSectionChange).toHaveBeenCalledWith('connectors');

    fireEvent.click(screen.getByRole('button', { name: '上传技能' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

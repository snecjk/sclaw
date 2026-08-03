import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDataCenterStore } from '@/stores/data-center';
import type { DataCenterEntry } from '@/types/data-center';

vi.mock('@/lib/data-center-api', () => ({
  createDataCenterFolder: vi.fn(),
  deleteDataCenterEntry: vi.fn(),
  getDataCenterQuota: vi.fn(),
  getDataCenterSpaces: vi.fn(),
  listDataCenterEntries: vi.fn(),
  renameDataCenterEntry: vi.fn(),
}));

const savedEntry: DataCenterEntry = {
  entryId: 'entry-1',
  spaceType: 'qa_artifact',
  entryType: 'file',
  parentEntryId: 'root',
  name: 'project_analysis_report.md',
  mimeType: 'text/markdown',
  fileExt: 'md',
  fileSize: 1024,
  sourceType: 'chat_artifact',
  status: 'active',
  createdAt: '2026-07-28T11:56:00.000Z',
  updatedAt: '2026-07-28T11:56:00.000Z',
};

describe('data-center store navigation', () => {
  beforeEach(() => {
    useDataCenterStore.setState({
      section: 'qa_artifact',
      spaceType: 'qa_artifact',
      spaceId: null,
      parentEntryId: 'root',
      breadcrumbs: [],
      items: [savedEntry],
      total: 1,
      pageNo: 1,
      keyword: '',
      error: null,
      loading: false,
    });
  });

  it('keeps current items when selecting the active My Artifacts root tab again', () => {
    useDataCenterStore.getState().setQaArtifactSpace('qa_artifact');

    const state = useDataCenterStore.getState();
    expect(state.items).toEqual([savedEntry]);
    expect(state.total).toBe(1);
    expect(state.parentEntryId).toBe('root');
  });

  it('resets folder context when My Artifacts is selected from a child folder', () => {
    useDataCenterStore.setState({
      parentEntryId: 'folder-1',
      breadcrumbs: [
        { entryId: 'root', name: 'root' },
        { entryId: 'folder-1', name: '测试文件' },
      ],
      items: [{ ...savedEntry, entryId: 'child-entry', parentEntryId: 'folder-1' }],
      total: 1,
    });

    useDataCenterStore.getState().setQaArtifactSpace('qa_artifact');

    const state = useDataCenterStore.getState();
    expect(state.parentEntryId).toBe('root');
    expect(state.items).toEqual([]);
    expect(state.total).toBe(0);
  });
});

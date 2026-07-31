import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDataCenterIdempotencyKey,
  listDataCenterEntries,
  uploadArtifactFromPath,
} from '@/lib/data-center-api';
import { hostApiFetch } from '@/lib/host-api';

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

const mockedHostApiFetch = vi.mocked(hostApiFetch);

describe('data-center-api', () => {
  beforeEach(() => {
    mockedHostApiFetch.mockReset();
  });

  it('maps entry listing to the ai-memory data-center proxy', async () => {
    mockedHostApiFetch.mockResolvedValueOnce({
      success: true,
      data: { items: [], total: 0, pageNo: 1, pageSize: 50, breadcrumbs: [] },
      traceId: 'trace-1',
    });

    await listDataCenterEntries({
      spaceType: 'qa_artifact',
      parentEntryId: 'root',
      keyword: '报表',
      sortField: 'name',
      sortOrder: 'asc',
    });

    expect(mockedHostApiFetch).toHaveBeenCalledWith(
      '/ai-memory/agent/v1/data-center/entries?spaceType=qa_artifact&parentEntryId=root&keyword=%E6%8A%A5%E8%A1%A8&pageNo=1&pageSize=50&sortField=name&sortOrder=asc',
    );
  });

  it('saves artifacts through the local multipart upload route', async () => {
    mockedHostApiFetch.mockResolvedValueOnce({
      success: true,
      data: {
        entryId: 'entry-1',
        spaceType: 'qa_artifact',
        entryType: 'file',
        parentEntryId: 'root',
        name: 'report.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileExt: 'xlsx',
        fileSize: 12,
        sourceType: 'chat_artifact',
        traceStatus: 'verified',
        traceAvailable: true,
        status: 'ready',
        createdAt: null,
        updatedAt: null,
      },
      traceId: 'trace-1',
    });

    await uploadArtifactFromPath({
      filePath: '/tmp/report.xlsx',
      fileName: 'report.xlsx',
      parentEntryId: 'root',
      idempotencyKey: 'save-key',
      sourceType: 'chat_artifact',
      sessionId: 'agent:main:main',
      artifactKey: 'artifact-1',
    });

    expect(mockedHostApiFetch).toHaveBeenCalledWith('/api/data-center/artifacts/upload', {
      method: 'POST',
      body: JSON.stringify({
        filePath: '/tmp/report.xlsx',
        fileName: 'report.xlsx',
        parentEntryId: 'root',
        idempotencyKey: 'save-key',
        sourceType: 'chat_artifact',
        sessionId: 'agent:main:main',
        artifactKey: 'artifact-1',
      }),
    });
  });

  it('creates bounded idempotency keys', () => {
    const key = createDataCenterIdempotencyKey('artifact', '客户件量趋势报表_20260630.xlsx');
    expect(key.startsWith('artifact-')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(128);
  });
});

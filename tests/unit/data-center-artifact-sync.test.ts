import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildArtifactSyncIdempotencyKey,
  resolveDataCenterTargetsFromUris,
} from '../../electron/services/data-center-artifact-sync';

const mockRecords = new Map<string, Record<string, unknown>>();

describe('data center artifact sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../../electron/db/repositories/artifact-save-record-repository');
    vi.doUnmock('../../electron/utils/auth-store');
    vi.doUnmock('../../electron/utils/sto-domain');
    vi.resetModules();
    mockRecords.clear();
  });

  it('builds WAF-safe idempotency keys from target URIs', () => {
    const parts = [
      'scheduled-task:task-id:run-id',
      '1:3d_cube.html',
      'data-center://qa_artifact/e0e3afcf7e574b3a811ea3eb2dab65eb',
    ];

    const key = buildArtifactSyncIdempotencyKey(parts);

    expect(key).toMatch(/^artifact-[A-Za-z0-9_-]+$/);
    expect(key).not.toContain('://');
    expect(key).not.toContain('/');
    expect(key).toBe(buildArtifactSyncIdempotencyKey(parts));
  });

  it('drops qa root when a shared target mirrors the saved artifact into qa artifacts', () => {
    const targets = resolveDataCenterTargetsFromUris([
      { uri: 'data-center://qa_artifact/root', label: '我的产物' },
      { uri: 'data-center://site_shared_artifact/site-1/root', label: '网点共享产物' },
    ]);

    expect(targets).toEqual([
      {
        uri: 'data-center://site_shared_artifact/site-1/root',
        spaceType: 'site_shared_artifact',
        spaceId: 'site-1',
        parentEntryId: 'root',
        label: '网点共享产物',
      },
    ]);
  });

  it('keeps a non-root qa target alongside shared targets', () => {
    const targets = resolveDataCenterTargetsFromUris([
      { uri: 'data-center://qa_artifact/folder-1', label: '我的产物文件夹' },
      { uri: 'data-center://site_shared_artifact/site-1/root', label: '网点共享产物' },
    ]);

    expect(targets.map((target) => target.uri)).toEqual([
      'data-center://qa_artifact/folder-1',
      'data-center://site_shared_artifact/site-1/root',
    ]);
  });

  it('coalesces concurrent saves for the same run artifact and target', async () => {
    vi.resetModules();
    const dir = await mkdtemp(join(tmpdir(), 'artifact-sync-'));
    const filePath = join(dir, 'random-note.md');
    await writeFile(filePath, 'hello artifact');
    let uploadCount = 0;

    vi.doMock('../../electron/utils/auth-store', () => ({
      getStoToken: async () => 'token',
    }));
    vi.doMock('../../electron/utils/sto-domain', () => ({
      resolveStoBaseUrl: async () => 'https://sto.example.test',
    }));
    vi.doMock('../../electron/db/repositories/artifact-save-record-repository', () => ({
      ArtifactSaveRecordRepository: class {
        async findExisting(input: { sourceType: string; runId?: string | null; artifactKey: string; targetUri: string }) {
          return mockRecords.get(`${input.sourceType}\0${input.runId ?? ''}\0${input.artifactKey}\0${input.targetUri}`) ?? null;
        }

        async createOrUpdate(input: Record<string, unknown>) {
          const key = `${input.sourceType}\0${input.runId ?? ''}\0${input.artifactKey}\0${input.targetUri}`;
          const existing = mockRecords.get(key);
          const record = {
            id: existing?.id ?? `record-${mockRecords.size + 1}`,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            sourceTitle: input.sourceTitle ?? null,
            runId: input.runId ?? null,
            sessionId: input.sessionId ?? null,
            artifactKey: input.artifactKey,
            artifactName: input.artifactName,
            localPath: input.localPath ?? null,
            targetUri: input.targetUri,
            targetLabel: input.targetLabel ?? null,
            status: input.status ?? 'pending',
            dataCenterEntryId: input.dataCenterEntryId ?? null,
            dataCenterPathLabel: input.dataCenterPathLabel ?? null,
            errorCode: input.errorCode ?? null,
            errorMessage: input.errorMessage ?? null,
            createdAt: existing?.createdAt ?? '2026-07-30T00:00:00.000Z',
            updatedAt: '2026-07-30T00:00:00.000Z',
            deletedAt: null,
            version: Number(existing?.version ?? 0) + 1,
          };
          mockRecords.set(key, record);
          return record;
        }

        async update(id: string, input: Record<string, unknown>) {
          const entry = Array.from(mockRecords.entries()).find(([, record]) => record.id === id);
          if (!entry) throw new Error(`missing record ${id}`);
          const [key, existing] = entry;
          const record = {
            ...existing,
            artifactName: input.artifactName ?? existing.artifactName,
            localPath: input.localPath !== undefined ? input.localPath : existing.localPath,
            targetLabel: input.targetLabel !== undefined ? input.targetLabel : existing.targetLabel,
            status: input.status ?? existing.status,
            dataCenterEntryId: input.dataCenterEntryId !== undefined ? input.dataCenterEntryId : existing.dataCenterEntryId,
            dataCenterPathLabel: input.dataCenterPathLabel !== undefined ? input.dataCenterPathLabel : existing.dataCenterPathLabel,
            errorCode: input.errorCode !== undefined ? input.errorCode : existing.errorCode,
            errorMessage: input.errorMessage !== undefined ? input.errorMessage : existing.errorMessage,
            version: Number(existing.version ?? 0) + 1,
          };
          mockRecords.set(key, record);
          return record;
        }
      },
    }));

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/data-center/entries')) {
        return new Response(JSON.stringify({ success: true, data: { items: [] } }), { status: 200 });
      }
      if (requestUrl.includes('/data-center/artifacts/upload') && init?.method === 'POST') {
        uploadCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(JSON.stringify({
          success: true,
          data: { entryId: 'entry-1', pathLabel: '我的产物' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }));

    try {
      const { syncArtifactsToDataCenter } = await import('../../electron/services/data-center-artifact-sync');
      const input = {
        sourceType: 'scheduled_task_artifact' as const,
        sourceId: 'task-id',
        sourceTitle: '生成md',
        runId: 'run-id',
        sessionId: 'claude-task:task-id:2026-07-30',
        idempotencyScope: 'scheduled-task:task-id:run-id',
        artifacts: [{
          artifactKey: 'artifact-key:random-note.md',
          name: 'random-note.md',
          filePath,
          contentType: 'text/markdown',
        }],
        targets: [{
          uri: 'data-center://qa_artifact/root',
          spaceType: 'qa_artifact',
          parentEntryId: 'root',
          label: '我的产物',
        }],
      };

      const [first, second] = await Promise.all([
        syncArtifactsToDataCenter(input),
        syncArtifactsToDataCenter(input),
      ]);

      expect(uploadCount).toBe(1);
      expect(first.records).toHaveLength(1);
      expect(second.records).toHaveLength(1);
      expect(first.records[0]?.dataCenterEntryId).toBe('entry-1');
      expect(second.records[0]?.dataCenterEntryId).toBe('entry-1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

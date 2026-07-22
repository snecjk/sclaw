import { describe, it, expect, vi } from 'vitest';
import { uploadArtifact } from '../../electron/services/workflow-runtime/artifact-uploader';

const art = { artifact_id: 'a1', run_id: 'r1', kind: 'OUTPUT', file_path: '/local/a1.md', created_at: 't' };

describe('artifact-uploader', () => {
  it('backfills resource_id on success + enqueues outbox', async () => {
    const repo: any = { upsertArtifact: vi.fn(), enqueueOutbox: vi.fn().mockResolvedValue(1) };
    const uploadOssFile = vi.fn().mockResolvedValue({ resourceId: 'oss-1', tempUrl: 'u' });
    await uploadArtifact({ repo, uploadOssFile }, art);
    expect(repo.upsertArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact_id: 'a1', resource_id: 'oss-1', file_path: '/local/a1.md' }));
    expect(repo.enqueueOutbox).toHaveBeenCalledWith('r1', 'artifact', 'a1', expect.objectContaining({ resource_id: 'oss-1' }), 'progress');
  });
  it('keeps local path (resource_id undefined) on upload failure', async () => {
    const repo: any = { upsertArtifact: vi.fn(), enqueueOutbox: vi.fn().mockResolvedValue(1) };
    const uploadOssFile = vi.fn().mockRejectedValue(new Error('net'));
    await uploadArtifact({ repo, uploadOssFile, maxAttempts: 2 }, art);
    expect(repo.upsertArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact_id: 'a1', resource_id: undefined, file_path: '/local/a1.md' }));
    expect(repo.enqueueOutbox).toHaveBeenCalledWith('r1', 'artifact', 'a1', expect.objectContaining({ resource_id: undefined }), 'progress');
  });
  it('retries then succeeds on transient failure', async () => {
    const repo: any = { upsertArtifact: vi.fn(), enqueueOutbox: vi.fn().mockResolvedValue(1) };
    const uploadOssFile = vi.fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ resourceId: 'oss-2' });
    await uploadArtifact({ repo, uploadOssFile, maxAttempts: 5, backoffBaseMs: 1 }, art);
    expect(uploadOssFile).toHaveBeenCalledTimes(3);
    expect(repo.upsertArtifact).toHaveBeenCalledWith(expect.objectContaining({ resource_id: 'oss-2' }));
  });
});

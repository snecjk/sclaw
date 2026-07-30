import { describe, expect, it } from 'vitest';
import { buildArtifactSyncIdempotencyKey } from '../../electron/services/data-center-artifact-sync';

describe('data center artifact sync', () => {
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
});

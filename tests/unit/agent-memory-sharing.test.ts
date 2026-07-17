import { describe, expect, it } from 'vitest';
import {
  buildSharedMemoryAddOptions,
  buildSharedMemoryDeleteOptions,
  buildSharedMemoryFilters,
} from '../../electron/services/agent-memory-orchestrator';

describe('user-scoped shared memory filters', () => {
  it('uses only the normalized user id for retrieval', () => {
    expect(buildSharedMemoryFilters(' user-1 ')).toEqual({ user_id: 'user-1' });
  });

  it('uses only the normalized user id for delete-all', () => {
    expect(buildSharedMemoryDeleteOptions(' user-1 ')).toEqual({ userId: 'user-1' });
  });

  it('does not create an implicit agent or run scope', () => {
    expect(buildSharedMemoryFilters()).toEqual({});
    expect(buildSharedMemoryDeleteOptions('   ')).toEqual({});
  });

  it('stores agent and run only as provenance metadata', () => {
    expect(buildSharedMemoryAddOptions({
      userId: 'user-1',
      agentId: 'agent-a',
      runId: 'run-a',
      infer: true,
      metadata: { source: 'chat' },
    })).toEqual({
      userId: 'user-1',
      infer: true,
      metadata: {
        source: 'chat',
        sourceAgentId: 'agent-a',
        sourceRunId: 'run-a',
      },
    });
  });
});

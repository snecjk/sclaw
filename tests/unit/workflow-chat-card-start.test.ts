import { describe, expect, it, vi } from 'vitest';
import { buildWorkflowStartChatCard } from '../../electron/api/routes/workflows';
import { createEngine } from '../../electron/services/workflow-runtime/engine';
import { buildClaudeWorkflowStartBody } from '../../sto-plugin/claude/sto-workflow-tool/workflow-start';

describe('workflow chat-card start metadata', () => {
  it('builds durable card metadata for the host v1 chat start bridge', () => {
    expect(buildWorkflowStartChatCard('wf_weather', {
      inputs: { city: '上海' },
      chatCardTitle: '天气笑话',
    })).toEqual({
      title: '天气笑话',
      paramsSummary: '{"city":"上海"}',
    });
  });

  it('falls back to workflow id while still marking empty-input starts as cards', () => {
    expect(buildWorkflowStartChatCard('wf_weather', { inputs: {} })).toEqual({
      title: 'wf_weather',
      paramsSummary: null,
    });
  });

  it('includes Claude launch metadata in the host start request', () => {
    const body = JSON.parse(buildClaudeWorkflowStartBody(
      { city: '北京' },
      'idem-1',
      'session-1',
      '天气笑话',
    ));

    expect(body).toMatchObject({
      sessionKey: 'session-1',
      engineType: 'claude',
      chatCardTitle: '天气笑话',
      chatParamsSummary: '{"city":"北京"}',
    });
  });

  it('persists the card marker in the first wf_run upsert', async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const repo = {
      upsertRun,
      listNodeRuns: vi.fn().mockResolvedValue([]),
      enqueueOutbox: vi.fn().mockResolvedValue(undefined),
    };
    const engine = createEngine({
      repo: repo as never,
      invokeAgent: vi.fn(),
      postSync: vi.fn(),
      dslClient: {
        fetchVersion: vi.fn().mockRejectedValue(new Error('stop after initial upsert')),
      },
    });

    await expect(engine.startWorkflow({
      runId: 'run-new',
      runDatabaseId: 101,
      workflowId: 'wf_weather',
      versionId: 'version-1',
      input: { city: '上海' },
      startedAt: '2026-07-30T23:20:00+08:00',
      sessionKey: 'session-1',
      engineType: 'openclaw',
      chatCard: { title: '天气笑话', paramsSummary: '{"city":"上海"}' },
    })).rejects.toThrow('stop after initial upsert');

    expect(upsertRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      run_id: 'run-new',
      session_key: 'session-1',
      chat_card_visible: 1,
      chat_card_title: '天气笑话',
      chat_params_summary: '{"city":"上海"}',
    }));
  });
});

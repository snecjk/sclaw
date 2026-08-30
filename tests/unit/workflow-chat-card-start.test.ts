import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkflowStartChatCard,
  resolveWorkflowStartModel,
} from '../../electron/api/routes/workflows';
import { createEngine } from '../../electron/services/workflow-runtime/engine';
import { createHostApiWorkflowPort } from '../../electron/agent-extensions/extensions/sto-workflow-tool/host-api-capability';

const workflowRouteMocks = vi.hoisted(() => ({
  getEngineSessionRegistryEntry: vi.fn(),
  getOpenClawProvidersConfig: vi.fn(),
}));

vi.mock('../../electron/engines/session-registry', () => ({
  getEngineSessionRegistryEntry: workflowRouteMocks.getEngineSessionRegistryEntry,
}));

vi.mock('../../electron/utils/openclaw-auth', () => ({
  getOpenClawProvidersConfig: workflowRouteMocks.getOpenClawProvidersConfig,
}));

describe('workflow chat-card start metadata', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    workflowRouteMocks.getEngineSessionRegistryEntry.mockReset();
    workflowRouteMocks.getOpenClawProvidersConfig.mockReset();
  });

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

  it('includes engine-neutral launch metadata in the Host API request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: { runId: 'run-1', workflowId: 'wf_weather', status: 'running' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createHostApiWorkflowPort().startWorkflow({
      workflowId: 'wf_weather',
      inputs: { city: '北京' },
      idempotencyKey: 'idem-1',
      sessionKey: 'session-1',
      templateName: '天气笑话',
      engineType: 'claude',
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      sessionKey: 'session-1',
      engineType: 'claude',
      chatCardTitle: '天气笑话',
      chatParamsSummary: '{"city":"北京"}',
    });
  });

  it('resolves the Claude workflow model from the originating chat session', async () => {
    workflowRouteMocks.getEngineSessionRegistryEntry.mockResolvedValue({
      sessionKey: 'session-1',
      engineType: 'claude',
      agentId: 'main',
      model: '  dashscope/qwen3.5-plus  ',
    });

    await expect(resolveWorkflowStartModel('claude', 'session-1'))
      .resolves.toBe('dashscope/qwen3.5-plus');
    expect(workflowRouteMocks.getEngineSessionRegistryEntry).toHaveBeenCalledWith('session-1');
  });

  it('rejects a Claude workflow start when the chat session has no execution model', async () => {
    workflowRouteMocks.getEngineSessionRegistryEntry.mockResolvedValue({
      sessionKey: 'session-1',
      engineType: 'claude',
      agentId: 'main',
    });

    await expect(resolveWorkflowStartModel('claude', 'session-1'))
      .rejects.toThrow('Claude 聊天会话执行模型未配置，无法启动工作流');
  });

  it('keeps resolving OpenClaw workflow starts from the configured chat default', async () => {
    workflowRouteMocks.getOpenClawProvidersConfig.mockResolvedValue({
      defaultModel: '  moonshot/kimi-k2.5  ',
    });

    await expect(resolveWorkflowStartModel('openclaw', 'session-1'))
      .resolves.toBe('moonshot/kimi-k2.5');
    expect(workflowRouteMocks.getEngineSessionRegistryEntry).not.toHaveBeenCalled();
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
      trigger_type: 'chat',
      chat_card_visible: 1,
      chat_card_title: '天气笑话',
      chat_params_summary: '{"city":"上海"}',
    }));
  });

  it('classifies a chat workflow from a scheduled-task session', async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const isScheduledTaskSession = vi.fn().mockResolvedValue(true);
    const repo = {
      upsertRun,
      listNodeRuns: vi.fn().mockResolvedValue([]),
      enqueueOutbox: vi.fn().mockResolvedValue(undefined),
    };
    const engine = createEngine({
      repo: repo as never,
      isScheduledTaskSession,
      invokeAgent: vi.fn(),
      postSync: vi.fn(),
      dslClient: {
        fetchVersion: vi.fn().mockRejectedValue(new Error('stop after initial upsert')),
      },
    });

    await expect(engine.startWorkflow({
      runId: 'run-scheduled',
      runDatabaseId: 102,
      workflowId: 'wf_report',
      versionId: 'version-1',
      input: {},
      startedAt: '2026-07-31T09:00:00+08:00',
      sessionKey: 'agent:main:cron:task-1:2026-07-31',
      triggerType: 'chat',
      engineType: 'openclaw',
      chatCard: { title: '日报' },
    })).rejects.toThrow('stop after initial upsert');

    expect(isScheduledTaskSession).toHaveBeenCalledWith(
      'agent:main:cron:task-1:2026-07-31',
    );
    expect(upsertRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      run_id: 'run-scheduled',
      trigger_type: 'scheduled_task',
    }));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkflowStartChatCard,
  resolveWorkflowStartModel,
} from '../../electron/api/routes/workflows';
import { createEngine } from '../../electron/services/workflow-runtime/engine';
import { createWorkflowTools } from '../../sto-plugin/claude/sto-workflow-tool/tools';
import {
  buildClaudeWorkflowStartBody,
  requireClaudeWorkflowSessionKey,
} from '../../sto-plugin/claude/sto-workflow-tool/workflow-start';

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

  it('allows Claude workflow tools to initialize before a chat session is available', () => {
    expect(() => createWorkflowTools({
      baseUrl: 'http://127.0.0.1:3210',
      stoToken: 'test-token',
    })).not.toThrow();
  });

  it('requires the Claude chat session only when execute_workflow starts', () => {
    expect(() => requireClaudeWorkflowSessionKey()).toThrow(
      'Claude execute_workflow requires a chat sessionKey',
    );
    expect(requireClaudeWorkflowSessionKey('  session-1  ')).toBe('session-1');
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
      chat_card_visible: 1,
      chat_card_title: '天气笑话',
      chat_params_summary: '{"city":"上海"}',
    }));
  });
});

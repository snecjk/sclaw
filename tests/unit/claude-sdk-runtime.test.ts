import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyStoClaudeInferenceEnv: vi.fn(async (env: NodeJS.ProcessEnv) => {
    env.ANTHROPIC_BASE_URL = 'https://sto.example/v1/anthropic';
    env.ANTHROPIC_API_KEY = 'sto-token';
    env.ANTHROPIC_AUTH_TOKEN = 'sto-token';
  }),
  getAgentPreferredModel: vi.fn(),
  getApiKey: vi.fn(),
  getProviderAccount: vi.fn(),
  query: vi.fn(() => ({ close: vi.fn() })),
  resolveAvailableClaudeModel: vi.fn(),
}));

vi.mock('../../electron/services/providers/provider-store', () => ({
  getProviderAccount: mocks.getProviderAccount,
}));

vi.mock('../../electron/services/sto-claude-inference-env', () => ({
  applyStoClaudeInferenceEnv: mocks.applyStoClaudeInferenceEnv,
}));

vi.mock('../../electron/utils/agent-config', () => ({
  getAgentPreferredModel: mocks.getAgentPreferredModel,
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../electron/utils/paths', () => ({
  getClaudeConfigDir: () => 'D:\\tmp\\stoclaw-claude-runtime-test',
}));

vi.mock('../../electron/utils/secure-storage', () => ({
  getApiKey: mocks.getApiKey,
}));

vi.mock('../../electron/engines/claude-model-selection', () => ({
  resolveAvailableClaudeModel: mocks.resolveAvailableClaudeModel,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mocks.query,
  deleteSession: vi.fn(),
  getSessionMessages: vi.fn(),
}));

describe('claude-sdk-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentPreferredModel.mockResolvedValue({
      accountId: 'preferred-account',
      model: 'preferred/model',
    });
    mocks.resolveAvailableClaudeModel.mockResolvedValue({
      accountId: 'sto',
      model: 'dashscope/qwen3.5-plus',
      fallbackApplied: true,
    });
    mocks.getProviderAccount.mockResolvedValue({
      id: 'sto',
      vendorId: 'sto',
      enabled: true,
    });
  });

  it('uses explicit task/session selection before agent preferences and returns the catalog fallback', async () => {
    const { resolveClaudeLaunchSelection } = await import('../../electron/engines/claude-sdk-runtime');

    const result = await resolveClaudeLaunchSelection({
      agentId: 'main',
      requestedAccountId: 'stale-account',
      requestedModel: 'dashscope/deepseek-v4-flash',
    });

    expect(mocks.resolveAvailableClaudeModel).toHaveBeenCalledWith({
      requestedAccountId: 'stale-account',
      requestedModel: 'dashscope/deepseek-v4-flash',
    });
    expect(result).toMatchObject({
      accountId: 'sto',
      model: 'dashscope/qwen3.5-plus',
      provider: 'sto',
      fallbackApplied: true,
    });
  });

  it('normalizes legacy STO task account ids before shared catalog selection', async () => {
    const { resolveClaudeLaunchSelection } = await import('../../electron/engines/claude-sdk-runtime');

    await resolveClaudeLaunchSelection({
      agentId: 'main',
      requestedAccountId: 'custom-sto',
      requestedModel: 'dashscope/qwen3.5-plus',
    });

    expect(mocks.resolveAvailableClaudeModel).toHaveBeenCalledWith({
      requestedAccountId: 'sto',
      requestedModel: 'dashscope/qwen3.5-plus',
    });
  });

  it('prepares one shared STO environment and constructs queries through the SDK facade', async () => {
    const { createClaudeQuery, prepareClaudeRuntime } = await import('../../electron/engines/claude-sdk-runtime');

    const runtime = await prepareClaudeRuntime({ agentId: 'main' });
    const query = await createClaudeQuery({ prompt: 'hello', options: { cwd: 'D:\\workspace' } });

    expect(mocks.resolveAvailableClaudeModel).toHaveBeenCalledWith({
      requestedAccountId: 'preferred-account',
      requestedModel: 'preferred/model',
    });
    expect(mocks.applyStoClaudeInferenceEnv).toHaveBeenCalledOnce();
    expect(runtime.env.ANTHROPIC_BASE_URL).toBe('https://sto.example/v1/anthropic');
    expect(mocks.query).toHaveBeenCalledWith({ prompt: 'hello', options: { cwd: 'D:\\workspace' } });
    expect(query).toBeDefined();
  });
});

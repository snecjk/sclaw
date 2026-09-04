import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/host-api', () => ({ hostApiFetch: vi.fn() }));

import { hostApiFetch } from '@/lib/host-api';
import {
  buildChatModelOptions,
  resolveHomePageCarryoverModel,
  resolveNewChatSelectedModelId,
} from '@/lib/chat-model-options';
import { applyWorkspaceDefaultToNewSession, resolveModelToPersistForSession } from '@/lib/sync-workspace-default-to-chat';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';

const accounts = [{
  id: 'sto',
  vendorId: 'sto' as const,
  name: 'STO',
  enabled: true,
  authMode: 'api-key' as const,
  model: 'workspace-model',
  metadata: { customModels: ['workspace-model', 'claude-agent-model'] },
}];

describe('new-session default model', () => {
  beforeEach(() => {
    vi.mocked(hostApiFetch).mockReset();
    useProviderStore.setState({ accounts, defaultAccountId: 'sto' });
    useAgentsStore.setState({
      agents: [{
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'claude-agent-model',
        modelAccountId: 'sto',
        inheritedModel: false,
        workspace: '',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        engineType: 'claude',
      }],
      fetchAgents: vi.fn(),
    });
    useChatStore.setState({
      currentAgentId: 'main',
      currentSessionKey: 'claude:main:session-new',
      sessions: [{ key: 'claude:main:session-new', engineType: 'claude' }],
      pendingNewSessionModel: null,
      loadSessions: vi.fn(),
    });
  });

  it('selects the workspace default when there is no explicit pending choice', () => {
    const options = buildChatModelOptions([{ account: accounts[0], vendor: undefined }]);

    expect(resolveNewChatSelectedModelId(options, null, 'workspace-model')).toBe('workspace-model');
    expect(resolveNewChatSelectedModelId(options, 'claude-agent-model', 'workspace-model')).toBe('claude-agent-model');
  });

  it('does not derive a carryover model from the selected engine', () => {
    expect(resolveHomePageCarryoverModel({
      sessionKey: 'agent:main:main',
      sessions: [],
    })).toBeUndefined();
  });

  it('resolves the workspace default for Claude when no model can be inherited', () => {
    expect(resolveModelToPersistForSession({
      sessionKey: 'claude:main:session-new',
      agentId: 'main',
      engineType: 'claude',
    })).toEqual({ modelId: 'workspace-model', accountId: 'sto' });
  });

  it('persists the workspace default through the Claude session route', async () => {
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      modelOverride: 'workspace-model',
    });

    await applyWorkspaceDefaultToNewSession('claude:main:session-new', 'main');

    expect(hostApiFetch).toHaveBeenCalledWith('/api/sessions/model', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: 'claude:main:session-new',
        model: 'workspace-model',
        accountId: 'sto',
        agentId: 'main',
        engineType: 'claude',
      }),
    });
  });
});

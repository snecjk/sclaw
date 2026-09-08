import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const runtime = {
    on: vi.fn((name: string, listener: (event: unknown) => void) => {
      const bucket = listeners.get(name) ?? new Set();
      bucket.add(listener);
      listeners.set(name, bucket);
    }),
    off: vi.fn((name: string, listener: (event: unknown) => void) => {
      listeners.get(name)?.delete(listener);
    }),
    emit(name: string, event: unknown) {
      for (const listener of listeners.get(name) ?? []) listener(event);
    },
    request: vi.fn(async (command: string) => (
      command === 'session.prompt'
        ? { runId: 'pi-run', sessionId: 'pi-session', sessionFile: 'pi-session.jsonl' }
        : { success: true }
    )),
  };
  return {
    listeners,
    runtime,
    buildPiSessionConfig: vi.fn(),
    deletePiSession: vi.fn(),
    upsertEngineSessionRegistryEntry: vi.fn(),
    getEngineSessionRegistryEntry: vi.fn(),
  };
});

vi.mock('../../electron/engines/pi-adapter', () => ({
  buildPiSessionConfig: mocks.buildPiSessionConfig,
  deletePiSession: mocks.deletePiSession,
}));
vi.mock('../../electron/engines/session-engine', () => ({
  resolveAgentIdForSessionKey: vi.fn(async () => 'agent-1'),
}));
vi.mock('../../electron/engines/session-registry', () => ({
  getEngineSessionRegistryEntry: mocks.getEngineSessionRegistryEntry,
  upsertEngineSessionRegistryEntry: mocks.upsertEngineSessionRegistryEntry,
}));
vi.mock('../../electron/services/pi-runtime-service', () => ({
  getPiRuntimeService: () => mocks.runtime,
}));
vi.mock('../../electron/services/workflow-runtime/skill-loader', () => ({
  prepareWorkflowSkills: vi.fn(async () => undefined),
}));

import {
  cancelPiWorkflowAgent,
  invokePiWorkflowAgent,
  releasePiWorkflowAgentSession,
} from '../../electron/services/workflow-runtime/agent-runner-pi';
import { workflowPiSessionKey } from '../../shared/workflow-pi-session';

describe('PI workflow agent runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.getEngineSessionRegistryEntry.mockResolvedValue({
      sessionKey: 'agent:agent-1:chat', engineType: 'pi', agentId: 'agent-1',
      model: 'fixed-model', provider: 'account-provider', accountId: 'account-1',
    });
    mocks.buildPiSessionConfig.mockResolvedValue({
      config: {
        sessionKey: 'pi:workflow:node-session',
        cwd: 'D:/workflow/node',
        agentDir: 'D:/pi',
        sessionDir: 'D:/pi/sessions',
        model: { provider: 'test', model: 'old-model' },
      },
      entry: { sessionKey: 'pi:workflow:node-session', engineType: 'pi', agentId: 'agent-1' },
    });
  });

  it('uses a deterministic isolated session and converts PI output and tool events', async () => {
    const events: unknown[] = [];
    const invocation = invokePiWorkflowAgent({
      ctx: { runId: 'workflow-run', nodeId: 'node-1' },
      prompt: 'execute',
      model: 'fixed-model',
      agentSessionId: 'node-session',
      originSessionKey: 'agent:agent-1:chat',
      cwd: 'D:/workflow/node',
      onStreamEvent: (event) => { events.push(event); },
    });
    await vi.waitFor(() => expect(mocks.runtime.request).toHaveBeenCalledWith(
      'session.prompt', expect.any(Object),
    ));
    const sessionKey = workflowPiSessionKey('node-session');
    mocks.runtime.emit('event', {
      type: 'tool.result', sessionKey,
      message: { role: 'toolresult', toolName: 'read', toolCallId: 'tool-1', content: 'done' },
    });
    mocks.runtime.emit('event', {
      type: 'message.delta', sessionKey,
      message: { role: 'assistant', content: [{ type: 'text', text: '{"status":"success","data":{}}' }] },
    });
    mocks.runtime.emit('event', { type: 'turn.completed', sessionKey });

    await expect(invocation).resolves.toMatchObject({
      status: 'succeeded',
      output: { status: 'success', data: {} },
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agent.tool_end', toolName: 'read', callId: 'tool-1' }),
      expect.objectContaining({ type: 'agent.answer_delta' }),
    ]));
    expect(mocks.buildPiSessionConfig).toHaveBeenCalledWith(
      sessionKey, expect.any(String), expect.objectContaining({ message: 'execute' }),
    );
    expect(mocks.upsertEngineSessionRegistryEntry).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1', provider: 'account-provider', model: 'fixed-model',
    }));
    const promptPayload = mocks.runtime.request.mock.calls.find(([command]) => command === 'session.prompt')?.[1] as {
      payload: { config: { model: { model: string }; disableAgentExtensions: boolean; agentId: string } };
    };
    expect(promptPayload.payload.config).toMatchObject({
      agentId: 'agent-1',
      disableAgentExtensions: true,
      model: { model: 'fixed-model' },
    });
  });

  it('rejects a final response that does not contain JSON', async () => {
    const invocation = invokePiWorkflowAgent({
      ctx: { runId: 'workflow-run', nodeId: 'node-invalid' },
      prompt: 'execute', model: 'fixed-model', agentSessionId: 'node-session',
      originSessionKey: 'agent:agent-1:chat', cwd: 'D:/workflow/node',
    });
    await vi.waitFor(() => expect(mocks.runtime.request).toHaveBeenCalledWith(
      'session.prompt', expect.any(Object),
    ));
    const sessionKey = workflowPiSessionKey('node-session');
    mocks.runtime.emit('event', {
      type: 'message.final', sessionKey,
      message: { role: 'assistant', content: [{ type: 'text', text: 'not a workflow packet' }] },
    });
    mocks.runtime.emit('event', { type: 'turn.completed', sessionKey });
    await expect(invocation).resolves.toMatchObject({
      status: 'failed', error: 'SAgent 节点未返回完整 WorkflowPacket JSON',
    });
  });

  it('aborts an active workflow node', async () => {
    const invocation = invokePiWorkflowAgent({
      ctx: { runId: 'workflow-run', nodeId: 'node-2' },
      prompt: 'execute', model: 'fixed-model', agentSessionId: 'node-session',
      originSessionKey: 'agent:agent-1:chat', cwd: 'D:/workflow/node',
    });
    await vi.waitFor(() => expect(mocks.runtime.request).toHaveBeenCalledWith(
      'session.prompt', expect.any(Object),
    ));
    cancelPiWorkflowAgent('workflow-run', 'node-2');
    await expect(invocation).resolves.toMatchObject({ status: 'failed', error: '节点执行已取消' });
    expect(mocks.runtime.request).toHaveBeenCalledWith('session.abort', {
      sessionKey: 'pi:workflow:node-session',
    });
  });

  it('deletes the isolated PI session at terminal cleanup', async () => {
    await releasePiWorkflowAgentSession('node-session');
    expect(mocks.deletePiSession).toHaveBeenCalledWith('pi:workflow:node-session');
  });
});

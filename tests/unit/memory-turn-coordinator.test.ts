import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bindMemoryMock, discardMemoryMock, captureMock } = vi.hoisted(() => ({
  bindMemoryMock: vi.fn(),
  discardMemoryMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock('../../electron/services/memory-capture-service', () => ({
  memoryCaptureService: {
    bindInjectedExecutionMemories: bindMemoryMock,
    discardInjectedExecutionMemories: discardMemoryMock,
    capture: captureMock,
  },
}));

import { MemoryTurnCoordinator } from '../../electron/services/memory-turn-coordinator';

describe('MemoryTurnCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureMock.mockResolvedValue(undefined);
  });

  function begin(coordinator: MemoryTurnCoordinator, idempotencyKey = 'id-1') {
    coordinator.begin({
      sessionKey: 'agent:main:main',
      idempotencyKey,
      engineType: 'openclaw',
      memories: [{ memoryId: 'memory-1', memory: '执行经验' }],
    });
  }

  it('binds injected memories and captures exactly once on completion', async () => {
    const coordinator = new MemoryTurnCoordinator({} as never);
    begin(coordinator);
    await coordinator.bind({ sessionKey: 'agent:main:main', idempotencyKey: 'id-1', runId: 'run-1' });
    await coordinator.completed('agent:main:main', 'run-1');
    await coordinator.completed('agent:main:main', 'run-1');
    expect(bindMemoryMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(discardMemoryMock).not.toHaveBeenCalled();
  });

  it('handles a completion event that arrives before the send result', async () => {
    const coordinator = new MemoryTurnCoordinator({} as never);
    begin(coordinator);
    await coordinator.completed('agent:main:main', 'run-fast');
    await coordinator.bind({ sessionKey: 'agent:main:main', idempotencyKey: 'id-1', runId: 'run-fast' });
    expect(bindMemoryMock).toHaveBeenCalledWith({
      runId: 'run-fast',
      memories: [{ memoryId: 'memory-1', memory: '执行经验' }],
    });
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'aborted'] as const)('discards without capture when the turn is %s', async (status) => {
    const coordinator = new MemoryTurnCoordinator({} as never);
    begin(coordinator);
    await coordinator.bind({ sessionKey: 'agent:main:main', idempotencyKey: 'id-1', runId: 'run-bad' });
    await coordinator[status]('agent:main:main', 'run-bad');
    expect(discardMemoryMock).toHaveBeenCalledWith('run-bad');
    expect(captureMock).not.toHaveBeenCalled();
  });
});

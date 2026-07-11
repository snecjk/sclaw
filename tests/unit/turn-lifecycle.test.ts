import { describe, expect, it } from 'vitest';
import {
  canShowAssistantTurnMeta,
  resolveCurrentTurnLifecycleForMeta,
  resolveTurnLifecycle,
} from '@/pages/Chat/turn-lifecycle';

describe('resolveTurnLifecycle', () => {
  it('OpenClaw/Claude: sending + pendingFinal → organizing_tool_results, no meta', () => {
    const lc = resolveTurnLifecycle({
      sending: true,
      pendingFinal: true,
      lastUserMessageAt: Date.now(),
      activeRunId: 'run_1',
      isStreaming: false,
      isAwaitingUserToContinue: false,
      hasWorkflowBlockers: false,
      engineType: 'openclaw',
    });
    expect(lc.status).toBe('organizing_tool_results');
    expect(lc.canShowMeta).toBe(false);
    expect(lc.isTerminal).toBe(false);
  });

  it('completed when no runtime signals', () => {
    const lc = resolveTurnLifecycle({
      sending: false,
      pendingFinal: false,
      lastUserMessageAt: null,
      activeRunId: null,
      isStreaming: false,
      isAwaitingUserToContinue: false,
      hasWorkflowBlockers: false,
    });
    expect(lc.status).toBe('completed');
    expect(lc.canShowMeta).toBe(true);
  });

  it('interrupted is terminal but not canShowMeta', () => {
    const lc = resolveTurnLifecycle({
      sending: false,
      pendingFinal: false,
      lastUserMessageAt: null,
      activeRunId: null,
      isStreaming: false,
      isAwaitingUserToContinue: false,
      hasWorkflowBlockers: false,
      isInterrupted: true,
    });
    expect(lc.status).toBe('interrupted');
    expect(lc.isTerminal).toBe(true);
    expect(lc.canShowMeta).toBe(false);
  });
});

describe('canShowAssistantTurnMeta', () => {
  const completedLifecycle = resolveCurrentTurnLifecycleForMeta({
    sending: false,
    pendingFinal: false,
    lastUserMessageAt: null,
    activeRunId: null,
    isStreaming: false,
    isAwaitingUserToContinue: false,
    hasWorkflowBlockers: false,
  });

  const runningLifecycle = resolveCurrentTurnLifecycleForMeta({
    sending: true,
    pendingFinal: false,
    lastUserMessageAt: Date.now(),
    activeRunId: 'run_1',
    isStreaming: true,
    isAwaitingUserToContinue: false,
    hasWorkflowBlockers: false,
  });

  it('hides meta while lifecycle not completed', () => {
    expect(
      canShowAssistantTurnMeta({
        hasAssistantMetaContent: true,
        isLastAssistantInTurn: true,
        isInCurrentUserTurn: true,
        lifecycle: runningLifecycle,
      }),
    ).toBe(false);
  });

  it('shows meta when lifecycle completed in current turn', () => {
    expect(
      canShowAssistantTurnMeta({
        hasAssistantMetaContent: true,
        isLastAssistantInTurn: true,
        isInCurrentUserTurn: true,
        lifecycle: completedLifecycle,
      }),
    ).toBe(true);
  });

  it('shows meta for past turns regardless of current run state', () => {
    expect(
      canShowAssistantTurnMeta({
        hasAssistantMetaContent: true,
        isLastAssistantInTurn: true,
        isInCurrentUserTurn: false,
        lifecycle: runningLifecycle,
      }),
    ).toBe(true);
  });
});

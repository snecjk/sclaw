import { describe, expect, it } from 'vitest';
import {
  avoidPathIsOneShotToolCapabilityNegation,
  rejectExecutionMemoryPersist,
  turnHadSessionStaleHeal,
} from '../../shared/execution-memory-quality-gate';

describe('rejectExecutionMemoryPersist', () => {
  it('rejects failed aborted interrupted runs', () => {
    expect(rejectExecutionMemoryPersist({ terminalStatus: 'failed' })).toEqual({
      reject: true, reason: 'run_not_successful',
    });
    expect(rejectExecutionMemoryPersist({ terminalStatus: 'aborted' }).reject).toBe(true);
    expect(rejectExecutionMemoryPersist({ terminalStatus: 'interrupted' }).reject).toBe(true);
  });

  it('rejects a loop-guarded turn', () => {
    expect(rejectExecutionMemoryPersist({
      terminalStatus: 'completed',
      interruptCause: 'loop_guard_blocked',
    })).toEqual({ reject: true, reason: 'loop_guard_blocked' });
  });

  it('rejects SESSION_STALE self-heal turns', () => {
    expect(rejectExecutionMemoryPersist({
      terminalStatus: 'completed',
      sessionStaleHealThisTurn: true,
    })).toEqual({ reject: true, reason: 'session_stale_heal' });
  });

  it('rejects one-shot tool capability negations', () => {
    expect(rejectExecutionMemoryPersist({
      terminalStatus: 'completed',
      avoidPath: [{ command: 'bridge_screenshot', reason: '插件权限不足' }],
    })).toEqual({ reject: true, reason: 'one_shot_tool_capability_negation' });
  });

  it('allows a successful run without poisoned avoid-path', () => {
    expect(rejectExecutionMemoryPersist({
      terminalStatus: 'completed',
      avoidPath: [{ command: 'sai-cli foo bar', reason: '参数要用当天日期' }],
    })).toEqual({ reject: false });
  });
});

describe('turnHadSessionStaleHeal', () => {
  it('detects SESSION_STALE in tool payloads', () => {
    expect(turnHadSessionStaleHeal([{ name: 'bridge_click', error: 'SESSION_STALE' }])).toBe(true);
    expect(turnHadSessionStaleHeal([{ name: 'bridge_click', error: 'ok' }])).toBe(false);
  });
});

describe('avoidPathIsOneShotToolCapabilityNegation', () => {
  it('requires both a tool-like command and a capability negation', () => {
    expect(avoidPathIsOneShotToolCapabilityNegation([
      { command: 'bridge_screenshot', reason: '避免使用，权限不足' },
    ])).toBe(true);
    expect(avoidPathIsOneShotToolCapabilityNegation([
      { command: 'sai-cli market search', reason: '要用当天日期' },
    ])).toBe(false);
  });
});

// @vitest-environment node
/**
 * R1a：空转防护只拦"连续同名同参"，不能误伤参数相同但页面状态已变的合法序列。
 */
import { describe, expect, it } from 'vitest';
import {
  buildToolCallSignature,
  buildToolRepeatBlockReason,
  createToolRepeatTracker,
  normalizeToolNameForSignature,
  shouldAbortRepeatedTool,
} from '../../shared/claude-loop-guard';

describe('buildToolCallSignature', () => {
  it('ignores key order and the mcp server prefix', () => {
    const a = buildToolCallSignature('mcp__sto-browser-tool__bridge_click', {
      sessionId: 'ext-1',
      name: '客户管理',
    });
    const b = buildToolCallSignature('bridge_click', {
      name: '客户管理',
      sessionId: 'ext-1',
    });
    expect(a).toBe(b);
  });

  it('separates different arguments', () => {
    expect(buildToolCallSignature('bridge_click', { name: 'A' }))
      .not.toBe(buildToolCallSignature('bridge_click', { name: 'B' }));
  });

  it('normalizes plain tool names unchanged', () => {
    expect(normalizeToolNameForSignature('Bash')).toBe('Bash');
  });

  it('ignores sessionId so guessed session ids cannot disguise a loop', () => {
    // 真实事故：同一个 @e31 连点 16 次，每次换一个编造的 sessionId。
    const first = buildToolCallSignature('bridge_click', { ref: '@e31', sessionId: 'ext-1892768778' });
    const second = buildToolCallSignature('bridge_click', { ref: '@e31', sessionId: 'ext-1986330396' });
    const omitted = buildToolCallSignature('bridge_click', { ref: '@e31' });
    expect(first).toBe(second);
    expect(first).toBe(omitted);
  });
});

describe('createToolRepeatTracker', () => {
  const listSessions = buildToolCallSignature('bridge_list_sessions', {});

  it('blocks only after the limit of consecutive identical calls', () => {
    const tracker = createToolRepeatTracker(3);
    expect(tracker.record(listSessions).blocked).toBe(false);
    expect(tracker.record(listSessions).blocked).toBe(false);
    expect(tracker.record(listSessions).blocked).toBe(false);
    const fourth = tracker.record(listSessions);
    expect(fourth.blocked).toBe(true);
    expect(fourth.count).toBe(4);
  });

  it('resets when another tool call intervenes (click → snapshot → click → snapshot)', () => {
    const tracker = createToolRepeatTracker(3);
    const snapshot = buildToolCallSignature('bridge_snapshot', { sessionId: 'ext-1' });
    const click = buildToolCallSignature('bridge_click', { sessionId: 'ext-1', name: '下一页' });

    for (let round = 0; round < 6; round += 1) {
      expect(tracker.record(snapshot).blocked).toBe(false);
      expect(tracker.record(click).blocked).toBe(false);
    }
  });

  it('blocks the meoo click storm: same ref, a new fabricated session each time', () => {
    const tracker = createToolRepeatTracker(3);
    const fabricated = ['ext-1892768778', 'ext-1986330396', 'ext-1689887467', 'ext-1943403531', 'ext-1988813766'];
    const decisions = fabricated.map((sessionId) => tracker.record(
      buildToolCallSignature('bridge_click', { ref: '@e31', sessionId }),
    ));
    expect(decisions.map((d) => d.blocked)).toEqual([false, false, false, true, true]);
  });

  it('reset() clears the streak at a new user turn', () => {
    const tracker = createToolRepeatTracker(1);
    tracker.record(listSessions);
    expect(tracker.record(listSessions).blocked).toBe(true);
    tracker.reset();
    expect(tracker.record(listSessions).blocked).toBe(false);
  });
});

describe('shouldAbortRepeatedTool', () => {
  it('does not abort on the first deny, only after ignored repeats', () => {
    const tracker = createToolRepeatTracker(3);
    const sig = buildToolCallSignature('bridge_screenshot', {});
    expect(tracker.record(sig).blocked).toBe(false);
    expect(tracker.record(sig).blocked).toBe(false);
    expect(tracker.record(sig).blocked).toBe(false);
    const fourth = tracker.record(sig);
    expect(fourth.blocked).toBe(true);
    expect(shouldAbortRepeatedTool(fourth)).toBe(false);
    tracker.record(sig);
    const sixth = tracker.record(sig);
    expect(sixth.count).toBe(6);
    expect(shouldAbortRepeatedTool(sixth)).toBe(true);
  });
});

describe('buildToolRepeatBlockReason', () => {
  it('tells the model what to do instead of only refusing', () => {
    const reason = buildToolRepeatBlockReason({ toolName: 'Bash', count: 4 });
    expect(reason).toContain('第 4 次');
    expect(reason).toContain('已有结果');
    expect(reason).not.toContain('SESSION_STALE');
  });

  it('adds the session hint for session-listing tools', () => {
    const reason = buildToolRepeatBlockReason({
      toolName: 'mcp__sto-browser-tool__bridge_list_sessions',
      count: 4,
    });
    expect(reason).toContain('currentSessionId');
  });
});

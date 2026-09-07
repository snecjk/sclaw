import { describe, expect, it } from 'vitest';
import {
  annotateSuccessfulAct,
  attachSuccessfulActProgress,
  createFillProgressTracker,
  extractCdpExpression,
  inspectFillLikeTool,
  isCdpDomWrite,
  isProgressUnlockTool,
  pickNextActions,
  toolResponseLooksSuccessful,
  FILL_DONE_HINT,
  REPEAT_FILL_HINT,
} from '../../shared/browser-bridge/act-progress';
import { claudeThinkingConfigForModel, isKimiModel } from '../../shared/claude-kimi-thinking';
import type { PageObservationElement } from '../../shared/browser-bridge/page-observation';

describe('inspectFillLikeTool', () => {
  it('keys bridge_fill by ref then name', () => {
    expect(inspectFillLikeTool('mcp__sto-browser-tool__bridge_fill', { ref: '@e12', value: 'hi' }))
      .toEqual({ targetKey: 'fill:@e12' });
    expect(inspectFillLikeTool('bridge_fill', { name: '标题', value: 'hi' }))
      .toEqual({ targetKey: 'fill:标题' });
  });

  it('treats contenteditable writes as one composer target and ignores probes', () => {
    const write = {
      method: 'Runtime.evaluate',
      params: {
        expression: 'const ce = document.querySelector("[contenteditable=true]"); ce.textContent = "山丘咖啡";',
      },
    };
    const probe = {
      method: 'Runtime.evaluate',
      params: {
        expression: 'document.querySelectorAll("[contenteditable=true]").length',
      },
    };
    expect(isCdpDomWrite(extractCdpExpression(write))).toBe(true);
    expect(inspectFillLikeTool('bridge_cdp', write)).toEqual({ targetKey: 'ce' });
    expect(inspectFillLikeTool('bridge_cdp', probe)).toBeNull();
    expect(isProgressUnlockTool('mcp__sto-browser-tool__bridge_click')).toBe(true);
    expect(isProgressUnlockTool('bridge_screenshot')).toBe(false);
  });
});

describe('pickNextActions / annotateSuccessfulAct', () => {
  const elements: PageObservationElement[] = [
    { ref: '@e1', role: 'generic', editable: true, name: '' },
    { ref: '@e73', role: 'button', clickable: true, name: '发送' },
    { ref: '@e8', role: 'link', clickable: true, name: '定价' },
  ];

  it('prefers send/submit named buttons', () => {
    expect(pickNextActions(elements)).toEqual([{ ref: '@e73', role: 'button', name: '发送' }]);
  });

  it('adds filled + nextActions + hint without dropping an existing session hint', () => {
    const annotated = annotateSuccessfulAct({
      kind: 'fill',
      result: { success: true, ref: '@e1', actionHint: '会话已切换 ext-1' },
      observation: { elements, documentGeneration: 1, url: '', title: '', timestamp: 0, observationMode: 'ax' },
      filledRef: '@e1',
    }) as { filled: boolean; actionHint: string; nextActions: Array<{ ref: string }> };
    expect(annotated.filled).toBe(true);
    expect(annotated.actionHint).toContain('会话已切换');
    expect(annotated.actionHint).toContain(FILL_DONE_HINT.slice(0, 6));
    expect(annotated.nextActions[0].ref).toBe('@e73');
  });
});

describe('createFillProgressTracker', () => {
  it('blocks the second write to the same composer and unlocks after click', () => {
    const tracker = createFillProgressTracker();
    expect(tracker.shouldBlock('ce')).toBe(false);
    tracker.recordSuccess('ce');
    expect(tracker.shouldBlock('ce')).toBe(true);
    expect(tracker.shouldBlock('fill:@e9')).toBe(false);
    const first = tracker.recordBlock();
    expect(first.abort).toBe(false);
    tracker.recordBlock();
    expect(tracker.recordBlock().abort).toBe(true);
    tracker.unlock();
    expect(tracker.shouldBlock('ce')).toBe(false);
  });
});

describe('toolResponseLooksSuccessful', () => {
  it('rejects MCP error envelopes and idle intercept text', () => {
    expect(toolResponseLooksSuccessful({ isError: true })).toBe(false);
    expect(toolResponseLooksSuccessful({
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'STALE_REF' }) }],
    })).toBe(false);
    expect(toolResponseLooksSuccessful({
      content: [{ type: 'text', text: REPEAT_FILL_HINT }],
    })).toBe(false);
    expect(toolResponseLooksSuccessful({
      content: [{ type: 'text', text: JSON.stringify({ success: true, filled: true }) }],
    })).toBe(true);
  });
});

describe('attachSuccessfulActProgress', () => {
  it('skips failed results and does not snapshot', async () => {
    let snapped = 0;
    const result = await attachSuccessfulActProgress({
      action: 'fill',
      payload: { ref: '@e1', value: 'x' },
      result: { success: false, error: 'ELEMENT_NOT_FOUND' },
      snapshot: async () => {
        snapped += 1;
        return { elements: [] };
      },
    });
    expect(result).toEqual({ success: false, error: 'ELEMENT_NOT_FOUND' });
    expect(snapped).toBe(0);
  });
});

describe('claudeThinkingConfigForModel', () => {
  it('disables extended thinking only for kimi', () => {
    expect(isKimiModel('dashscope/kimi-k3')).toBe(true);
    expect(claudeThinkingConfigForModel('dashscope/kimi-k3')).toEqual({ type: 'disabled' });
    expect(claudeThinkingConfigForModel('dashscope/qwen3.6-plus')).toBeUndefined();
  });
});

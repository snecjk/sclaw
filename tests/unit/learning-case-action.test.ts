import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchLearningCaseAction } from '@/lib/learning-case-action';
import { navigateToMainChatWithComposerHandoff, navigateToMainChatWithDraft } from '@/lib/main-chat-navigation';
import { openExternalUrl } from '@/lib/preview-url';
import type { LearningCaseAction } from '@/types/learning-center';

vi.mock('@/lib/main-chat-navigation', () => ({
  navigateToMainChatWithDraft: vi.fn(() => true),
  navigateToMainChatWithComposerHandoff: vi.fn(() => true),
}));

vi.mock('@/lib/preview-url', () => ({
  openExternalUrl: vi.fn(),
}));

const draftMock = vi.mocked(navigateToMainChatWithDraft);
const handoffMock = vi.mocked(navigateToMainChatWithComposerHandoff);
const externalMock = vi.mocked(openExternalUrl);

function action(overrides: Partial<LearningCaseAction> = {}): LearningCaseAction {
  return {
    targetType: 'CHAT',
    targetTypeRaw: 'CHAT',
    targetCode: '',
    targetUrl: '',
    promptText: null,
    promptMode: 'REPLACE',
    promptModeRaw: 'REPLACE',
    useCount: 3,
    ...overrides,
  };
}

describe('dispatchLearningCaseAction whitelist targets', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockClear();
    draftMock.mockClear();
    draftMock.mockReturnValue(true);
    handoffMock.mockClear();
    handoffMock.mockReturnValue(true);
    externalMock.mockClear();
  });

  it('opens home with a skill chip and no canned execute hint', () => {
    const result = dispatchLearningCaseAction(
      action({ targetType: 'SKILL', targetCode: 'daily-report' }),
      { navigate, displayTitle: '日报助手' },
    );

    expect(result).toMatchObject({ ok: true, navigatedTo: '/', draftApplied: true });
    expect(handoffMock).toHaveBeenCalledWith(navigate, {
      skill: { slug: 'daily-report', title: '日报助手' },
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(draftMock).not.toHaveBeenCalled();
  });

  it('uses the case prompt as the skill suffix when provided', () => {
    const result = dispatchLearningCaseAction(
      action({ targetType: 'SKILL', targetCode: 'daily-report', promptText: '帮我写日报' }),
      { navigate, displayTitle: '日报助手' },
    );

    expect(result).toMatchObject({ ok: true, navigatedTo: '/', draftApplied: true });
    expect(handoffMock).toHaveBeenCalledWith(navigate, {
      skill: { slug: 'daily-report', title: '日报助手' },
      suffixText: '帮我写日报',
    });
  });

  it('uses the case prompt as the workflow suffix when provided', () => {
    dispatchLearningCaseAction(
      action({ targetType: 'WORKFLOW', targetCode: 'tpl_demo', promptText: '按本周数据跑一遍' }),
      { navigate, displayTitle: '几善诗词' },
    );
    expect(handoffMock).toHaveBeenCalledWith(navigate, {
      workflow: { id: 'tpl_demo', name: '几善诗词', source: 'template' },
      suffixText: '按本周数据跑一遍',
    });
  });

  it('opens the connector section of the plaza', () => {
    const result = dispatchLearningCaseAction(
      action({ targetType: 'CONNECTOR', targetCode: 'dingtalk' }),
      { navigate },
    );

    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/skills?section=connectors');
  });

  it('opens the app plaza', () => {
    const result = dispatchLearningCaseAction(
      action({ targetType: 'APP', targetCode: 'sto-policy' }),
      { navigate },
    );

    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/more-apps');
  });

  it('opens home with a workflow chip and no canned install/execute hint', () => {
    const result = dispatchLearningCaseAction(
      action({ targetType: 'WORKFLOW', targetCode: 'wf/1 2' }),
      { navigate, displayTitle: '每日任务' },
    );

    expect(result).toMatchObject({ ok: true, navigatedTo: '/', draftApplied: true });
    expect(handoffMock).toHaveBeenCalledWith(navigate, {
      workflow: { id: 'wf/1 2', name: '每日任务', source: 'template' },
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens https targets through the host bridge instead of routing', () => {
    const result = dispatchLearningCaseAction(
      action({ targetType: 'URL', targetUrl: 'https://example.com/guide?sig=abc' }),
      { navigate },
    );

    expect(result).toMatchObject({ ok: true, openedUrl: 'https://example.com/guide?sig=abc' });
    expect(externalMock).toHaveBeenCalledWith('https://example.com/guide?sig=abc');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('seeds the chat composer for CHAT targets', () => {
    const result = dispatchLearningCaseAction(
      action({ targetType: 'CHAT', promptText: '整理这周的会议纪要' }),
      { navigate },
    );

    expect(result).toMatchObject({ ok: true, navigatedTo: '/', draftApplied: true });
    expect(draftMock).toHaveBeenCalledWith(navigate, '整理这周的会议纪要', { mode: 'REPLACE' });
  });

  it('uses the skill slug as chip title when no resolved name is provided', () => {
    dispatchLearningCaseAction(
      action({ targetType: 'SKILL', targetCode: 'finance-guanbao' }),
      { navigate },
    );
    expect(handoffMock).toHaveBeenCalledWith(navigate, {
      skill: { slug: 'finance-guanbao', title: 'finance-guanbao' },
    });
  });
});

describe('dispatchLearningCaseAction prompt modes', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockClear();
    draftMock.mockClear();
    draftMock.mockReturnValue(true);
    handoffMock.mockClear();
    handoffMock.mockReturnValue(true);
  });

  it('forwards REPLACE to the composer draft helper', () => {
    dispatchLearningCaseAction(
      action({ targetType: 'CHAT', promptText: '替换草稿', promptMode: 'REPLACE', promptModeRaw: 'REPLACE' }),
      { navigate },
    );
    expect(draftMock).toHaveBeenCalledWith(navigate, '替换草稿', { mode: 'REPLACE' });
  });

  it('forwards APPEND to the composer draft helper', () => {
    dispatchLearningCaseAction(
      action({ targetType: 'CHAT', promptText: '追加草稿', promptMode: 'APPEND', promptModeRaw: 'APPEND' }),
      { navigate },
    );
    expect(draftMock).toHaveBeenCalledWith(navigate, '追加草稿', { mode: 'APPEND' });
  });
});

describe('dispatchLearningCaseAction degraded branches', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockClear();
    draftMock.mockClear();
    draftMock.mockReturnValue(true);
    handoffMock.mockClear();
    handoffMock.mockReturnValue(true);
    externalMock.mockClear();
  });

  function expectNoSideEffects() {
    expect(navigate).not.toHaveBeenCalled();
    expect(draftMock).not.toHaveBeenCalled();
    expect(handoffMock).not.toHaveBeenCalled();
    expect(externalMock).not.toHaveBeenCalled();
  }

  it('refuses target types outside the whitelist', () => {
    const result = dispatchLearningCaseAction(
      action({ targetType: 'UNKNOWN', targetTypeRaw: 'PORTAL', targetCode: 'anything' }),
      { navigate },
    );
    expect(result).toEqual({ ok: false, reason: 'UNSUPPORTED_TARGET' });
    expectNoSideEffects();
  });

  it.each(['SKILL', 'CONNECTOR', 'APP', 'WORKFLOW'] as const)(
    'refuses %s targets without a stable code',
    (targetType) => {
      const result = dispatchLearningCaseAction(
        action({ targetType, targetCode: '   ' }),
        { navigate },
      );
      expect(result).toEqual({ ok: false, reason: 'MISSING_TARGET_CODE' });
      expectNoSideEffects();
    },
  );

  it.each(['', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url'])(
    'refuses unsafe URL target %s',
    (targetUrl) => {
      const result = dispatchLearningCaseAction(
        action({ targetType: 'URL', targetUrl }),
        { navigate },
      );
      expect(result).toEqual({ ok: false, reason: 'INVALID_TARGET_URL' });
      expectNoSideEffects();
    },
  );

  it('refuses unknown prompt modes before dispatching anything', () => {
    const result = dispatchLearningCaseAction(
      action({
        targetType: 'SKILL',
        targetCode: 'daily-report',
        promptText: '提示词',
        promptMode: 'UNKNOWN',
        promptModeRaw: 'PREPEND',
      }),
      { navigate },
    );
    expect(result).toEqual({ ok: false, reason: 'UNSUPPORTED_PROMPT_MODE' });
    expectNoSideEffects();
  });

  it('refuses CHAT targets that carry no prompt', () => {
    const result = dispatchLearningCaseAction(action({ targetType: 'CHAT', promptText: '  ' }), { navigate });
    expect(result).toEqual({ ok: false, reason: 'MISSING_PROMPT' });
    expectNoSideEffects();
  });

  it('reports an unavailable host bridge instead of opening the URL', () => {
    const original = window.electron;
    Object.defineProperty(window, 'electron', { value: undefined, writable: true });
    try {
      const result = dispatchLearningCaseAction(
        action({ targetType: 'URL', targetUrl: 'https://example.com' }),
        { navigate },
      );
      expect(result).toEqual({ ok: false, reason: 'TARGET_UNAVAILABLE' });
      expect(externalMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'electron', { value: original, writable: true });
    }
  });
});

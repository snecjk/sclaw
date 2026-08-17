import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isMainChatHomePath,
  navigateToMainChatHome,
  navigateToMainChatWithDraft,
  navigateToNewSessionWithDraft,
  navigateToNewSessionWithPrompt,
  navigateToSessionWithPrompt,
  readMainChatDraftState,
} from '@/lib/main-chat-navigation';
import {
  clearMainChatComposerDraft,
  publishMainChatComposerDraft,
} from '@/lib/main-chat-composer-draft';

const switchSession = vi.fn();
const newSession = vi.fn();
const renameSession = vi.fn();

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      sessions: [
        { key: 'agent:main:session-1', label: '已有会话' },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      currentSessionKey: 'agent:main:session-new',
      switchSession,
      newSession,
      renameSession,
    }),
  },
}));

describe('main-chat-navigation', () => {
  beforeEach(() => {
    switchSession.mockClear();
    newSession.mockClear();
    renameSession.mockClear();
  });

  it('detects home path', () => {
    expect(isMainChatHomePath('/')).toBe(true);
    expect(isMainChatHomePath('/chat')).toBe(false);
    expect(isMainChatHomePath('/tasks/foo')).toBe(false);
  });

  it('navigateToMainChatHome only navigates when not already on home', () => {
    const calls: unknown[] = [];
    const navigate = (path: unknown) => {
      calls.push(path);
    };
    navigateToMainChatHome(navigate as never, '/');
    expect(calls).toEqual([]);
    navigateToMainChatHome(navigate as never, '/cron');
    expect(calls).toEqual(['/']);
  });

  it('navigateToSessionWithPrompt switches by sessionKey', () => {
    const calls: unknown[] = [];
    const navigate = (target: unknown) => {
      calls.push(target);
    };

    navigateToSessionWithPrompt(navigate as never, '/workflow', 'hello', {
      sessionKey: 'agent:main:session-1',
    });

    expect(switchSession).toHaveBeenCalledWith('agent:main:session-1');
    expect(newSession).not.toHaveBeenCalled();
    expect(calls).toEqual([{ pathname: '/', search: '?q=hello' }]);
  });

  it('navigateToSessionWithPrompt switches by sessionTitle', () => {
    const navigate = vi.fn();
    navigateToSessionWithPrompt(navigate as never, '/workflow', 'hello', {
      sessionTitle: '已有会话',
    });

    expect(switchSession).toHaveBeenCalledWith('agent:main:session-1');
    expect(newSession).not.toHaveBeenCalled();
  });

  it('navigateToSessionWithPrompt creates and labels a session when title is missing', () => {
    const navigate = vi.fn();
    navigateToSessionWithPrompt(navigate as never, '/workflow', 'hello', {
      sessionTitle: '新会话标题',
    });

    expect(newSession).toHaveBeenCalled();
    expect(renameSession).toHaveBeenCalledWith('agent:main:session-new', '新会话标题');
    expect(switchSession).not.toHaveBeenCalled();
  });

  it('navigateToNewSessionWithPrompt always creates a new session', () => {
    const navigate = vi.fn();
    navigateToNewSessionWithPrompt(navigate as never, '/workflow', 'hello');

    expect(newSession).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ pathname: '/', search: '?q=hello' });
  });

  it('navigateToNewSessionWithPrompt supports sessionKey and legacy extraSearchParams', () => {
    const navigate = vi.fn();
    navigateToNewSessionWithPrompt(navigate as never, '/workflow', 'hello', {
      sessionKey: 'agent:main:session-1',
    });
    expect(switchSession).toHaveBeenCalledWith('agent:main:session-1');

    switchSession.mockClear();
    navigateToNewSessionWithPrompt(navigate as never, '/workflow', 'hi', { workflowId: 'tpl_1' });
    expect(navigate).toHaveBeenCalledWith({ pathname: '/', search: '?q=hi&workflowId=tpl_1' });
  });
});

describe('main-chat-navigation draft (去试试)', () => {
  beforeEach(() => {
    switchSession.mockClear();
    newSession.mockClear();
    renameSession.mockClear();
  });

  it('creates a new session and carries a one-shot draft via router state, not ?q=', () => {
    const navigate = vi.fn();
    const draft = '帮我查询钉钉通讯录\n第二行：统计「研发部」人数';

    const navigated = navigateToNewSessionWithDraft(navigate as never, draft);

    expect(navigated).toBe(true);
    expect(newSession).toHaveBeenCalledTimes(1);
    expect(switchSession).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    const [to, options] = navigate.mock.calls[0] as [unknown, { state?: Record<string, unknown> }];
    expect(to).toBe('/');
    // 独立草稿链路：目标是纯路径字符串，不得复用会触发自动发送的 ?q= 查询参数
    expect(typeof to).toBe('string');
    expect(String(to)).not.toContain('?');
    expect(options.state?.mainChatDraft).toBe(draft);
    expect(typeof options.state?.mainChatDraftToken).toBe('string');
    expect(String(options.state?.mainChatDraftToken).length).toBeGreaterThan(0);
  });

  it('generates a fresh token per navigation so repeated clicks still seed', () => {
    const navigate = vi.fn();
    navigateToNewSessionWithDraft(navigate as never, '草稿');
    navigateToNewSessionWithDraft(navigate as never, '草稿');
    const [first, second] = navigate.mock.calls as Array<
      [unknown, { state?: { mainChatDraftToken?: string } }]
    >;
    expect(first[1].state?.mainChatDraftToken).not.toBe(second[1].state?.mainChatDraftToken);
  });

  it('rejects empty or whitespace-only drafts without side effects', () => {
    const navigate = vi.fn();
    expect(navigateToNewSessionWithDraft(navigate as never, '')).toBe(false);
    expect(navigateToNewSessionWithDraft(navigate as never, '   \n\t ')).toBe(false);
    expect(newSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigateToMainChatWithDraft replaces an empty composer in a fresh session', () => {
    clearMainChatComposerDraft();
    const navigate = vi.fn();

    expect(navigateToMainChatWithDraft(navigate as never, '  案例提示词  ')).toBe(true);
    expect(newSession).toHaveBeenCalledTimes(1);
    const [to, options] = navigate.mock.calls[0] as [unknown, { state: { mainChatDraft: string } }];
    expect(to).toBe('/');
    expect(options.state.mainChatDraft).toBe('案例提示词');
  });

  it('navigateToMainChatWithDraft appends to an existing draft without discarding the session', () => {
    publishMainChatComposerDraft('已有草稿');
    const navigate = vi.fn();

    navigateToMainChatWithDraft(navigate as never, '案例提示词', { mode: 'APPEND' });

    expect(newSession).not.toHaveBeenCalled();
    const [, options] = navigate.mock.calls[0] as [unknown, { state: { mainChatDraft: string } }];
    expect(options.state.mainChatDraft).toBe('已有草稿\n\n案例提示词');
    clearMainChatComposerDraft();
  });

  it('navigateToMainChatWithDraft forwards a search string without using ?q=', () => {
    clearMainChatComposerDraft();
    const navigate = vi.fn();

    navigateToMainChatWithDraft(navigate as never, '案例提示词', { search: '?skill=daily-report' });

    const [to] = navigate.mock.calls[0] as [{ pathname: string; search: string }];
    expect(to).toEqual({ pathname: '/', search: '?skill=daily-report' });
    expect(to.search).not.toContain('q=');
  });

  it('navigateToMainChatWithDraft rejects empty drafts without side effects', () => {
    clearMainChatComposerDraft();
    const navigate = vi.fn();

    expect(navigateToMainChatWithDraft(navigate as never, '   ')).toBe(false);
    expect(newSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('readMainChatDraftState validates router state payloads', () => {
    expect(readMainChatDraftState(null)).toBeNull();
    expect(readMainChatDraftState(undefined)).toBeNull();
    expect(readMainChatDraftState('draft')).toBeNull();
    expect(readMainChatDraftState({})).toBeNull();
    expect(readMainChatDraftState({ mainChatDraft: '  ' })).toBeNull();
    expect(readMainChatDraftState({ mainChatDraft: 123 })).toBeNull();
    expect(
      readMainChatDraftState({ mainChatDraft: ' 草稿文本 ', mainChatDraftToken: ' tk ' }),
    ).toEqual({ mainChatDraft: '草稿文本', mainChatDraftToken: 'tk' });
    expect(readMainChatDraftState({ mainChatDraft: '草稿文本' })).toEqual({
      mainChatDraft: '草稿文本',
      mainChatDraftToken: '',
    });
  });
});

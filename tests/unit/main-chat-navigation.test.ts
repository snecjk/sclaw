import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isMainChatHomePath,
  navigateToMainChatHome,
  navigateToNewSessionWithPrompt,
  navigateToSessionWithPrompt,
} from '@/lib/main-chat-navigation';

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

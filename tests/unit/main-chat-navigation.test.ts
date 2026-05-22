import { describe, expect, it } from 'vitest';
import { isMainChatHomePath, navigateToMainChatHome } from '@/lib/main-chat-navigation';

describe('main-chat-navigation', () => {
  it('detects home path', () => {
    expect(isMainChatHomePath('/')).toBe(true);
    expect(isMainChatHomePath('/chat')).toBe(false);
    expect(isMainChatHomePath('/tasks/foo')).toBe(false);
  });

  it('navigateToMainChatHome only navigates when not already on home', () => {
    const calls: string[] = [];
    const navigate = (path: string) => {
      calls.push(path);
    };
    navigateToMainChatHome(navigate, '/');
    expect(calls).toEqual([]);
    navigateToMainChatHome(navigate, '/cron');
    expect(calls).toEqual(['/']);
  });
});

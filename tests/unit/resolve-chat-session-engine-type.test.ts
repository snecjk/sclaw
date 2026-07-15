import { describe, expect, it } from 'vitest';
import {
  resolveChatSessionEngineType,
  resolveUnusedEmbedChatEngineType,
} from '@/lib/resolve-chat-session-engine-type';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

describe('resolveChatSessionEngineType', () => {
  it('follows agent default for unused embed sessions even when session stamp is openclaw', () => {
    expect(resolveChatSessionEngineType(
      { engineType: 'openclaw' },
      'claude',
      'agent:main:session-embed-app-ext-1--cabc',
      { messageCount: 0 },
    )).toBe('claude');
  });

  it('keeps session engine once embed chat has messages', () => {
    expect(resolveChatSessionEngineType(
      { engineType: 'openclaw' },
      'claude',
      'agent:main:session-embed-app-ext-1--cabc',
      { messageCount: 2 },
    )).toBe('openclaw');
  });

  it('uses agent default for home empty slot', () => {
    expect(resolveChatSessionEngineType(undefined, 'claude', DEFAULT_SESSION_KEY)).toBe('claude');
  });

  it('resolveUnusedEmbedChatEngineType normalizes agent engine', () => {
    expect(resolveUnusedEmbedChatEngineType('claude')).toBe('claude');
    expect(resolveUnusedEmbedChatEngineType(undefined)).toBe('openclaw');
  });
});

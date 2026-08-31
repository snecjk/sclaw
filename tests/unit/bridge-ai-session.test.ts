import { describe, expect, it } from 'vitest';
import {
  createBridgeAiSessionKey,
  isBridgeAiChatSessionForApp,
  isBridgeAiChatSessionKey,
  parseBridgeAiSessionKey,
} from '../../shared/bridge-ai-session';
import { isSidebarHiddenChatSessionKey } from '../../src/lib/sto-task-session';
import { isSidebarRecentChatSessionKey } from '../../src/lib/sidebar-recent-order';
import { inferSessionCatalogMeta } from '../../shared/session-type';

describe('createBridgeAiSessionKey', () => {
  it('follows the agent:{id}:{category}:... segmentation convention', () => {
    expect(createBridgeAiSessionKey('main', 'demo', 'c1')).toBe('agent:main:bridge-ai:demo:c1');
  });

  it('lowercases every segment so gateway normalization cannot desync delivery', () => {
    expect(createBridgeAiSessionKey('Research', 'MyApp', 'C1'))
      .toBe('agent:research:bridge-ai:myapp:c1');
  });

  it('replaces colons so segmentation stays intact', () => {
    const key = createBridgeAiSessionKey('main', 'a:b', 'c:1');
    expect(key).toBe('agent:main:bridge-ai:a_b:c_1');
    expect(parseBridgeAiSessionKey(key)).toEqual({
      agentId: 'main',
      appId: 'a_b',
      conversationId: 'c_1',
    });
  });

  it('falls back to main when agentId is blank', () => {
    expect(createBridgeAiSessionKey('', 'demo', 'c1')).toBe('agent:main:bridge-ai:demo:c1');
  });

  it('generates a conversation id when omitted', () => {
    const key = createBridgeAiSessionKey('main', 'demo');
    const parsed = parseBridgeAiSessionKey(key);
    expect(parsed?.appId).toBe('demo');
    expect(parsed?.conversationId).toBeTruthy();
  });

  it('round-trips construction and parsing', () => {
    const key = createBridgeAiSessionKey('research', 'crm', 'conv-7');
    expect(parseBridgeAiSessionKey(key)).toEqual({
      agentId: 'research',
      appId: 'crm',
      conversationId: 'conv-7',
    });
  });
});

describe('isBridgeAiChatSessionKey', () => {
  it('matches any agentId, not just main', () => {
    expect(isBridgeAiChatSessionKey('agent:research:bridge-ai:demo:c1')).toBe(true);
    expect(isBridgeAiChatSessionKey('agent:main:bridge-ai:demo:c1')).toBe(true);
  });

  it('does not match other session categories', () => {
    expect(isBridgeAiChatSessionKey('agent:main:session-embed-app-demo')).toBe(false);
    expect(isBridgeAiChatSessionKey('agent:main:session-1234-abcd')).toBe(false);
    expect(isBridgeAiChatSessionKey('agent:main:cron:job1')).toBe(false);
    expect(isBridgeAiChatSessionKey('agent:main:main')).toBe(false);
    expect(isBridgeAiChatSessionKey('claude-task:t1')).toBe(false);
  });

  it('rejects keys with insufficient segments', () => {
    expect(isBridgeAiChatSessionKey('agent:main:bridge-ai')).toBe(false);
    expect(isBridgeAiChatSessionKey('agent:main:bridge-ai:demo')).toBe(false);
  });

  it('rejects keys with empty segments', () => {
    expect(isBridgeAiChatSessionKey('agent:main:bridge-ai::c1')).toBe(false);
    expect(isBridgeAiChatSessionKey('agent:main:bridge-ai:demo:')).toBe(false);
  });
});

describe('isBridgeAiChatSessionForApp', () => {
  it('matches the owning app and rejects others', () => {
    const key = createBridgeAiSessionKey('main', 'MyApp', 'c1');
    expect(isBridgeAiChatSessionForApp(key, 'MyApp')).toBe(true);
    expect(isBridgeAiChatSessionForApp(key, 'myapp')).toBe(true);
    expect(isBridgeAiChatSessionForApp(key, 'other')).toBe(false);
  });

  it('returns false for non bridge-ai keys', () => {
    expect(isBridgeAiChatSessionForApp('agent:main:session-1234-a', 'demo')).toBe(false);
  });
});

describe('bridge AI sessions stay out of the sidebar', () => {
  const key = createBridgeAiSessionKey('main', 'demo', 'c1');
  const nonMainKey = createBridgeAiSessionKey('research', 'demo', 'c1');

  it('is hidden from the sidebar session list', () => {
    expect(isSidebarHiddenChatSessionKey(key)).toBe(true);
    expect(isSidebarHiddenChatSessionKey(nonMainKey)).toBe(true);
  });

  it('is excluded from the sidebar recent ordering set', () => {
    expect(isSidebarRecentChatSessionKey(key)).toBe(false);
    expect(isSidebarRecentChatSessionKey(nonMainKey)).toBe(false);
  });

  it('keeps ordinary chat sessions visible', () => {
    expect(isSidebarHiddenChatSessionKey('agent:main:session-123')).toBe(false);
    expect(isSidebarRecentChatSessionKey('agent:main:session-123')).toBe(true);
    // agent:main:main is the main-agent home session and was already hidden.
    expect(isSidebarHiddenChatSessionKey('agent:main:main')).toBe(true);
    expect(isBridgeAiChatSessionKey('agent:main:main')).toBe(false);
  });

  it('leaves other hidden session kinds classified as before', () => {
    // Embed-app and cron were already hidden/excluded; adding bridge-ai must not
    // flip them, nor start matching them via the new predicate.
    expect(isBridgeAiChatSessionKey('agent:main:session-embed-app-crm')).toBe(false);
    expect(isSidebarHiddenChatSessionKey('agent:main:session-embed-app-crm')).toBe(true);
    expect(isBridgeAiChatSessionKey('agent:main:cron:job-123:2026-07-14')).toBe(false);
    expect(isSidebarRecentChatSessionKey('agent:main:cron:job-123:2026-07-14')).toBe(false);
  });
});

describe('inferSessionCatalogMeta for bridge AI keys', () => {
  it('classifies bridge AI sessions as bridge_ai and backfills appId', () => {
    expect(inferSessionCatalogMeta('agent:main:bridge-ai:demo:c1')).toEqual({
      sessionType: 'bridge_ai',
      taskId: null,
      appId: 'demo',
    });
  });

  it('classifies non-main agent bridge AI sessions too', () => {
    expect(inferSessionCatalogMeta('agent:research:bridge-ai:crm:c9')).toEqual({
      sessionType: 'bridge_ai',
      taskId: null,
      appId: 'crm',
    });
  });

  it('does not classify an incomplete bridge-ai key as bridge_ai', () => {
    expect(inferSessionCatalogMeta('agent:main:bridge-ai').sessionType).toBe('chat');
  });

  it('leaves existing classifications unchanged', () => {
    expect(inferSessionCatalogMeta('agent:main:cron:job-123').sessionType).toBe('cron');
    expect(inferSessionCatalogMeta('agent:main:scheduled-task:42:2026-07-14').sessionType)
      .toBe('scheduled_task');
    expect(inferSessionCatalogMeta('claude-task:task-abc').sessionType).toBe('claude_task');
    expect(inferSessionCatalogMeta('agent:main:session-embed-app-crm').sessionType).toBe('app');
    expect(inferSessionCatalogMeta('agent:main:main').sessionType).toBe('chat');
  });
});

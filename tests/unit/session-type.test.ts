import { describe, expect, it } from 'vitest';
import { inferSessionCatalogMeta, isWebBridgeChatSessionKey, WEB_BRIDGE_CHAT_SESSION_KEY } from '../../shared/session-type';

describe('inferSessionCatalogMeta', () => {
  it('classifies regular chat sessions', () => {
    expect(inferSessionCatalogMeta('agent:main:main')).toEqual({
      sessionType: 'chat',
      taskId: null,
      appId: null,
    });
    expect(inferSessionCatalogMeta('agent:main:550e8400-e29b-41d4-a716-446655440000')).toEqual({
      sessionType: 'chat',
      taskId: null,
      appId: null,
    });
    expect(inferSessionCatalogMeta('agent:main:web-bridge')).toEqual({
      sessionType: 'chat',
      taskId: null,
      appId: null,
    });
  });

  it('classifies cron sessions and extracts job id', () => {
    expect(inferSessionCatalogMeta('agent:main:cron:job-123')).toEqual({
      sessionType: 'cron',
      taskId: 'job-123',
      appId: null,
    });
    expect(inferSessionCatalogMeta('agent:custom-agent:cron:job-123:2026-07-14')).toEqual({
      sessionType: 'cron',
      taskId: 'job-123',
      appId: null,
    });
    expect(inferSessionCatalogMeta('agent:custom-agent:cron:job-123:run:abc')).toEqual({
      sessionType: 'cron',
      taskId: 'job-123',
      appId: null,
    });
  });

  it('classifies scheduled task sessions', () => {
    expect(inferSessionCatalogMeta('scheduled-task:42')).toEqual({
      sessionType: 'scheduled_task',
      taskId: '42',
      appId: null,
    });
    expect(inferSessionCatalogMeta('agent:main:scheduled-task:42:2026-07-14')).toEqual({
      sessionType: 'scheduled_task',
      taskId: '42',
      appId: null,
    });
  });

  it('classifies claude task sessions', () => {
    expect(inferSessionCatalogMeta('claude-task:task-abc')).toEqual({
      sessionType: 'claude_task',
      taskId: 'task-abc',
      appId: null,
    });
    expect(inferSessionCatalogMeta('claude-task:task-abc:2026-07-14')).toEqual({
      sessionType: 'claude_task',
      taskId: 'task-abc',
      appId: null,
    });
    expect(inferSessionCatalogMeta('claude-task-run:task-abc:run-1')).toEqual({
      sessionType: 'claude_task',
      taskId: 'task-abc',
      appId: null,
    });
  });

  it('classifies app embed sessions and extracts app id', () => {
    expect(inferSessionCatalogMeta('agent:main:session-embed-app-crm')).toEqual({
      sessionType: 'app',
      taskId: null,
      appId: 'crm',
    });
    expect(inferSessionCatalogMeta('agent:main:session-embed-app-crm--conv-1')).toEqual({
      sessionType: 'app',
      taskId: null,
      appId: 'crm',
    });
  });
});

describe('isWebBridgeChatSessionKey', () => {
  it('matches only the pinned Chrome side-panel session', () => {
    expect(WEB_BRIDGE_CHAT_SESSION_KEY).toBe('agent:main:web-bridge');
    expect(isWebBridgeChatSessionKey('agent:main:web-bridge')).toBe(true);
    expect(isWebBridgeChatSessionKey(' agent:main:web-bridge ')).toBe(true);
    expect(isWebBridgeChatSessionKey('agent:main:main')).toBe(false);
    expect(isWebBridgeChatSessionKey('agent:main:web-bridge-extra')).toBe(false);
  });
});

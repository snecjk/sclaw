import { describe, expect, it } from 'vitest';
import { resolveChatEngineType } from '@/lib/chat-engine-resolution';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

describe('resolveChatEngineType', () => {
  it('lets UI callers prefer the session engine before key inference', () => {
    expect(resolveChatEngineType({
      sessionKey: 'agent:main:cron:job-1:2026-06-25',
      sessionEngineType: 'claude',
      agentEngineType: 'openclaw',
      sessionEngineFirst: true,
      inferOpenClawTaskKeys: true,
    })).toBe('claude');
  });

  it('lets store default session use the current agent engine', () => {
    expect(resolveChatEngineType({
      sessionKey: DEFAULT_SESSION_KEY,
      agentEngineType: 'claude',
      defaultSessionUsesAgent: true,
    })).toBe('claude');
  });

  it('routes Claude scheduled task keys to Claude', () => {
    expect(resolveChatEngineType({
      sessionKey: 'claude-task:task-1:2026-06-25',
      agentEngineType: 'openclaw',
    })).toBe('claude');

    expect(resolveChatEngineType({
      sessionKey: 'claude-task-run:task-1:run-9',
      agentEngineType: 'openclaw',
    })).toBe('claude');
  });

  it('routes OpenClaw-hosted task keys to OpenClaw when enabled', () => {
    expect(resolveChatEngineType({
      sessionKey: 'agent:main:cron:job-1:2026-06-25',
      agentEngineType: 'claude',
      inferOpenClawTaskKeys: true,
    })).toBe('openclaw');

    expect(resolveChatEngineType({
      sessionKey: 'agent:main:scheduled-task:9:2026-06-25',
      agentEngineType: 'claude',
      inferOpenClawTaskKeys: true,
    })).toBe('openclaw');
  });

  it('falls back to session engine, then agent engine, then OpenClaw', () => {
    expect(resolveChatEngineType({
      sessionEngineType: 'claude',
      agentEngineType: 'openclaw',
    })).toBe('claude');

    expect(resolveChatEngineType({
      agentEngineType: 'claude',
    })).toBe('claude');

    expect(resolveChatEngineType({})).toBe('openclaw');
  });
});

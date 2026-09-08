import { describe, expect, it } from 'vitest';
import { sessionHasOlderHistory, shouldSkipQuietHistoryRpc } from '@/stores/chat/history-load-actions';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';

describe('shouldSkipQuietHistoryRpc', () => {
  it('skips quiet switch reloads when local transcript exists', () => {
    expect(shouldSkipQuietHistoryRpc({
      quiet: true,
      force: false,
      cachedTranscriptCount: 450,
    })).toBe(true);
  });

  it('does not skip a cold load without cache', () => {
    expect(shouldSkipQuietHistoryRpc({
      quiet: false,
      force: false,
      cachedTranscriptCount: 0,
    })).toBe(false);
  });

  it('does not skip event-driven force reloads', () => {
    expect(shouldSkipQuietHistoryRpc({
      quiet: true,
      force: true,
      cachedTranscriptCount: 450,
    })).toBe(false);
  });

  it('loads adapter capabilities for a legacy cache before reusing it', () => {
    expect(shouldSkipQuietHistoryRpc({
      quiet: true,
      force: false,
      cachedTranscriptCount: 50,
      cachedHistoryCapabilitiesKnown: false,
    })).toBe(false);
  });
});

describe('sessionHasOlderHistory', () => {
  it('uses adapter-provided pagination capability instead of engine type', () => {
    useChatRuntimeV2Store.setState({
      sessionsByKey: {
        'custom:session': {
          ...createClientSessionState(),
          transcript: [{ id: 'm2', role: 'assistant', content: 'latest' }],
          historyTotalCount: 2,
          historyCapabilities: { paginationMode: 'before-id', defaultPageSize: 50 },
        },
      },
    });
    expect(sessionHasOlderHistory('custom:session')).toBe(true);
  });

  it('does not offer older-page loading for snapshot-only adapters', () => {
    useChatRuntimeV2Store.setState({
      sessionsByKey: {
        'snapshot:session': {
          ...createClientSessionState(),
          transcript: [{ id: 'm2', role: 'assistant', content: 'latest' }],
          historyTotalCount: 2,
          historyCapabilities: { paginationMode: 'none', defaultPageSize: 1000 },
        },
      },
    });
    expect(sessionHasOlderHistory('snapshot:session')).toBe(false);
  });
});

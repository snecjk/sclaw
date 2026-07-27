import { describe, expect, it } from 'vitest';
import { resolveHostApiTimeoutMs } from '@electron/main/ipc/host-api-proxy';
import { TIMEOUTS } from '@electron/utils/config';

describe('Host API proxy timeout routing', () => {
  it('allows chat send acknowledgement up to 60 seconds', () => {
    expect(resolveHostApiTimeoutMs('/api/chat/send')).toBe(60_000);
    expect(resolveHostApiTimeoutMs('/api/chat/send')).toBe(TIMEOUTS.CHAT_SEND);
  });

  it('keeps unrelated requests on the default timeout', () => {
    expect(resolveHostApiTimeoutMs('/api/chat/history')).toBe(TIMEOUTS.DEFAULT_FETCH);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveHostApiTimeoutMs } from '@electron/main/ipc/host-api-proxy';
import { TIMEOUTS } from '@electron/utils/config';

describe('Host API proxy timeout routing', () => {
  it('allows chat send acknowledgement up to 60 seconds', () => {
    expect(resolveHostApiTimeoutMs('/api/chat/send')).toBe(60_000);
    expect(resolveHostApiTimeoutMs('/api/chat/send')).toBe(TIMEOUTS.CHAT_SEND);
  });

  it('does not time out native local file authorization dialogs', () => {
    expect(resolveHostApiTimeoutMs('/api/local-authorized-files/authorize')).toBe(TIMEOUTS.LOCAL_FILE_AUTHORIZE);
    expect(resolveHostApiTimeoutMs('/api/local-authorized-files/authorize')).toBe(0);
  });

  it('keeps unrelated requests on the default timeout', () => {
    expect(resolveHostApiTimeoutMs('/api/chat/history')).toBe(TIMEOUTS.DEFAULT_FETCH);
  });

  it('allows connector connect/token-connect up to DWS install budget (download CLI)', () => {
    expect(resolveHostApiTimeoutMs('/api/connectors/conn-27389885c97c/connect')).toBe(
      TIMEOUTS.DWS_INSTALL,
    );
    expect(resolveHostApiTimeoutMs('/api/connectors/conn-gitlab/token-connect')).toBe(
      TIMEOUTS.DWS_INSTALL,
    );
    expect(resolveHostApiTimeoutMs('/api/connectors/conn-27389885c97c/connect')).toBe(300_000);
  });
});

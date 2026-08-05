import { describe, expect, it } from 'vitest';

import { ConnectorError, ConnectorErrorCode } from '../../electron/connectors/errors';

describe('ConnectorError AUTH_CANCELLED', () => {
  it('preserves cancel code for route mapping', () => {
    const error = new ConnectorError(ConnectorErrorCode.AUTH_CANCELLED, '已取消授权');
    expect(error.code).toBe('AUTH_CANCELLED');
    expect(error.message).toContain('取消');
  });
});

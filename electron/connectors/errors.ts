export class ConnectorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
  }
}

export const ConnectorErrorCode = {
  UNKNOWN_KIND: 'UNKNOWN_KIND',
  NOT_FOUND: 'NOT_FOUND',
  BUSY: 'BUSY',
  INSTALL_FAILED: 'INSTALL_FAILED',
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_CANCELLED: 'AUTH_CANCELLED',
  CATALOG_FAILED: 'CATALOG_FAILED',
} as const;

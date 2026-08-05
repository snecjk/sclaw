import type { ConnectorStatus } from './types';

/** User-facing status label for connector-index (Chinese). */
export function connectorStatusLabel(status: ConnectorStatus | undefined): string {
  switch (status) {
    case 'connected':
      return '已连接';
    case 'installed':
      return '已安装未连接';
    case 'installing':
      return '安装中';
    case 'authorizing':
      return '授权中';
    case 'error':
      return '错误';
    case 'available':
    default:
      return '未连接';
  }
}

/**
 * Sidebar channel source badge helpers.
 *
 * Prefer catalog.channelType; fall back to sessionKey shape for legacy rows
 * that were created before channel metadata was written.
 */

export type SidebarChannelSource = 'dingtalk' | 'wechat' | 'app';

const SOURCE_FROM_CATALOG: Record<string, SidebarChannelSource> = {
  dingtalk: 'dingtalk',
  wechat: 'wechat',
  'openclaw-weixin': 'wechat',
  app: 'app',
  mobile: 'app',
  'sto-mobile': 'app',
};

const SOURCE_FROM_KEY: Record<string, SidebarChannelSource> = {
  dingtalk: 'dingtalk',
  wechat: 'wechat',
  app: 'app',
  mobile: 'app',
};

export function resolveSidebarChannelSource(
  sessionKey: string,
  catalogChannelType?: string | null,
): SidebarChannelSource | null {
  const fromCatalog = SOURCE_FROM_CATALOG[(catalogChannelType ?? '').trim().toLowerCase()];
  if (fromCatalog) return fromCatalog;

  const parts = sessionKey.trim().split(':');
  if (parts[0] === 'agent' && parts.length >= 4) {
    return SOURCE_FROM_KEY[parts[2]] ?? null;
  }
  return null;
}

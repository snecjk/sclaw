import { resolveEffectiveConnector } from './resolve-effective-runtime';
import type { ConnectorViewItem } from './types';

/** Resolve the DingTalk (dws) connector id from the plaza catalog. */
export function findDingTalkConnectorId(items: ConnectorViewItem[]): string | null {
  for (const item of items) {
    try {
      if (resolveEffectiveConnector(item).binary === 'dws') return item.id;
    } catch {
      // ignore malformed catalog entries
    }
  }
  const byMeta = items.find((item) => {
    const haystack = `${item.id} ${item.name} ${item.badge}`.toLowerCase();
    return haystack.includes('dingtalk') || haystack.includes('钉钉') || /\bdws\b/.test(haystack);
  });
  return byMeta?.id ?? null;
}

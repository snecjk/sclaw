/**
 * OpenClaw IM channel keys / plugin ids retired from SClaw.
 * Product keeps DingTalk Hub + WeChat Host Worker + Mobile; OC channel plugins are stripped.
 */

/** Allowed keys under openclaw.json `channels` (WeChat Host storage). */
export const ALLOWED_OPENCLAW_CHANNEL_KEYS = new Set([
  'openclaw-weixin',
  'wechat', // read-only alias; Host may still migrate
]);

/** Channel keys stripped from openclaw.json `channels` on sanitize. */
export const RETIRED_OPENCLAW_CHANNEL_KEYS = [
  'dingtalk', // OC plugin config only; Hub bindings live in SQLite
  'whatsapp',
  'telegram',
  'discord',
  'wecom',
  'qqbot',
  'signal',
  'imessage',
  'matrix',
  'line',
  'msteams',
  'googlechat',
  'mattermost',
] as const;

/** Plugin ids stripped from plugins.entries / plugins.allow (never sto-dingtalk-send-guard). */
export const RETIRED_CHANNEL_PLUGIN_IDS = [
  'dingtalk',
  'whatsapp',
  'wecom',
  'qqbot',
  'wecom-openclaw-plugin',
] as const;

const RETIRED_CHANNEL_KEY_SET = new Set<string>(RETIRED_OPENCLAW_CHANNEL_KEYS);
const RETIRED_PLUGIN_ID_SET = new Set<string>(RETIRED_CHANNEL_PLUGIN_IDS);

export const CHANNEL_CONFIG_RETIRED_MESSAGE = '该渠道已下线，请使用钉钉或微信。';
export const DINGTALK_OC_CONFIG_RETIRED_MESSAGE = '钉钉请使用 Hub 扫码绑定。';

export function isRetiredOpenClawChannelKey(channelType: string): boolean {
  return RETIRED_CHANNEL_KEY_SET.has(channelType);
}

export function isRetiredChannelPluginId(pluginId: string): boolean {
  return RETIRED_PLUGIN_ID_SET.has(pluginId);
}

/**
 * Reject Host OC-style channel config saves.
 * Allows only WeChat (`wechat` / `openclaw-weixin`). DingTalk OC token save → Hub message.
 */
export function getChannelConfigSaveRejection(
  channelType: string,
): { error: string } | null {
  const trimmed = (channelType || '').trim();
  if (!trimmed) {
    return { error: CHANNEL_CONFIG_RETIRED_MESSAGE };
  }
  if (trimmed === 'wechat' || trimmed === 'openclaw-weixin') {
    return null;
  }
  if (trimmed === 'dingtalk') {
    return { error: DINGTALK_OC_CONFIG_RETIRED_MESSAGE };
  }
  if (isRetiredOpenClawChannelKey(trimmed)) {
    return { error: CHANNEL_CONFIG_RETIRED_MESSAGE };
  }
  // Fail closed for unknown OC channel types (legacy leftovers / typos).
  return { error: CHANNEL_CONFIG_RETIRED_MESSAGE };
}

/**
 * Mutate openclaw.json-shaped config: strip retired channels, plugin wiring, bindings.
 * Does not touch Hub SQLite. Preserves sto-* plugins including sto-dingtalk-send-guard.
 */
export function stripRetiredChannelsFromOpenClawConfig(
  config: Record<string, unknown>,
): boolean {
  let modified = false;

  const channels = config.channels;
  if (channels && typeof channels === 'object' && !Array.isArray(channels)) {
    const channelsObj = channels as Record<string, unknown>;
    for (const key of Object.keys(channelsObj)) {
      if (!ALLOWED_OPENCLAW_CHANNEL_KEYS.has(key)) {
        delete channelsObj[key];
        modified = true;
      }
    }
    if (Object.keys(channelsObj).length === 0) {
      delete config.channels;
      modified = true;
    }
  }

  const plugins = config.plugins;
  if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
    const pluginsObj = plugins as Record<string, unknown>;

    if (Array.isArray(pluginsObj.allow)) {
      const before = pluginsObj.allow as unknown[];
      const filtered = before.filter(
        (id) => typeof id !== 'string' || !isRetiredChannelPluginId(id),
      );
      if (filtered.length !== before.length) {
        pluginsObj.allow = filtered;
        modified = true;
      }
    }

    const entries = pluginsObj.entries;
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
      const entriesObj = entries as Record<string, unknown>;
      for (const pluginId of RETIRED_CHANNEL_PLUGIN_IDS) {
        if (pluginId in entriesObj) {
          delete entriesObj[pluginId];
          modified = true;
        }
      }
    }
  }

  const bindings = config.bindings;
  if (Array.isArray(bindings)) {
    const filtered = bindings.filter((binding) => {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        return true;
      }
      const match = (binding as Record<string, unknown>).match;
      if (!match || typeof match !== 'object' || Array.isArray(match)) {
        return true;
      }
      const channel = (match as Record<string, unknown>).channel;
      return typeof channel !== 'string' || !isRetiredOpenClawChannelKey(channel);
    });
    if (filtered.length !== bindings.length) {
      config.bindings = filtered;
      modified = true;
    }
  }

  return modified;
}

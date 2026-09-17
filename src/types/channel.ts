/**
 * Channel Type Definitions
 * Types for messaging channels (DingTalk, WeChat)
 */

/**
 * Supported channel types
 */
export type ChannelType = 'wechat' | 'dingtalk';

/**
 * Channel connection status
 */
export type ChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * Channel connection type
 */
export type ChannelConnectionType = 'token' | 'qr' | 'oauth' | 'webhook';

/**
 * Channel data structure
 */
export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  accountId?: string;
  lastActivity?: string;
  error?: string;
  avatar?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Channel configuration field definition
 */
export interface ChannelConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select';
  placeholder?: string;
  required?: boolean;
  envVar?: string;
  description?: string;
  options?: { value: string; label: string }[];
}

/**
 * Channel metadata with configuration info
 */
export interface ChannelMeta {
  id: ChannelType;
  name: string;
  icon: string;
  description: string;
  connectionType: ChannelConnectionType;
  docsUrl: string;
  configFields: ChannelConfigField[];
  instructions: string[];
  isPlugin?: boolean;
}

/**
 * Channel icons mapping
 */
export const CHANNEL_ICONS: Record<ChannelType, string> = {
  wechat: '💬',
  dingtalk: '💬',
};

/**
 * Channel display names
 */
export const CHANNEL_NAMES: Record<ChannelType, string> = {
  wechat: '微信',
  dingtalk: '钉钉',
};

/**
 * Channel metadata with configuration information
 */
export const CHANNEL_META: Record<ChannelType, ChannelMeta> = {
  dingtalk: {
    id: 'dingtalk',
    name: '钉钉',
    icon: '💬',
    description: 'channels:meta.dingtalk.description',
    connectionType: 'qr',
    docsUrl: 'channels:meta.dingtalk.docsUrl',
    configFields: [],
    instructions: [
      'channels:meta.dingtalk.instructions.0',
      'channels:meta.dingtalk.instructions.1',
      'channels:meta.dingtalk.instructions.2',
      'channels:meta.dingtalk.instructions.3',
    ],
    isPlugin: false,
  },
  wechat: {
    id: 'wechat',
    name: '微信',
    icon: '💬',
    description: 'channels:meta.wechat.description',
    connectionType: 'qr',
    docsUrl: 'channels:meta.wechat.docsUrl',
    configFields: [],
    instructions: [
      'channels:meta.wechat.instructions.0',
      'channels:meta.wechat.instructions.1',
      'channels:meta.wechat.instructions.2',
      'channels:meta.wechat.instructions.3',
    ],
    isPlugin: true,
  },
};

/**
 * Get primary supported channels (non-plugin, commonly used)
 */
export function getPrimaryChannels(): ChannelType[] {
  // Phase 1: DingTalk Hub + Weixin Host Worker only.
  return ['dingtalk', 'wechat'];
}

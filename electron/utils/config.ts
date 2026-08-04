/**
 * Application Configuration
 * Centralized configuration constants and helpers
 */

/**
 * Port configuration
 */
export const PORTS = {
  /** StoClaw GUI development server port */
  CLAWX_DEV: 5173,
  
  /** StoClaw GUI production port (for reference) */
  CLAWX_GUI: 23333,

  /** Local host API server port */
  CLAWX_HOST_API: 3210,
  
  /** OpenClaw Gateway port */
  OPENCLAW_GATEWAY: 18789,
} as const;

/** Network timeout configuration (milliseconds) */
export const TIMEOUTS = {
  /** Default proxyAwareFetch timeout */
  DEFAULT_FETCH: 15_000,
  /** Chat send acknowledgement may include engine/runtime initialization. */
  CHAT_SEND: 60_000,
  /** Skill ZIP download + extract (plaza / sto-skills / clawhub install) */
  SKILL_INSTALL: 180_000,
  /** DingTalk dws CLI download + skill zip + gateway restart prompt */
  DWS_INSTALL: 300_000,
  /** SSO login flow */
  AUTH_LOGIN: 300_000,
  /** Scheduled task instruction AI beautify */
  BEAUTIFY_INSTRUCTION: 60_000,
  /** Native file/folder picker waits until the user confirms or cancels. */
  LOCAL_FILE_AUTHORIZE: 0,
} as const;

/**
 * Get port from environment or default
 */
export function getPort(key: keyof typeof PORTS): number {
  const envKey = `CLAWX_PORT_${key}`;
  const envValue = process.env[envKey];
  return envValue ? parseInt(envValue, 10) : PORTS[key];
}

/**
 * Application paths
 */
export const APP_PATHS = {
  /** OpenClaw configuration directory */
  OPENCLAW_CONFIG: '~/.stoclaw/openclaw',
  
  /** StoClaw configuration directory */
  CLAWX_CONFIG: '~/.stoclaw',
  
  /** Log files directory */
  LOGS: '~/.stoclaw/logs',
} as const;

/**
 * Update channels
 */
export const UPDATE_CHANNELS = ['stable', 'beta', 'dev'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/**
 * Default update configuration
 */
export const UPDATE_CONFIG = {
  /** Check interval in milliseconds (6 hours) */
  CHECK_INTERVAL: 6 * 60 * 60 * 1000,
  
  /** Default update channel */
  DEFAULT_CHANNEL: 'stable' as UpdateChannel,
  
  /** Auto download updates */
  AUTO_DOWNLOAD: false,
  
  /** Show update notifications */
  SHOW_NOTIFICATION: true,
};

/**
 * Gateway configuration
 */
export const GATEWAY_CONFIG = {
  /** WebSocket reconnection delay (ms) */
  RECONNECT_DELAY: 5000,
  
  /** RPC call timeout (ms) */
  RPC_TIMEOUT: 30000,
  
  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL: 30000,
  
  /** Maximum startup retries */
  MAX_STARTUP_RETRIES: 30,
  
  /** Startup retry interval (ms) */
  STARTUP_RETRY_INTERVAL: 1000,
};

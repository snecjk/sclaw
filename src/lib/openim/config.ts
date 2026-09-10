export interface OpenIMConfig {
  enabled: boolean;
  apiAddr: string;
  wsAddr: string;
  userID: string;
  token: string;
  isConfigured: boolean;
}

export interface OpenIMBaseConfig {
  enabled: boolean;
  apiAddr: string;
  wsAddr: string;
}

export interface OpenIMCredentialInput {
  apiAddr?: string;
  wsAddr?: string;
  userID?: string;
  token?: string;
}

export function getOpenIMBaseConfig(): OpenIMBaseConfig {
  const enabled = import.meta.env.VITE_OPENIM_ENABLED === 'true';
  const apiAddr = (import.meta.env.VITE_OPENIM_API_ADDR || 'http://127.0.0.1:10002').trim();
  const wsAddr = (import.meta.env.VITE_OPENIM_WS_ADDR || 'ws://127.0.0.1:10001').trim();
  return { enabled, apiAddr, wsAddr };
}

export function toOpenIMConfig(credentials?: OpenIMCredentialInput): OpenIMConfig {
  const base = getOpenIMBaseConfig();
  const userID = (credentials?.userID || '').trim();
  const token = (credentials?.token || '').trim();
  const apiAddr = (credentials?.apiAddr || base.apiAddr).trim();
  const wsAddr = (credentials?.wsAddr || base.wsAddr).trim();

  return {
    enabled: base.enabled,
    apiAddr,
    wsAddr,
    userID,
    token,
    isConfigured: base.enabled && Boolean(userID && token),
  };
}

/** @deprecated Prefer getOpenIMBaseConfig + session store credentials. */
export function getOpenIMConfig(): OpenIMConfig {
  const base = getOpenIMBaseConfig();
  const userID = (import.meta.env.VITE_OPENIM_USER_ID || '').trim();
  const token = (import.meta.env.VITE_OPENIM_TOKEN || '').trim();
  return toOpenIMConfig({
    apiAddr: base.apiAddr,
    wsAddr: base.wsAddr,
    userID,
    token,
  });
}

export type StoSsoDeployEnv = 'daily' | 'stage' | 'online';
export type StoSsoEnvironment = 'daily' | 'pre' | 'prod';

export interface StoSsoAuthConfig {
  protocolVersion: 'sto-sso-auth/v1';
  applicationId: string;
  pageType: 'site';
  runtimeMode: 'local' | 'published';
  deployEnv: StoSsoDeployEnv;
  sso?: {
    environment: StoSsoEnvironment;
    systemCode: string;
    loginOrigin: string;
    apiOrigin: string;
  };
}

export interface StoSsoUser {
  userId?: string;
  userCode?: string;
  userName?: string;
  mobile?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface StoSsoAuth {
  bootstrap(): Promise<void>;
  getToken(): string | null;
  getUser(): StoSsoUser | null;
  logout(): Promise<void>;
  handleUnauthorized(): Promise<void>;
}

export interface BootstrapSsoAuthOptions {
  config?: unknown;
  fetch?: typeof fetch;
  platform?: import('./browser-platform').SsoBrowserPlatform;
}

export interface SclawFrontendPluginContext {
  pageType: 'site' | 'assets';
  provide(key: 'auth.sto-token', value: StoSsoAuth): void;
}

export interface SclawFrontendPlugin {
  id: string;
  pageTypes: readonly ('site' | 'assets')[];
  activate(context: SclawFrontendPluginContext): Promise<void> | void;
}

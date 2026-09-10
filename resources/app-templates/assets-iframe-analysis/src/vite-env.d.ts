/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCLAW_APPLICATION_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __STO_SSO_AUTH_CONFIG__?: {
    runtimeMode?: 'local' | 'published';
  };
  __SCLAW_APP_CONFIG__?: {
    applicationId?: string;
    deployEnv?: 'daily' | 'stage' | 'online';
  };
}

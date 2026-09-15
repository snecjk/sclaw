/// <reference types="vite/client" />

interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __STO_SSO_AUTH_CONFIG__?: {
    runtimeMode?: 'local' | 'published';
  };
}

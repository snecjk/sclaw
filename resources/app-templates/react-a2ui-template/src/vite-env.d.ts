/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SSO_ENV?: string;
  readonly VITE_SSO_BASE_URL?: string;
  readonly VITE_SSO_API_BASE_URL?: string;
  readonly VITE_SSO_SYSTEM_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

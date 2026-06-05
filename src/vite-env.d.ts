/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV: string;
  /** Default: provincial; set `full` for complete sidebar — see README.md / OpenSpec `changes/archive/provincial-sidebar-variant`. */
  readonly VITE_STOCLAW_SIDEBAR_LAYOUT?: string;
}

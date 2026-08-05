/**
 * Shared connector plaza types (Main ↔ Renderer).
 * Aligned with memory-center `/agent/v1/app-plaza/connectors`.
 * Client toolbar shows a fixed「链接器」entry (not server-driven tabs).
 */

export type ConnectorStatus =
  | 'available'
  | 'installing'
  | 'authorizing'
  | 'installed'
  | 'connected'
  | 'error';

export type ConnectorConnectPhase = 'installing' | 'authorizing';

export interface ManagedCliGatewaySpec {
  allowBinary: string;
  /** Extra binaries unlocked with this connector (e.g. git alongside glab). */
  allowBinaries?: string[];
  denyArgs?: string[];
}

/**
 * How to present cli_login.
 * - open_url: spawn login, extract URL via loginUrlPattern, open embedded/system
 * - none: just spawn login argv
 * - embedded: deprecated alias of open_url (kept for older catalogs)
 */
export type ManagedCliAuthUi = 'open_url' | 'none' | 'embedded';

export type ManagedCliAuthOpenIn = 'embedded' | 'system';

export interface ManagedCliAuthSpec {
  type: 'cli_login' | 'api_token';
  hint?: string;
  login?: string[];
  /** Windows override for login argv (e.g. dws device flow). */
  loginWindows?: string[];
  status?: string[];
  logout?: string[];
  ui?: ManagedCliAuthUi;
  /** Where to open extracted login URL. Default: embedded. */
  openIn?: ManagedCliAuthOpenIn;
  /** RegExp source(s) to extract auth URL from CLI stdout/stderr. */
  loginUrlPattern?: string | string[];
  /** Prefer over exit code when matching auth.status output. */
  loggedInPattern?: string;
  loggedOutPattern?: string;
  /** Mid-run error text that should trigger re-login. */
  authExpiredPattern?: string;
  /** Prepend noop open/xdg-open on PATH so CLI does not launch system browser. */
  blockSystemOpen?: boolean;
  /**
   * @deprecated Product adapters removed; use ui=open_url + loginUrlPattern.
   */
  adapter?: string;
}

export type ConnectorDownloadSource = 'cdn' | 'gitee' | 'github';

/**
 * How the unified managed-cli installer obtains the binary.
 * Server-driven — client must not branch on connector product names.
 */
export type ManagedCliInstallStrategy =
  | 'manifest_assets'
  | 'shell_script'
  | 'release_asset';

export interface ManagedCliInstallSpec {
  /**
   * Install strategy. When omitted, inferred from other fields / legacy binary heuristics.
   * - manifest_assets: fetch installManifest, download platform asset (dws-style)
   * - shell_script: download & run unix/windows install script (qpath-style)
   * - release_asset: fetch release API, pick platform asset (glab-style)
   */
  strategy?: ManagedCliInstallStrategy;
  /** Remote manifest URL, `server://{connectorCode}/install-manifest`, or `bundled://…`. */
  manifestUrl?: string;
  /** Fallback when primary manifest fetch fails. */
  fallbackManifestUrl?: string;
  /** Download source order for CLI/skill assets (default: gitee → github). */
  sourcePriority?: ConnectorDownloadSource[];
  /** Cache TTL for remote manifest (seconds). */
  manifestCacheTtlSec?: number;
  /** shell_script: Unix install script URL. */
  unix?: string;
  /** shell_script: Windows install script URL. */
  windows?: string;
  /** Preferred install bin directory (e.g. ~/.sto/qpath-cli/bin). ~ is expanded. */
  binDir?: string;
  /**
   * release_asset: release list / latest API URL
   * (e.g. https://gitlab.com/api/v4/projects/.../releases?per_page=1).
   */
  releaseApiUrl?: string;
  /** release_asset: substring used to match platform asset name (optional). */
  assetNameHint?: string;
  postInstall?: string[][];
}

export interface ManagedCliRuntimeSpec {
  binary: string;
  install?: ManagedCliInstallSpec;
  auth?: ManagedCliAuthSpec;
  gateway?: ManagedCliGatewaySpec;
}

export type ConnectorKind = 'managed_cli' | 'managed-cli' | 'api_token';

export interface TokenAuthRuntimeSpec {
  /** Placeholder hint for the server URL field, e.g. "https://gitlab.example.com" */
  serverUrlHint?: string;
  /** Placeholder hint for the token field */
  tokenHint?: string;
  /** API path used to validate the token, e.g. "/api/v4/user" */
  validatePath?: string;
  /** Scopes the user should grant when creating the token */
  requiredScopes?: string[];
  /** Help URL for creating a personal access token */
  helpUrl?: string;
}

export type ConnectorAgentSkillScope = 'connector';
export type ConnectorAgentSkillSource = 'bundled' | 'marketplace' | 'package';

export interface ConnectorAgentSkillSpec {
  slug: string;
  scope?: ConnectorAgentSkillScope;
  source?: ConnectorAgentSkillSource;
  marketplaceSlug?: string;
  packageUrl?: string;
  minVersion?: string;
}

export interface ConnectorAgentSpec {
  readyWhen?: string;
  /** @deprecated use skill.slug */
  skillHint?: string;
  /** One-line capability summary for connector-index. */
  summary?: string;
  /** Example intents for routing (connector-index). */
  examples?: string[];
  /** Detail skill — not listed in skill plaza; lazy-loaded on connect. */
  skill?: ConnectorAgentSkillSpec;
}

export interface ConnectorDescriptor {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  kind: string;
  order: number;
  badge: string;
  minClientVersion: string;
  runtime: Record<string, unknown>;
  agent: ConnectorAgentSpec;
  /**
   * Operator-authored trial prompt (multi-line Unicode allowed). Shown as a
   * one-shot editable draft in the main chat input when the user clicks
   * “去试试” on a connected connector. Never auto-sent and never injected
   * into Agent system context. Absent when the server predates the field.
   */
  prompt?: string;
}

export interface ConnectorLocalStateItem {
  status: ConnectorStatus;
  installedVersion?: string | null;
  lastError?: string | null;
  updatedAt: number;
  /** Token-auth connectors: the server base URL provided by the user. */
  serverUrl?: string | null;
  /** Token-auth connectors: masked display of saved token (never store raw). */
  tokenMask?: string | null;
}

export interface ConnectorStateFile {
  version: 1;
  items: Record<string, ConnectorLocalStateItem>;
}

export interface ConnectorViewItem extends ConnectorDescriptor {
  localStatus: ConnectorStatus;
  lastError?: string | null;
  installedVersion?: string | null;
}

export interface ConnectorConnectProgress {
  connectorId: string;
  phase: ConnectorConnectPhase;
  message: string;
}

export interface ConnectorAllowlistEntry {
  connectorId: string;
  allowBinary: string;
  denyArgs: string[];
}

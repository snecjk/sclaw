/**
 * managed_cli runtime — install via server install.strategy; auth via runtime.auth descriptor.
 */
import { existsSync } from 'node:fs';
import type { BrowserWindow } from 'electron';

import { interpretAuthStatusWithPatterns } from '../../../shared/connectors/auth-output-match';
import { enrichManagedCliAuthSpec } from '../../../shared/connectors/enrich-auth-spec';
import { resolveManagedCliBinary, unwrapConnectorRuntime } from '../../../shared/connectors/normalize-runtime';
import { parseManagedCliAuthSpec } from '../../../shared/connectors/parse-auth-spec';
import { parseManagedCliInstallSpec } from '../../../shared/connectors/parse-install-spec';
import { resolveManagedCliAuthMode } from '../../../shared/connectors/resolve-auth-mode';
import {
  hostnameFromServerUrl as hostnameFromAuthUrl,
  substituteAuthArgv,
} from '../../../shared/connectors/substitute-auth-argv';
import { parseDwsAuthStatus } from '../adapters/dws-auth-status';
import { installConnectorArtifacts } from '../connector-artifact-install';
import { setConnectorCredential } from '../credential-store';
import {
  resolveEmbeddedAdapterId,
  probeInstalledViaAdapter,
} from '../embedded-login-registry';
import { ConnectorError, ConnectorErrorCode } from '../errors';
import { resolveBinaryAfterInstall } from '../installers/shell-script-installer';
import {
  runAuthArgv,
  runAuthLoginFromSpec,
  runAuthLogoutFromSpec,
  runAuthStatusFromSpec,
} from '../managed-cli-auth-commands';
import { runOpenUrlLogin } from '../open-url-login';
import { getConnectorLocalItem } from '../state-store';
import { getTokenAuthWriter, registerTokenAuthWriter } from '../token-auth-writers';
import {
  resolveTokenValidatePath,
  validateConnectorToken,
} from '../token-validate';
import {
  dwsAuthLogin,
  dwsAuthStatus,
  dwsCheckInstalled,
  runDws,
} from '../../utils/dws-cli';
import { invalidateDwsStatusCache } from '../../utils/dws-status-cache';
import {
  glabAuthLogin,
  glabAuthLogout,
  glabAuthStatus,
  glabCheckInstalled,
  glabVerifyAuthenticated,
  hostnameFromServerUrl,
  isGlabAuthenticated,
} from '../../utils/glab-cli';
import {
  qpathCheckInstalled,
  qpathIsAuthenticated,
  qpathLogout,
} from '../../utils/qpath-cli';
import { qpathAuthLogin } from '../../utils/qpath-login';
import type {
  KindRuntime,
  KindRuntimeConnectContext,
  KindRuntimeConnectResult,
  KindRuntimeStatusResult,
} from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveBinary(
  runtime: Record<string, unknown>,
  ctx?: KindRuntimeConnectContext,
): string {
  return resolveManagedCliBinary(unwrapConnectorRuntime(runtime), {
    connectorId: ctx?.descriptor.id,
    kind: ctx?.descriptor.kind,
    hasCredentials: Boolean(ctx?.credentials?.token && ctx?.credentials?.serverUrl),
  });
}

async function ensureManagedCliInstalled(
  ctx: KindRuntimeConnectContext,
): Promise<{ version?: string }> {
  const result = await installConnectorArtifacts({
    descriptor: ctx.descriptor,
    onProgress: (message) => ctx.onProgress?.('installing', message),
  });
  return { version: result.installedVersion ?? undefined };
}

async function ensureDwsAuthorized(
  parentWindow?: BrowserWindow | null,
  onProgress?: KindRuntimeConnectContext['onProgress'],
): Promise<void> {
  onProgress?.('authorizing', '正在打开钉钉授权…');
  const login = await dwsAuthLogin(parentWindow);
  if (!login.ok) {
    const message = login.error || '钉钉授权失败';
    if (/cancel/i.test(message)) {
      throw new ConnectorError(ConnectorErrorCode.AUTH_CANCELLED, '已取消授权');
    }
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, message);
  }
  const status = await dwsAuthStatus();
  if (!status.ok || !parseDwsAuthStatus(status.data)) {
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, '授权未完成，请重试');
  }
}

async function probeDws(): Promise<KindRuntimeStatusResult> {
  const installed = await dwsCheckInstalled();
  if (!installed.installed) {
    return { status: 'available', installedVersion: null, authenticated: false };
  }
  const auth = await dwsAuthStatus();
  const authenticated = auth.ok && parseDwsAuthStatus(auth.data);
  if (authenticated) {
    return {
      status: 'connected',
      installedVersion: installed.version ?? null,
      authenticated: true,
    };
  }
  return {
    status: 'installed',
    installedVersion: installed.version ?? null,
    authenticated: false,
  };
}

async function disconnectDws(): Promise<KindRuntimeStatusResult> {
  try {
    await runDws(['auth', 'logout'], 30_000);
  } catch {
    // ignore
  }
  try {
    invalidateDwsStatusCache();
  } catch {
    // ignore
  }
  const installed = await dwsCheckInstalled();
  return {
    status: installed.installed ? 'installed' : 'available',
    installedVersion: installed.version ?? null,
    authenticated: false,
  };
}

async function ensureGlabAuthorized(ctx: KindRuntimeConnectContext): Promise<void> {
  const credentials = ctx.credentials;
  const token = credentials?.token?.trim();
  const serverUrl = credentials?.serverUrl?.trim();
  if (!token || !serverUrl) {
    throw new ConnectorError(
      ConnectorErrorCode.AUTH_FAILED,
      '请填写 GitLab 地址与 Personal Access Token',
    );
  }
  ctx.onProgress?.('authorizing', '正在写入 glab 凭据…');
  const login = await glabAuthLogin({ serverUrl, token });
  if (!login.ok) {
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, login.error || 'glab 登录失败');
  }
  const hostname = hostnameFromServerUrl(serverUrl);
  ctx.onProgress?.('authorizing', '正在校验登录态…');
  const verified = await glabVerifyAuthenticated(hostname || undefined);
  if (!verified) {
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, 'Token 校验失败，请检查权限与地址');
  }
}

async function probeGlab(connectorId: string): Promise<KindRuntimeStatusResult> {
  const installed = await glabCheckInstalled();
  if (!installed.installed) {
    return { status: 'available', installedVersion: null, authenticated: false };
  }
  const local = getConnectorLocalItem(connectorId);
  const hostname = local?.serverUrl ? hostnameFromServerUrl(local.serverUrl) : undefined;
  const status = await glabAuthStatus(hostname);
  const authenticated = isGlabAuthenticated(status, hostname);
  if (authenticated) {
    return {
      status: 'connected',
      installedVersion: installed.version ?? null,
      authenticated: true,
    };
  }
  return {
    status: 'installed',
    installedVersion: installed.version ?? null,
    authenticated: false,
  };
}

async function disconnectGlab(connectorId: string): Promise<KindRuntimeStatusResult> {
  const local = getConnectorLocalItem(connectorId);
  const hostname = local?.serverUrl ? hostnameFromServerUrl(local.serverUrl) : undefined;
  try {
    await glabAuthLogout(hostname);
  } catch {
    // ignore
  }
  const installed = await glabCheckInstalled();
  return {
    status: installed.installed ? 'installed' : 'available',
    installedVersion: installed.version ?? null,
    authenticated: false,
  };
}

async function ensureQpathAuthorized(
  parentWindow?: BrowserWindow | null,
  onProgress?: KindRuntimeConnectContext['onProgress'],
): Promise<void> {
  if (await qpathIsAuthenticated()) {
    return;
  }
  onProgress?.('authorizing', '请在弹窗中完成 QPath 钉钉登录…');
  const login = await qpathAuthLogin(parentWindow);
  if (!login.ok) {
    const message = login.error || 'QPath 授权失败';
    if (/cancel/i.test(message)) {
      throw new ConnectorError(ConnectorErrorCode.AUTH_CANCELLED, '已取消授权');
    }
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, message);
  }
  if (!(await qpathIsAuthenticated())) {
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, '授权未完成，请重试');
  }
}

async function probeQpath(): Promise<KindRuntimeStatusResult> {
  const installed = await qpathCheckInstalled();
  if (!installed.installed) {
    return { status: 'available', installedVersion: null, authenticated: false };
  }
  const authenticated = await qpathIsAuthenticated();
  if (authenticated) {
    return {
      status: 'connected',
      installedVersion: installed.version ?? null,
      authenticated: true,
    };
  }
  return {
    status: 'installed',
    installedVersion: installed.version ?? null,
    authenticated: false,
  };
}

async function disconnectQpath(): Promise<KindRuntimeStatusResult> {
  try {
    await qpathLogout();
  } catch {
    // ignore
  }
  const installed = await qpathCheckInstalled();
  return {
    status: installed.installed ? 'installed' : 'available',
    installedVersion: installed.version ?? null,
    authenticated: false,
  };
}

function resolveInstallBinDir(runtime: Record<string, unknown>): string | undefined {
  return parseManagedCliInstallSpec(runtime).binDir;
}

function probeInstalledBinary(
  binary: string,
  binDir?: string,
): { installed: boolean; path?: string | null; version?: string | null } {
  const path = resolveBinaryAfterInstall({ binary, binDir });
  if (path && existsSync(path)) {
    return { installed: true, path, version: null };
  }
  return { installed: false, path: null, version: null };
}

/**
 * Prefer auth.status / auth.logout argv from server descriptor.
 * Falls back to legacy product helpers when argv is missing.
 */
async function disconnectWithAuthSpec(
  ctx: KindRuntimeConnectContext,
): Promise<KindRuntimeStatusResult | null> {
  const runtime = asRecord(ctx.descriptor.runtime);
  const binary = resolveBinary(runtime, ctx);
  const auth = parseManagedCliAuthSpec(runtime);
  const binDir = resolveInstallBinDir(runtime);
  if (!auth?.logout?.length) return null;

  try {
    await runAuthLogoutFromSpec({ auth, binary, binDir });
  } catch {
    // ignore
  }
  if (binary === 'dws') {
    try {
      invalidateDwsStatusCache();
    } catch {
      // ignore
    }
  }
  const installed = probeInstalledBinary(binary, binDir);
  return {
    status: installed.installed ? 'installed' : 'available',
    installedVersion: installed.version ?? null,
    authenticated: false,
  };
}

async function probeWithAuthSpec(
  ctx: KindRuntimeConnectContext,
): Promise<KindRuntimeStatusResult | null> {
  const runtime = asRecord(ctx.descriptor.runtime);
  const binary = resolveBinary(runtime, ctx);
  const auth = parseManagedCliAuthSpec(runtime);
  const binDir = resolveInstallBinDir(runtime);
  if (!auth?.status?.length) return null;

  const adapterId = resolveEmbeddedAdapterId({
    binary,
    adapter: auth.adapter,
  });

  let installed = probeInstalledBinary(binary, binDir);
  if (!installed.installed) {
    const viaAdapter = await probeInstalledViaAdapter(adapterId);
    if (viaAdapter?.status === 'available') {
      return viaAdapter;
    }
    if (viaAdapter?.status === 'installed') {
      installed = {
        installed: true,
        path: null,
        version: viaAdapter.installedVersion ?? null,
      };
    } else if (binary === 'dws') {
      return probeDws();
    } else if (binary === 'glab') {
      return probeGlab(ctx.descriptor.id);
    } else {
      return { status: 'available', installedVersion: null, authenticated: false };
    }
  }

  const status = await runAuthStatusFromSpec({ auth, binary, binDir });
  const authenticated = interpretAuthStatusWithPatterns({
    stdout: status.stdout,
    stderr: status.stderr,
    exitCode: status.exitCode,
    loggedInPattern: auth.loggedInPattern,
    loggedOutPattern: auth.loggedOutPattern,
  });
  if (authenticated) {
    return {
      status: 'connected',
      installedVersion: installed.version ?? null,
      authenticated: true,
    };
  }
  return {
    status: 'installed',
    installedVersion: installed.version ?? null,
    authenticated: false,
  };
}

/**
 * Authorize using runtime.auth descriptor when possible.
 * Embedded login UIs remain behind auth.ui=embedded (or legacy binary defaults).
 */
async function ensureLoginViaArgv(ctx: KindRuntimeConnectContext): Promise<void> {
  const runtime = asRecord(ctx.descriptor.runtime);
  const binary = resolveBinary(runtime, ctx);
  const auth = parseManagedCliAuthSpec(runtime);
  const binDir = resolveInstallBinDir(runtime);
  if (!auth?.login?.length) {
    throw new ConnectorError(
      ConnectorErrorCode.AUTH_FAILED,
      '缺少 auth.login，无法完成 CLI 登录',
    );
  }

  ctx.onProgress?.('authorizing', auth.hint || '正在执行 CLI 登录…');
  const login = await runAuthLoginFromSpec({ auth, binary, binDir });
  if (!login.ok) {
    const message = login.error || login.stderr || 'CLI 登录失败';
    if (/cancel/i.test(message)) {
      throw new ConnectorError(ConnectorErrorCode.AUTH_CANCELLED, '已取消授权');
    }
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, message);
  }

  if (auth.status?.length) {
    ctx.onProgress?.('authorizing', '正在校验登录态…');
    const status = await runAuthStatusFromSpec({ auth, binary, binDir });
    const authenticated = interpretAuthStatusWithPatterns({
      stdout: status.stdout,
      stderr: status.stderr,
      exitCode: status.exitCode,
      loggedInPattern: auth.loggedInPattern,
      loggedOutPattern: auth.loggedOutPattern,
    });
    if (!authenticated) {
      throw new ConnectorError(
        ConnectorErrorCode.AUTH_FAILED,
        status.error || status.stderr || '授权未完成，请重试',
      );
    }
  }
}

/**
 * open_url: spawn login, extract URL via loginUrlPattern, open embedded/system.
 */
async function ensureOpenUrlAuthorized(ctx: KindRuntimeConnectContext): Promise<void> {
  const runtime = asRecord(ctx.descriptor.runtime);
  const binary = resolveBinary(runtime, ctx);
  const auth = enrichManagedCliAuthSpec(parseManagedCliAuthSpec(runtime), binary);
  const binDir = resolveInstallBinDir(runtime);
  if (!auth?.login?.length) {
    throw new ConnectorError(
      ConnectorErrorCode.AUTH_FAILED,
      '缺少 auth.login，无法完成 CLI 登录',
    );
  }

  ctx.onProgress?.('authorizing', auth.hint || '请在授权页完成登录…');
  const login = await runOpenUrlLogin({
    auth,
    binary,
    binDir,
    parentWindow: ctx.parentWindow,
  });
  if (!login.ok) {
    const message = login.error || 'CLI 授权失败';
    if (/cancel/i.test(message)) {
      throw new ConnectorError(ConnectorErrorCode.AUTH_CANCELLED, '已取消授权');
    }
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, message);
  }
}

/**
 * api_token for managed_cli:
 * 1) auth.login argv with {{token}}/{{hostname}}/{{serverUrl}}
 * 2) registered token writer (glab)
 * 3) HTTP validatePath + credential store
 */
async function ensureApiTokenAuthorized(ctx: KindRuntimeConnectContext): Promise<void> {
  const runtime = asRecord(ctx.descriptor.runtime);
  const binary = resolveBinary(runtime, ctx);
  const auth = parseManagedCliAuthSpec(runtime);
  const binDir = resolveInstallBinDir(runtime);
  const credentials = ctx.credentials;
  const token = credentials?.token?.trim();
  const serverUrl = credentials?.serverUrl?.trim();
  if (!token || !serverUrl) {
    throw new ConnectorError(
      ConnectorErrorCode.AUTH_FAILED,
      '请填写服务器地址与 Personal Access Token',
    );
  }

  if (auth?.login?.length) {
    ctx.onProgress?.('authorizing', auth.hint || '正在写入 CLI 凭据…');
    const argv = substituteAuthArgv(auth.login, {
      token,
      serverUrl,
      hostname: hostnameFromAuthUrl(serverUrl),
    });
    const login = await runAuthArgv({
      argv,
      binary,
      binDir,
      timeoutMs: 60_000,
    });
    if (!login.ok) {
      throw new ConnectorError(
        ConnectorErrorCode.AUTH_FAILED,
        login.error || login.stderr || 'Token 登录失败',
      );
    }
    if (auth.status?.length) {
      ctx.onProgress?.('authorizing', '正在校验登录态…');
      const statusArgv = substituteAuthArgv(auth.status, {
        token,
        serverUrl,
        hostname: hostnameFromAuthUrl(serverUrl),
      });
      const status = await runAuthArgv({ argv: statusArgv, binary, binDir });
      if (!status.ok) {
        throw new ConnectorError(
          ConnectorErrorCode.AUTH_FAILED,
          status.error || status.stderr || 'Token 校验失败',
        );
      }
    }
    return;
  }

  const writer = getTokenAuthWriter(binary);
  if (writer) {
    await writer(ctx);
    return;
  }

  ctx.onProgress?.('authorizing', '正在校验 Token…');
  await validateConnectorToken({
    serverUrl: serverUrl.replace(/\/+$/, ''),
    token,
    validatePath: resolveTokenValidatePath(runtime),
  });
  setConnectorCredential(ctx.descriptor.id, serverUrl.replace(/\/+$/, ''), token);
}

async function ensureAuthorized(ctx: KindRuntimeConnectContext): Promise<void> {
  const runtime = asRecord(ctx.descriptor.runtime);
  const binary = resolveBinary(runtime, ctx);
  const auth = parseManagedCliAuthSpec(runtime);
  const decision = resolveManagedCliAuthMode({
    binary,
    auth,
    rawAuthType: text(asRecord(runtime.auth).type),
  });

  if (decision.mode === 'api_token') {
    await ensureApiTokenAuthorized(ctx);
    return;
  }
  if (decision.mode === 'open_url') {
    await ensureOpenUrlAuthorized(ctx);
    return;
  }
  if (decision.mode === 'login_argv') {
    await ensureLoginViaArgv(ctx);
    return;
  }
  if (decision.mode === 'legacy' && decision.binary === 'dws') {
    await ensureDwsAuthorized(ctx.parentWindow, ctx.onProgress);
    return;
  }
  if (decision.mode === 'legacy' && decision.binary === 'qpath') {
    await ensureQpathAuthorized(ctx.parentWindow, ctx.onProgress);
    return;
  }
  if (decision.mode === 'legacy' && decision.binary === 'glab') {
    await ensureApiTokenAuthorized(ctx);
    return;
  }

  throw new ConnectorError(
    ConnectorErrorCode.UNKNOWN_KIND,
    `暂不支持鉴权 binary=${binary || '(empty)'}，请在服务端配置 auth.ui=open_url + loginUrlPattern 或 auth.login，或升级客户端`,
  );
}

export class ManagedCliRuntime implements KindRuntime {
  readonly kind = 'managed_cli';

  async connect(ctx: KindRuntimeConnectContext): Promise<KindRuntimeConnectResult> {
    try {
      // Install is strategy-driven (manifest_assets / shell_script / release_asset).
      const { version } = await ensureManagedCliInstalled(ctx);
      await ensureAuthorized(ctx);
      return { status: 'connected', installedVersion: version ?? null };
    } catch (error) {
      if (error instanceof ConnectorError && error.code === ConnectorErrorCode.AUTH_CANCELLED) {
        throw error;
      }
      if (error instanceof ConnectorError) {
        return { status: 'error', error: error.message };
      }
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(ctx: KindRuntimeConnectContext): Promise<KindRuntimeStatusResult> {
    const viaSpec = await disconnectWithAuthSpec(ctx);
    if (viaSpec) return viaSpec;

    const runtime = asRecord(ctx.descriptor.runtime);
    const binary = resolveBinary(runtime, ctx);
    const auth = parseManagedCliAuthSpec(runtime);
    const adapterId = resolveEmbeddedAdapterId({ binary, adapter: auth?.adapter });
    // Prefer adapter logout via auth.logout; only legacy product helpers remain here.
    if (binary === 'dws') return disconnectDws();
    if (binary === 'glab') return disconnectGlab(ctx.descriptor.id);
    if (adapterId === 'qpath' || binary === 'qpath') return disconnectQpath();
    return { status: 'available', authenticated: false };
  }

  async probe(ctx: KindRuntimeConnectContext): Promise<KindRuntimeStatusResult> {
    const viaSpec = await probeWithAuthSpec(ctx);
    if (viaSpec) return viaSpec;

    const runtime = asRecord(ctx.descriptor.runtime);
    const binary = resolveBinary(runtime, ctx);
    const auth = parseManagedCliAuthSpec(runtime);
    const adapterId = resolveEmbeddedAdapterId({ binary, adapter: auth?.adapter });
    if (binary === 'dws') return probeDws();
    if (binary === 'glab') return probeGlab(ctx.descriptor.id);
    if (adapterId === 'qpath' || binary === 'qpath') return probeQpath();
    return { status: 'available', authenticated: false };
  }
}

export const managedCliRuntime = new ManagedCliRuntime();

registerTokenAuthWriter('glab', ensureGlabAuthorized);

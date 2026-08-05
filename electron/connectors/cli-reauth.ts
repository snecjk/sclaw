/**
 * Generic mid-run CLI re-auth driven by auth.authExpiredPattern + open_url engine.
 */
import type { BrowserWindow } from 'electron';

import { enrichManagedCliAuthSpec } from '../../shared/connectors/enrich-auth-spec';
import { matchAuthExpired } from '../../shared/connectors/auth-output-match';
import { parseManagedCliAuthSpec } from '../../shared/connectors/parse-auth-spec';
import { parseManagedCliInstallSpec } from '../../shared/connectors/parse-install-spec';
import { resolveManagedCliAuthMode } from '../../shared/connectors/resolve-auth-mode';
import type { ManagedCliAuthSpec } from '../../shared/connectors/types';
import { logger } from '../utils/logger';
import { probeOpenUrlAuthenticated, runOpenUrlLogin } from './open-url-login';

let inflightByKey = new Map<string, Promise<boolean>>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveBinary(runtime: Record<string, unknown>): string {
  return text(runtime.binary) || text(asRecord(runtime.install).binary) || '';
}

export async function ensureCliReauthIfNeeded(options: {
  errorText: string;
  auth: ManagedCliAuthSpec;
  binary: string;
  binDir?: string;
  parentWindow?: BrowserWindow | null;
  connectorId?: string;
  onAuthenticated?: () => Promise<void>;
}): Promise<{ attempted: boolean; authenticated: boolean }> {
  const auth = enrichManagedCliAuthSpec(options.auth, options.binary) ?? options.auth;
  const { binary, errorText } = options;
  if (!matchAuthExpired(errorText, auth.authExpiredPattern)) {
    const authenticated = auth.status?.length
      ? await probeOpenUrlAuthenticated({
          auth,
          binary,
          binDir: options.binDir,
        })
      : false;
    return { attempted: false, authenticated };
  }

  const key = options.connectorId || binary || 'default';
  let inflight = inflightByKey.get(key);
  if (!inflight) {
    inflight = (async () => {
      if (auth.status?.length) {
        const already = await probeOpenUrlAuthenticated({
          auth,
          binary,
          binDir: options.binDir,
        });
        if (already) return true;
      }

      const mode = resolveManagedCliAuthMode({ binary, auth });
      if (mode.mode !== 'open_url') {
        logger.warn(`[cli-reauth] connector=${key} auth mode is not open_url`);
        return false;
      }

      const login = await runOpenUrlLogin({
        auth,
        binary,
        binDir: options.binDir,
        parentWindow: options.parentWindow,
      });
      if (!login.ok) {
        logger.warn('[cli-reauth] login failed:', login.error);
        return false;
      }

      const ok = auth.status?.length
        ? await probeOpenUrlAuthenticated({
            auth,
            binary,
            binDir: options.binDir,
          })
        : true;
      if (ok && options.onAuthenticated) {
        try {
          await options.onAuthenticated();
        } catch (error) {
          logger.warn(
            '[cli-reauth] onAuthenticated failed:',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      return ok;
    })().finally(() => {
      inflightByKey.delete(key);
    });
    inflightByKey.set(key, inflight);
  }

  const authenticated = await inflight;
  return { attempted: true, authenticated };
}

/** Resolve auth from a connector runtime record and reauth if needed. */
export async function ensureConnectorReauthFromRuntime(options: {
  errorText: string;
  runtime: Record<string, unknown>;
  parentWindow?: BrowserWindow | null;
  connectorId?: string;
  onAuthenticated?: () => Promise<void>;
}): Promise<{ attempted: boolean; authenticated: boolean }> {
  const binary = resolveBinary(options.runtime);
  const auth = enrichManagedCliAuthSpec(parseManagedCliAuthSpec(options.runtime), binary);
  if (!auth) {
    return { attempted: false, authenticated: false };
  }
  const binDir = parseManagedCliInstallSpec(options.runtime).binDir;
  return ensureCliReauthIfNeeded({
    errorText: options.errorText,
    auth,
    binary,
    binDir,
    parentWindow: options.parentWindow,
    connectorId: options.connectorId,
    onAuthenticated: options.onAuthenticated,
  });
}

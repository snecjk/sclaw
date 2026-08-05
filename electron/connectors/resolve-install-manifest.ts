/**
 * Resolve connector install manifest from backend install spec (HTTPS or bundled://).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

import type { ManagedCliInstallSpec } from '../../shared/connectors/types';
import { memoryCenterFetchForSession } from '../services/sto-memory-api-fetch';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { logger } from '../utils/logger';

export interface ConnectorInstallManifestLike {
  /** Preferred generic version field (aliases dwsVersion). */
  version?: string;
  dwsVersion?: string;
  skillMode?: string;
  skillsRevision?: string;
  platforms?: Record<string, unknown>;
  skillsZip?: Record<string, unknown> | null;
  sources?: Record<string, unknown>;
  [key: string]: unknown;
}

const DEFAULT_BUNDLED_MANIFEST = 'bundled://resources/dws/manifest.json';

function connectorsRoot(): string {
  const override = process.env.STOCLAW_CONNECTORS_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.stoclaw', 'connectors');
}

function manifestCachePath(connectorId: string): string {
  const safeId = connectorId.replace(/[^\w.-]+/g, '_') || 'default';
  return join(connectorsRoot(), 'manifests', `${safeId}.json`);
}

function resolveBundledManifestPath(relativePath: string): string {
  const normalized = relativePath.replace(/^bundled:\/\//i, '').replace(/^\/+/, '');
  try {
    if (app.isPackaged) {
      return join(process.resourcesPath, normalized);
    }
  } catch {
    // Non-Electron test/runtime — fall through to cwd.
  }
  return join(process.cwd(), normalized);
}

function readBundledManifestAt(url: string): ConnectorInstallManifestLike | null {
  if (!url.toLowerCase().startsWith('bundled://')) return null;
  const path = resolveBundledManifestPath(url);
  if (!existsSync(path)) {
    logger.warn('[connectors] bundled manifest not found:', path);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ConnectorInstallManifestLike;
  } catch (error) {
    logger.warn('[connectors] failed to read bundled manifest:', error);
    return null;
  }
}

function parseServerManifestConnectorCode(url: string): string | null {
  const match = url.trim().match(/^server:\/\/([^/]+)(?:\/install-manifest)?\/?$/i);
  return match?.[1]?.trim() || null;
}

function normalizeManifestVersionFields(
  manifest: ConnectorInstallManifestLike,
): ConnectorInstallManifestLike {
  if (!manifest.dwsVersion && typeof manifest.version === 'string' && manifest.version.trim()) {
    manifest.dwsVersion = manifest.version.trim();
  }
  if (!manifest.version && typeof manifest.dwsVersion === 'string' && manifest.dwsVersion.trim()) {
    manifest.version = manifest.dwsVersion.trim();
  }
  return manifest;
}

function unwrapManifestEnvelope(value: unknown): ConnectorInstallManifestLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('manifest 响应格式无效');
  }
  const record = value as Record<string, unknown>;
  if (record.success === true && record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    return normalizeManifestVersionFields(record.data as ConnectorInstallManifestLike);
  }
  return normalizeManifestVersionFields(record as ConnectorInstallManifestLike);
}

async function fetchServerConnectorManifest(connectorCode: string): Promise<ConnectorInstallManifestLike> {
  const path = `/agent/v1/app-plaza/connectors/${encodeURIComponent(connectorCode)}/install-manifest`;
  const value = await memoryCenterFetchForSession(path, { method: 'POST' });
  const manifest = unwrapManifestEnvelope(value);
  if (!manifest.dwsVersion && !manifest.platforms) {
    throw new Error(`服务端 manifest 缺少必要字段: ${connectorCode}`);
  }
  return manifest;
}

function readCachedRemoteManifest(
  connectorId: string,
  ttlSec: number,
): ConnectorInstallManifestLike | null {
  const path = manifestCachePath(connectorId);
  if (!existsSync(path)) return null;
  try {
    const ageMs = Date.now() - statSync(path).mtimeMs;
    if (ageMs > ttlSec * 1000) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as ConnectorInstallManifestLike;
  } catch {
    return null;
  }
}

function writeCachedRemoteManifest(connectorId: string, manifest: ConnectorInstallManifestLike): void {
  const path = manifestCachePath(connectorId);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

async function fetchRemoteManifest(url: string): Promise<ConnectorInstallManifestLike> {
  const response = await proxyAwareFetch(url, { timeoutMs: 120_000 });
  if (!response.ok) {
    throw new Error(`manifest HTTP ${response.status}: ${url}`);
  }
  const body = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`manifest 格式无效: ${url}`);
  }
  return body as ConnectorInstallManifestLike;
}

async function resolveSingleManifestUrl(
  url: string,
  connectorId: string,
  ttlSec: number,
): Promise<ConnectorInstallManifestLike | null> {
  if (url.toLowerCase().startsWith('bundled://')) {
    return readBundledManifestAt(url);
  }

  const serverCode = parseServerManifestConnectorCode(url);
  if (serverCode) {
    const cacheKey = connectorId || serverCode;
    const cached = readCachedRemoteManifest(cacheKey, ttlSec);
    if (cached) return cached;
    const manifest = await fetchServerConnectorManifest(serverCode);
    writeCachedRemoteManifest(cacheKey, manifest);
    return manifest;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    logger.warn('[connectors] unsupported manifest URL scheme:', url);
    return null;
  }
  const cached = readCachedRemoteManifest(connectorId, ttlSec);
  if (cached) return cached;
  const manifest = await fetchRemoteManifest(url);
  writeCachedRemoteManifest(connectorId, manifest);
  return manifest;
}

/**
 * Resolve install manifest using backend install spec.
 * Order: manifestUrl → fallbackManifestUrl → bundled default.
 */
export async function resolveConnectorInstallManifest(options: {
  installSpec?: ManagedCliInstallSpec;
  connectorId?: string;
}): Promise<ConnectorInstallManifestLike | null> {
  const installSpec = options.installSpec ?? {};
  const connectorId = options.connectorId?.trim() || 'default';
  const ttlSec = installSpec.manifestCacheTtlSec ?? 3600;
  const candidates = [
    installSpec.manifestUrl,
    installSpec.fallbackManifestUrl,
    DEFAULT_BUNDLED_MANIFEST,
  ].filter((item): item is string => Boolean(item?.trim()));

  const seen = new Set<string>();
  for (const url of candidates) {
    const key = url.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const manifest = await resolveSingleManifestUrl(key, connectorId, ttlSec);
      if (manifest) return manifest;
    } catch (error) {
      logger.warn(
        `[connectors] manifest fetch failed (${key}):`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return null;
}

export { parseServerManifestConnectorCode };

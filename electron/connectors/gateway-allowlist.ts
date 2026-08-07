/**
 * Gateway dynamic allowlist — rebuild from connected connectors' runtime.gateway.
 * Persists to ~/.stoclaw/connectors/gateway-allowlist.json for Gateway preload.
 * Also persists catalog gated binaries for bash-gate (not only connected ones).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  collectGatedBinariesFromCatalog,
  resolveGatedBinaries,
} from '../../shared/connectors/collect-gated-binaries';
import type {
  ConnectorAllowlistEntry,
  ConnectorDescriptor,
} from '../../shared/connectors/types';
import { resolveEffectiveConnector } from '../../shared/connectors/resolve-effective-runtime';
import { listConnectedConnectorIds } from './state-store';

let cachedEntries: ConnectorAllowlistEntry[] = [];
let cachedGatedBinaries: string[] = [];
let catalogById: Map<string, ConnectorDescriptor> = new Map();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function connectorsDir(): string {
  return process.env.STOCLAW_CONNECTORS_DIR?.trim()
    || join(homedir(), '.stoclaw', 'connectors');
}

function allowlistPath(): string {
  return join(connectorsDir(), 'gateway-allowlist.json');
}

function gatedBinariesPath(): string {
  return join(connectorsDir(), 'gateway-gated-binaries.json');
}

function ensureConnectorsDir(): void {
  const dir = connectorsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function persistAllowlist(entries: ConnectorAllowlistEntry[]): void {
  ensureConnectorsDir();
  writeFileSync(
    allowlistPath(),
    `${JSON.stringify({ version: 1, updatedAt: Date.now(), entries }, null, 2)}\n`,
    'utf8',
  );
}

function persistGatedBinaries(binaries: string[]): void {
  ensureConnectorsDir();
  writeFileSync(
    gatedBinariesPath(),
    `${JSON.stringify({ version: 1, updatedAt: Date.now(), binaries }, null, 2)}\n`,
    'utf8',
  );
}

export function setConnectorCatalog(descriptors: ConnectorDescriptor[]): void {
  catalogById = new Map(descriptors.map((item) => [item.id, item]));
  const effectiveDescriptors = descriptors.map(
    (item) => resolveEffectiveConnector(item).descriptor,
  );
  cachedGatedBinaries = resolveGatedBinaries(
    collectGatedBinariesFromCatalog(effectiveDescriptors),
  );
  try {
    persistGatedBinaries(cachedGatedBinaries);
  } catch {
    // best-effort for preload / plugins
  }
  rebuildGatewayAllowlist();
}

export function getCatalogGatedBinaries(): string[] {
  return cachedGatedBinaries.slice();
}

export function rebuildGatewayAllowlist(): ConnectorAllowlistEntry[] {
  const connected = new Set(listConnectedConnectorIds());
  const entries: ConnectorAllowlistEntry[] = [];

  for (const id of connected) {
    const raw = catalogById.get(id);
    if (!raw) continue;
    const descriptor = resolveEffectiveConnector(raw).descriptor;
    const runtime = asRecord(descriptor.runtime);
    const gateway = asRecord(runtime.gateway);
    const denyArgs = Array.isArray(gateway.denyArgs)
      ? gateway.denyArgs.filter((item): item is string => typeof item === 'string')
      : ['upgrade', 'install'];

    const binaries = new Set<string>();
    const primary = text(gateway.allowBinary) || text(runtime.binary);
    if (primary) binaries.add(primary);
    if (Array.isArray(gateway.allowBinaries)) {
      for (const item of gateway.allowBinaries) {
        const name = text(item);
        if (name) binaries.add(name);
      }
    }

    for (const allowBinary of binaries) {
      entries.push({ connectorId: id, allowBinary, denyArgs });
    }
  }

  cachedEntries = entries;
  try {
    persistAllowlist(entries);
  } catch {
    // allowlist file is best-effort for preload; in-memory still used by Main
  }
  return entries;
}

export function getGatewayAllowlist(): ConnectorAllowlistEntry[] {
  return cachedEntries.slice();
}

export function isBinaryAllowedByConnectors(binary: string): boolean {
  const name = binary.trim().toLowerCase().replace(/\.exe$/i, '');
  return cachedEntries.some((entry) => entry.allowBinary.toLowerCase() === name);
}

export function getDenyArgsForBinary(binary: string): string[] {
  const name = binary.trim().toLowerCase().replace(/\.exe$/i, '');
  const matched = cachedEntries.filter((entry) => entry.allowBinary.toLowerCase() === name);
  const deny = new Set<string>();
  for (const entry of matched) {
    for (const arg of entry.denyArgs) deny.add(arg.toLowerCase());
  }
  return [...deny];
}

export function refreshAllowlistFromState(): ConnectorAllowlistEntry[] {
  return rebuildGatewayAllowlist();
}

export function getGatewayAllowlistFilePath(): string {
  return allowlistPath();
}

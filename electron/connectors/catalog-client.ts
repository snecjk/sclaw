/**
 * Fetch connector catalog from memory-center app-plaza.
 */
import {
  memoryCenterFetchForSession,
  StoMemoryApiError,
} from '../services/sto-memory-api-fetch';
import type { ConnectorAgentSkillSpec, ConnectorDescriptor } from '../../shared/connectors/types';
import { normalizeConnectorRuntimeForClient } from '../../shared/connectors/normalize-runtime';

interface Envelope<T> {
  success: boolean;
  errCode?: string;
  errMessage?: string;
  data: T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Trial prompt from the catalog: multi-line Unicode must be preserved intact
 * (only outer whitespace is trimmed, matching the server contract). Returns
 * `undefined` for older servers that omit the field — description/summary
 * must never masquerade as the prompt.
 */
function promptText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseAgentSkill(raw: unknown): ConnectorAgentSkillSpec | undefined {
  const record = asRecord(raw);
  const slug = text(record.slug) || text(record.marketplaceSlug);
  if (!slug) return undefined;
  return {
    slug,
    scope: (text(record.scope) || 'connector') as ConnectorAgentSkillSpec['scope'],
    source: (text(record.source) || 'bundled') as ConnectorAgentSkillSpec['source'],
    marketplaceSlug: text(record.marketplaceSlug) || undefined,
    packageUrl: text(record.packageUrl) || undefined,
    minVersion: text(record.minVersion) || undefined,
  };
}

function assertEnvelope<T>(value: unknown, label: string): Envelope<T> {
  if (!value || typeof value !== 'object') {
    throw new StoMemoryApiError(`${label}响应格式异常`, 502);
  }
  const envelope = value as Envelope<T>;
  if (envelope.success !== true || envelope.data == null) {
    throw new StoMemoryApiError(envelope.errMessage || `${label}请求失败`, 502);
  }
  return envelope;
}

export function adaptConnectorDescriptor(value: unknown): ConnectorDescriptor | null {
  const raw = asRecord(value);
  const id = text(raw.id);
  const name = text(raw.name);
  const kind = text(raw.kind);
  if (!id || !name || !kind) return null;
  const agentRaw = asRecord(raw.agent);
  const runtimeRaw =
    raw.runtime && typeof raw.runtime === 'object'
      ? (raw.runtime as Record<string, unknown>)
      : {};
  const runtime = normalizeConnectorRuntimeForClient(runtimeRaw, { connectorId: id, kind });
  return {
    id,
    name,
    description: text(raw.description),
    iconUrl: text(raw.iconUrl),
    kind,
    order: number(raw.order),
    badge: text(raw.badge),
    minClientVersion: text(raw.minClientVersion),
    runtime,
    prompt: promptText(raw.prompt),
    agent: {
      readyWhen: text(agentRaw.readyWhen) || undefined,
      skillHint: text(agentRaw.skillHint) || undefined,
      summary: text(agentRaw.summary) || undefined,
      examples: Array.isArray(agentRaw.examples)
        ? agentRaw.examples.filter((item): item is string => typeof item === 'string')
        : undefined,
      skill: parseAgentSkill(agentRaw.skill),
    },
  };
}

export async function fetchConnectorCatalog(): Promise<ConnectorDescriptor[]> {
  const value = await memoryCenterFetchForSession('/agent/v1/connectors', {
    method: 'POST',
  });
  const data = assertEnvelope<unknown[]>(value, '连接器目录').data;
  return data
    .map(adaptConnectorDescriptor)
    .filter((item): item is ConnectorDescriptor => item !== null)
    .sort((a, b) => a.order - b.order);
}

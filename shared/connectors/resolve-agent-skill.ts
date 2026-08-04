import type { ConnectorAgentSkillSpec, ConnectorAgentSpec, ConnectorDescriptor } from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseSkill(raw: unknown): ConnectorAgentSkillSpec | null {
  const record = asRecord(raw);
  const slug = text(record.slug) || text(record.marketplaceSlug);
  if (!slug) return null;
  return {
    slug,
    scope: (text(record.scope) || 'connector') as ConnectorAgentSkillSpec['scope'],
    source: (text(record.source) || 'bundled') as ConnectorAgentSkillSpec['source'],
    marketplaceSlug: text(record.marketplaceSlug) || undefined,
    packageUrl: text(record.packageUrl) || undefined,
    minVersion: text(record.minVersion) || undefined,
  };
}

/** Resolve detail skill spec from descriptor agent block (supports legacy skillHint). */
export function resolveConnectorAgentSkill(
  agent: ConnectorAgentSpec | undefined,
): ConnectorAgentSkillSpec | null {
  if (!agent) return null;
  const fromSkill = parseSkill(agent.skill);
  if (fromSkill) return fromSkill;
  const hint = text(agent.skillHint);
  if (!hint) return null;
  return { slug: hint, scope: 'connector', source: 'bundled' };
}

export function resolveConnectorAgentSkillFromDescriptor(
  descriptor: ConnectorDescriptor,
): ConnectorAgentSkillSpec | null {
  return resolveConnectorAgentSkill(descriptor.agent);
}

export function connectorSkillSlug(descriptor: ConnectorDescriptor): string | null {
  return resolveConnectorAgentSkillFromDescriptor(descriptor)?.slug ?? null;
}

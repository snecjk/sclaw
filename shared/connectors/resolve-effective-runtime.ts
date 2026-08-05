/**
 * Single resolution path for connector kind/runtime used by connect/disconnect/probe/allowlist.
 * Catalog may still label GitLab as `api_token`; client treats it as managed_cli + glab.
 */
import {
  resolveManagedCliBinary,
  unwrapConnectorRuntime,
} from './normalize-runtime';
import type { ConnectorDescriptor } from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface EffectiveConnectorResolution {
  /** Runtime registry key to use (e.g. managed_cli). */
  kind: string;
  /** Descriptor passed into the runtime (may rewrite kind/runtime for glab). */
  descriptor: ConnectorDescriptor;
  /** Resolved managed CLI binary when applicable (dws/glab/…). */
  binary: string;
  /** True when this connector is handled as GitLab glab. */
  isGlab: boolean;
}

function looksLikeGitlabConnector(
  descriptor: ConnectorDescriptor,
  runtime: Record<string, unknown>,
): boolean {
  const id = text(descriptor.id).toLowerCase();
  const kind = text(descriptor.kind).toLowerCase();
  if (id.includes('gitlab')) return true;
  if (kind === 'api_token' && id.includes('git')) return true;

  const binary = text(runtime.binary).toLowerCase().replace(/\.exe$/i, '');
  if (binary === 'glab') return true;

  const auth = asRecord(runtime.auth);
  const hint = `${text(runtime.serverUrlHint)} ${text(auth.hint)} ${text(auth.type)}`.toLowerCase();
  if (hint.includes('gitlab')) return true;
  return false;
}

function buildGlabDescriptor(descriptor: ConnectorDescriptor): ConnectorDescriptor {
  const runtime = unwrapConnectorRuntime(asRecord(descriptor.runtime));
  const auth = asRecord(runtime.auth);
  const gateway = asRecord(runtime.gateway);
  const extras = Array.isArray(gateway.allowBinaries)
    ? gateway.allowBinaries.filter((item): item is string => typeof item === 'string')
    : [];
  if (!extras.map((item) => item.toLowerCase()).includes('git')) {
    extras.push('git');
  }

  return {
    ...descriptor,
    kind: 'managed_cli',
    runtime: {
      ...runtime,
      binary: 'glab',
      auth: {
        ...auth,
        type: text(auth.type) || 'api_token',
      },
      gateway: {
        ...gateway,
        allowBinary: text(gateway.allowBinary) || 'glab',
        allowBinaries: extras,
        denyArgs: Array.isArray(gateway.denyArgs) ? gateway.denyArgs : ['upgrade', 'install'],
      },
    },
  };
}

/**
 * Resolve the effective runtime for a catalog descriptor.
 * Always use this for connect / disconnect / probe / allowlist — never only on connect.
 */
export function resolveEffectiveConnector(
  descriptor: ConnectorDescriptor,
): EffectiveConnectorResolution {
  const runtime = unwrapConnectorRuntime(asRecord(descriptor.runtime));
  const binary = resolveManagedCliBinary(runtime, {
    connectorId: descriptor.id,
    kind: descriptor.kind,
  });
  const isGlab = binary === 'glab' || looksLikeGitlabConnector(descriptor, runtime);

  if (isGlab) {
    const glabDescriptor = buildGlabDescriptor(descriptor);
    return {
      kind: 'managed_cli',
      descriptor: glabDescriptor,
      binary: 'glab',
      isGlab: true,
    };
  }

  const kind = text(descriptor.kind) || 'managed_cli';
  return {
    kind,
    descriptor,
    binary,
    isGlab: false,
  };
}

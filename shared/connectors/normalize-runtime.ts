/**
 * Normalize connector runtime payloads from admin / catalog.
 * Admins often paste nested blobs or omit binary for token-auth CLIs.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Unwrap accidental `{ runtime: { ... } }` nesting from admin JSON. */
export function unwrapConnectorRuntime(
  runtime: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const root = asRecord(runtime);
  const nested = asRecord(root.runtime);
  if (Object.keys(nested).length === 0) return root;
  // Prefer nested fields, keep non-conflicting top-level hints.
  return { ...root, ...nested, runtime: undefined };
}

export function resolveManagedCliBinary(
  runtime: Record<string, unknown>,
  opts?: { connectorId?: string; kind?: string; hasCredentials?: boolean },
): string {
  const normalized = unwrapConnectorRuntime(runtime);
  const explicit = text(normalized.binary).toLowerCase().replace(/\.exe$/i, '');
  if (explicit) return explicit;

  const auth = asRecord(normalized.auth);
  const authType = text(auth.type).toLowerCase();
  const id = text(opts?.connectorId).toLowerCase();
  const kind = text(opts?.kind).toLowerCase();
  const hintBlob = `${text(normalized.serverUrlHint)} ${text(auth.hint)}`.toLowerCase();

  const looksGitlab =
    id.includes('gitlab') ||
    hintBlob.includes('gitlab') ||
    (kind === 'api_token' && id.includes('git')) ||
    (Boolean(opts?.hasCredentials) && (id.includes('gitlab') || id.includes('git')));

  // Only infer glab when signals point at GitLab — never every bare api_token.
  if (looksGitlab || ((authType === 'api_token' || authType === 'token') && looksGitlab)) {
    return 'glab';
  }
  return '';
}

export function normalizeConnectorRuntimeForClient(
  runtime: Record<string, unknown> | undefined | null,
  opts?: { connectorId?: string; kind?: string },
): Record<string, unknown> {
  const normalized = unwrapConnectorRuntime(runtime);
  const kind = text(opts?.kind).toLowerCase();
  const binary = resolveManagedCliBinary(normalized, opts);
  if (kind === 'managed_cli' || kind === 'managed-cli' || binary === 'glab') {
    if (binary && !text(normalized.binary)) {
      normalized.binary = binary;
    }
    if (binary === 'glab') {
      const gateway = asRecord(normalized.gateway);
      const allowBinary = text(gateway.allowBinary) || 'glab';
      const extras = Array.isArray(gateway.allowBinaries)
        ? gateway.allowBinaries.filter((item): item is string => typeof item === 'string')
        : [];
      if (!extras.map((item) => item.toLowerCase()).includes('git')) {
        extras.push('git');
      }
      normalized.gateway = {
        ...gateway,
        allowBinary,
        allowBinaries: extras,
        denyArgs: Array.isArray(gateway.denyArgs) ? gateway.denyArgs : ['upgrade', 'install'],
      };
      const auth = asRecord(normalized.auth);
      if (!text(auth.type)) {
        normalized.auth = { ...auth, type: 'api_token' };
      }
    }
  }
  return normalized;
}

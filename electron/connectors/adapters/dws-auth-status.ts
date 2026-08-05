/**
 * Parse dws auth status JSON into a boolean authenticated flag.
 */
export function parseDwsAuthStatus(data: unknown): boolean {
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record.authenticated === 'boolean') return record.authenticated;
    if (typeof record.loggedIn === 'boolean') return record.loggedIn;
    if (typeof record.userId === 'string' && record.userId.trim()) return true;
    if (typeof record.name === 'string' && record.name.trim()) return true;
  }
  return Boolean(data);
}

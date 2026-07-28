/**
 * Probe Electron embed-browser cookies for known site login state.
 */
import { invokeIpc } from '@/lib/api-client';
import { isTeambitionAppUrl } from '../../shared/sto-policy-auth-cookie';

export { isTeambitionAppUrl };

export async function hasStoPolicyAuthInEmbedSession(): Promise<boolean> {
  if (!window.electron) return false;
  try {
    const result = await invokeIpc<{ ok?: boolean; authenticated?: boolean }>(
      'sclaw-browser:hasStoPolicyAuth',
    );
    return Boolean(result?.authenticated);
  } catch {
    return false;
  }
}

export async function hasTeambitionAuthInEmbedSession(): Promise<boolean> {
  if (!window.electron) return false;
  try {
    const result = await invokeIpc<{ ok?: boolean; authenticated?: boolean }>(
      'sclaw-browser:hasTeambitionAuth',
    );
    return Boolean(result?.authenticated);
  } catch {
    return false;
  }
}

import { hostApiFetch } from '@/lib/host-api';
import type {
  LocalAuthorizeSelectionType,
  LocalAuthorizedFileEntry,
  LocalAuthorizedFilesResult,
} from '@/types/local-authorized-file';

const LOCAL_AUTHORIZED_FILES_BASE = '/api/local-authorized-files';

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export async function listLocalAuthorizedFiles(params: {
  parentEntryId?: string;
  keyword?: string;
}): Promise<LocalAuthorizedFilesResult> {
  return hostApiFetch<LocalAuthorizedFilesResult>(`${LOCAL_AUTHORIZED_FILES_BASE}/entries${buildQuery({
    parentEntryId: params.parentEntryId ?? 'root',
    keyword: params.keyword?.trim(),
  })}`);
}

export async function authorizeLocalFiles(selectionType: LocalAuthorizeSelectionType): Promise<LocalAuthorizedFilesResult> {
  return hostApiFetch<LocalAuthorizedFilesResult>(`${LOCAL_AUTHORIZED_FILES_BASE}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ selectionType }),
  });
}

export async function removeLocalAuthorizedEntry(entryId: string): Promise<LocalAuthorizedFilesResult> {
  return hostApiFetch<LocalAuthorizedFilesResult>(`${LOCAL_AUTHORIZED_FILES_BASE}/entries/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
  });
}

export async function renameLocalAuthorizedEntry(entryId: string, name: string): Promise<LocalAuthorizedFileEntry> {
  return hostApiFetch<LocalAuthorizedFileEntry>(`${LOCAL_AUTHORIZED_FILES_BASE}/entries/${encodeURIComponent(entryId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function revealLocalAuthorizedEntry(entryId: string): Promise<void> {
  await hostApiFetch<{ success: boolean }>(`${LOCAL_AUTHORIZED_FILES_BASE}/entries/${encodeURIComponent(entryId)}/reveal`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

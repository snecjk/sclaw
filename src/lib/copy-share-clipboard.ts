import { hostApiFetch } from '@/lib/host-api';
import type { AttachedFileMeta } from '@/stores/chat';
import { formatAssistantCopyShareTextOnly } from '@/pages/Chat/message-utils';

function mapCopyShareFiles(files: AttachedFileMeta[]) {
  return files
    .filter((file) => file.filePath?.trim())
    .map((file) => ({
      fileName: file.fileName.trim() || 'file',
      filePath: file.filePath!.trim(),
      mimeType: file.mimeType?.trim() || '',
    }));
}

async function writeTextToClipboardWithFallback(text: string): Promise<void> {
  try {
    await hostApiFetch('/api/clipboard/write-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return;
  } catch (error) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    throw error;
  }
}

/** 写入任意纯文本到系统剪贴板（主进程优先，失败时回退 renderer clipboard API）。 */
export async function writePlainTextToClipboard(text: string): Promise<void> {
  await writeTextToClipboardWithFallback(text.trim() || ' ');
}

export async function writeCopyShareTextToClipboard(options: {
  text: string;
}): Promise<void> {
  const clipboardText = formatAssistantCopyShareTextOnly(options.text);
  await writePlainTextToClipboard(clipboardText);
}

export async function writeCopyShareFilesToClipboard(options: {
  files: AttachedFileMeta[];
}): Promise<number> {
  const files = mapCopyShareFiles(options.files);
  if (files.length === 0) {
    throw new Error('No files to copy');
  }

  const result = await hostApiFetch<{ success?: boolean; error?: string; copiedFileCount?: number }>(
    '/api/clipboard/write-files',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    },
  );

  if (!result.copiedFileCount) {
    throw new Error(result.error || 'Failed to copy files');
  }
  return result.copiedFileCount;
}

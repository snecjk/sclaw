/**
 * Parse structured file output references from tool results.
 */

export interface ToolOutputFileRef {
  path: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readPathField(record: Record<string, unknown>): string | null {
  for (const key of ['path', 'file_path', 'filePath', 'file', 'outputPath', 'output_path']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeOutputFileEntry(entry: unknown): ToolOutputFileRef | null {
  const record = asRecord(entry);
  if (!record) return null;
  const path = readPathField(record);
  if (!path) return null;

  const mimeType = typeof record.mimeType === 'string'
    ? record.mimeType
    : typeof record.mime_type === 'string'
      ? record.mime_type
      : typeof record.type === 'string'
        ? record.type
        : undefined;

  const fileName = typeof record.fileName === 'string'
    ? record.fileName
    : typeof record.file_name === 'string'
      ? record.file_name
      : typeof record.name === 'string'
        ? record.name
        : undefined;

  const fileSize = typeof record.fileSize === 'number'
    ? record.fileSize
    : typeof record.file_size === 'number'
      ? record.file_size
      : typeof record.size === 'number'
        ? record.size
        : undefined;

  return { path, mimeType, fileName, fileSize };
}

function collectFromRecord(record: Record<string, unknown>): ToolOutputFileRef[] {
  const results: ToolOutputFileRef[] = [];
  const seen = new Set<string>();

  function push(entry: ToolOutputFileRef | null): void {
    if (!entry) return;
    const key = entry.path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(entry);
  }

  for (const key of ['outputFiles', 'output_files', 'files', 'writtenFiles', 'written_files', 'artifacts']) {
    const arr = record[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) push(normalizeOutputFileEntry(item));
  }

  const single = readPathField(record);
  if (single) push({ path: single });

  for (const nestedKey of ['data', 'details', 'meta']) {
    const nested = asRecord(record[nestedKey]);
    if (nested) {
      for (const ref of collectFromRecord(nested)) push(ref);
    }
  }

  return results;
}

/** Parse output file refs from tool result JSON / envelope / content blocks. */
export function parseToolOutputFiles(content: unknown): ToolOutputFileRef[] {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return parseToolOutputFiles(JSON.parse(trimmed));
      } catch { /* ignore */ }
    }
    return [];
  }

  if (Array.isArray(content)) {
    const merged: ToolOutputFileRef[] = [];
    const seen = new Set<string>();
    for (const block of content) {
      for (const ref of parseToolOutputFiles(block)) {
        const key = ref.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(ref);
      }
      if (block && typeof block === 'object' && 'text' in block) {
        for (const ref of parseToolOutputFiles((block as { text: unknown }).text)) {
          const key = ref.path.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(ref);
        }
      }
    }
    return merged;
  }

  const record = asRecord(content);
  return record ? collectFromRecord(record) : [];
}

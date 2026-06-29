/**
 * Extract workspace / runDir hints from tool result payloads (Gateway, Write, PythonRun).
 */

export interface ToolWorkspaceHints {
  cwd?: string;
  outputDir?: string;
  runDir?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function hintsFromRecord(record: Record<string, unknown>): ToolWorkspaceHints {
  const cwd = readStringField(record, [
    'cwd', 'workspace', 'workspacePath', 'workspace_path', 'workingDirectory', 'working_dir',
  ]);
  const outputDir = readStringField(record, ['outputDir', 'output_dir', 'outputDirectory', 'output_directory']);
  const runDir = readStringField(record, ['runDir', 'run_dir', 'runtimeDir', 'runtime_dir']);
  const hints: ToolWorkspaceHints = {};
  if (cwd) hints.cwd = cwd;
  if (outputDir) hints.outputDir = outputDir;
  if (runDir) hints.runDir = runDir;
  return hints;
}

function mergeHints(base: ToolWorkspaceHints, extra: ToolWorkspaceHints): ToolWorkspaceHints {
  return {
    cwd: extra.cwd || base.cwd,
    outputDir: extra.outputDir || base.outputDir,
    runDir: extra.runDir || base.runDir,
  };
}

function hintsFromJsonValue(value: unknown): ToolWorkspaceHints {
  const record = asRecord(value);
  if (!record) return {};

  let hints = hintsFromRecord(record);
  const data = asRecord(record.data);
  if (data) hints = mergeHints(hints, hintsFromRecord(data));
  const details = asRecord(record.details);
  if (details) hints = mergeHints(hints, hintsFromRecord(details));
  const meta = asRecord(record.meta);
  if (meta) hints = mergeHints(hints, hintsFromRecord(meta));
  return hints;
}

/** Extract tool result text from string or content blocks. */
export function extractToolResultTextForHints(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && typeof block === 'object') {
      if ('text' in block && typeof block.text === 'string') return block.text;
      if ('content' in block && typeof block.content === 'string') return block.content;
    }
  }
  return null;
}

/** Parse workspace hints from tool result content (JSON body, envelope, or metadata). */
export function parseToolWorkspaceHints(content: unknown): ToolWorkspaceHints {
  let hints = hintsFromJsonValue(content);

  const text = extractToolResultTextForHints(content);
  if (text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        hints = mergeHints(hints, hintsFromJsonValue(JSON.parse(trimmed)));
      } catch { /* ignore */ }
    }
  }

  return hints;
}

export function hasToolWorkspaceHints(hints: ToolWorkspaceHints): boolean {
  return Boolean(hints.cwd || hints.outputDir || hints.runDir);
}

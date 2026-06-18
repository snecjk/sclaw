import { extractCommandText, pickCliParams } from "./command-extract.js";

type CachedCommand = {
  params?: Record<string, unknown>;
  command?: string;
  at: number;
};

const cache = new Map<string, CachedCommand>();
const MAX_ENTRIES = 8000;
const TTL_MS = 30 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now - entry.at > TTL_MS) {
      cache.delete(id);
    }
  }
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

/** before_tool_call 时缓存；after 常不带 params，需回填 sai-cli 命令 */
export function rememberToolCommand(
  toolCallId: string | undefined,
  event: { params?: Record<string, unknown>; command?: string },
): void {
  if (!toolCallId) return;
  const picked = pickCliParams(event.params);
  const command =
    (typeof event.command === "string" && event.command.trim()) ||
    (picked ? extractCommandText(picked) : undefined);
  if (!command && !picked) return;
  cache.set(toolCallId, {
    params: picked,
    command: command ?? undefined,
    at: Date.now(),
  });
  prune();
}

export function recallToolCommand(toolCallId: string | undefined): CachedCommand | undefined {
  if (!toolCallId) return undefined;
  const entry = cache.get(toolCallId);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(toolCallId);
    return undefined;
  }
  return entry;
}

export function mergeToolParams(
  toolCallId: string | undefined,
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const picked = pickCliParams(params);
  if (picked && extractCommandText(picked)) {
    return picked;
  }
  const cached = recallToolCommand(toolCallId);
  if (cached?.params) {
    return cached.params;
  }
  if (cached?.command) {
    return { command: cached.command };
  }
  return picked;
}

/**
 * Agent 改文件时跟随到右侧代码页。
 * 用户自己切页/切文件后暂停；空闲 APP_DEV_CODE_FOLLOW_IDLE_MS 后再跟。
 *
 * Write/Edit 完成后额外触发「从磁盘强制刷新」（见 agentSourceReloadRequest），
 * 避免只打开过 running 态、落盘后编辑器仍显示旧内容。
 */
import type { ToolStatus } from '@/stores/chat';
import { classifyAppDevTool, extractAppDevFileOpStat } from '@/lib/app-dev-tool-rollup';
import { toAppDevSourceRelativePath } from '@/lib/app-dev-reveal-source';

export { APP_DEV_CODE_FOLLOW_IDLE_MS } from '@/lib/app-dev-code-follow-idle';

export interface AppDevCodeFollowTarget {
  path: string;
  key: string;
  status: ToolStatus['status'];
}

function toolFollowId(tool: ToolStatus, index: number): string {
  return tool.toolCallId ?? tool.id ?? `${tool.name}:${index}`;
}

function resolveFileFollowPath(tool: ToolStatus): string | null {
  if (classifyAppDevTool(tool.name) !== 'file') return null;
  const raw = extractAppDevFileOpStat(tool)?.path?.trim();
  if (!raw) return null;
  return toAppDevSourceRelativePath(raw) || null;
}

export function extractLatestAppDevCodeFollowTarget(
  tools: readonly ToolStatus[],
): AppDevCodeFollowTarget | null {
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    const tool = tools[i];
    if (!tool) continue;
    const path = resolveFileFollowPath(tool);
    if (!path) continue;
    const id = toolFollowId(tool, i);
    return { path, key: `${id}:${tool.status}`, status: tool.status };
  }
  return null;
}

/**
 * 找出尚未消费过的「已完成」文件写入，用于落盘后立刻刷编辑器。
 * 与「最新一条跟随」分开：避免 Write 完成后立刻又来一个 running Edit 时漏刷 Write。
 */
export function extractCompletedAppDevFileReloads(
  tools: readonly ToolStatus[],
  seenCompletedKeys: ReadonlySet<string>,
): { reloadPaths: string[]; nextSeenKeys: Set<string> } {
  const nextSeenKeys = new Set(seenCompletedKeys);
  const reloadPaths: string[] = [];
  const queued = new Set<string>();

  for (let i = 0; i < tools.length; i += 1) {
    const tool = tools[i];
    if (!tool || tool.status !== 'completed') continue;
    const path = resolveFileFollowPath(tool);
    if (!path) continue;
    const key = `${toolFollowId(tool, i)}:completed`;
    if (nextSeenKeys.has(key)) continue;
    nextSeenKeys.add(key);
    if (queued.has(path)) continue;
    queued.add(path);
    reloadPaths.push(path);
  }

  return { reloadPaths, nextSeenKeys };
}

export function isAppDevCodeFollowPaused(pausedUntil: number, now = Date.now()): boolean {
  return pausedUntil > now;
}

export function followAppDevLiveTools(
  tools: readonly ToolStatus[],
  options: {
    pausedUntil: number;
    lastKey: string | null;
    now?: number;
  },
): { revealPath: string | null; nextKey: string | null } {
  if (isAppDevCodeFollowPaused(options.pausedUntil, options.now ?? Date.now())) {
    return { revealPath: null, nextKey: options.lastKey };
  }
  const target = extractLatestAppDevCodeFollowTarget(tools);
  if (!target || target.key === options.lastKey) {
    return { revealPath: null, nextKey: options.lastKey };
  }
  return { revealPath: target.path, nextKey: target.key };
}

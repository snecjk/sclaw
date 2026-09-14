/**
 * Agent 改文件时跟随到右侧代码页。
 * 用户自己切页/切文件后暂停；空闲 APP_DEV_CODE_FOLLOW_IDLE_MS 后再跟。
 */
import type { ToolStatus } from '@/stores/chat';
import { classifyAppDevTool, extractAppDevFileOpStat } from '@/lib/app-dev-tool-rollup';
import { toAppDevSourceRelativePath } from '@/lib/app-dev-reveal-source';

export { APP_DEV_CODE_FOLLOW_IDLE_MS } from '@/lib/app-dev-code-follow-idle';

export interface AppDevCodeFollowTarget {
  path: string;
  key: string;
}

export function extractLatestAppDevCodeFollowTarget(
  tools: readonly ToolStatus[],
): AppDevCodeFollowTarget | null {
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    const tool = tools[i];
    if (!tool || classifyAppDevTool(tool.name) !== 'file') continue;
    const raw = extractAppDevFileOpStat(tool)?.path?.trim();
    if (!raw) continue;
    const path = toAppDevSourceRelativePath(raw);
    if (!path) continue;
    const id = tool.toolCallId ?? tool.id ?? `${tool.name}:${i}`;
    return { path, key: `${id}:${tool.status}` };
  }
  return null;
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

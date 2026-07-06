/**
 * 思考/工具过程块语义图标（MasterGo 4:2177）
 *
 * 按工具原始名映射 Lucide 图标；展示名仍走 resolveChatToolDisplayName。
 */
import type { LucideIcon } from 'lucide-react';
import { Brain, Clock, FileSearch, Globe, Sparkles, Terminal, Wrench } from 'lucide-react';

function normalizeToolKey(rawName: string): string {
  return rawName.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * 深度思考块图标。
 */
export function resolveChatThinkingIcon(): LucideIcon {
  return Brain;
}

/**
 * 思考面板内工具块统一图标（与「读取文件」一致）。
 */
export function resolveChatThinkingProcessToolIcon(): LucideIcon {
  return FileSearch;
}

/**
 * 工具块标题行图标：时钟 / 文件 / 终端 / 联网 / 技能 / 默认扳手。
 */
export function resolveChatProcessToolIcon(rawName: string): LucideIcon {
  const normalized = normalizeToolKey(rawName);
  if (!normalized) return Wrench;

  const tail = normalized.split('__').pop() ?? normalized;

  if (
    tail.includes('time') ||
    tail.includes('date') ||
    tail === 'datetime' ||
    normalized.includes('current_time')
  ) {
    return Clock;
  }

  if (
    tail === 'read' ||
    tail === 'write' ||
    tail === 'glob' ||
    tail === 'grep' ||
    tail.includes('file') ||
    tail.includes('search')
  ) {
    return FileSearch;
  }

  if (tail === 'bash' || tail === 'exec' || tail === 'shell' || tail === 'run') {
    return Terminal;
  }

  if (
    tail === 'websearch' ||
    tail === 'web_fetch' ||
    tail === 'webfetch' ||
    tail.includes('fetch') ||
    tail.includes('http')
  ) {
    return Globe;
  }

  if (tail === 'skill' || tail.includes('skill')) {
    return Sparkles;
  }

  return Wrench;
}

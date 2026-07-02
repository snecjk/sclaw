/**
 * 对话流工具名 → 用户可见中文别名
 *
 * @see docs/chat-interaction-style-spec.md §4.4 工具名映射
 * 展示层专用；不影响 Gateway 实际 tool name。
 */

const TOOL_DISPLAY_NAME_MAP: Readonly<Record<string, string>> = {
  bash: '执行命令',
  exec: '执行命令',
  read: '读取文件',
  write: '写入文件',
  glob: '文件搜索',
  grep: '内容搜索',
  websearch: '联网搜索',
  web_fetch: '联网搜索',
  webfetch: '联网搜索',
  skill: '调用技能',
  taskcreate: '创建任务',
  taskupdate: '更新任务',
};

/**
 * 将原始工具名映射为规范文档建议的中文展示名；未知工具保留原名。
 */
export function resolveChatToolDisplayName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return '…';

  const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  const direct = TOOL_DISPLAY_NAME_MAP[normalized];
  if (direct) return direct;

  // OpenClaw 常见前缀：mcp__server__read → read
  const tail = normalized.split('__').pop();
  if (tail && TOOL_DISPLAY_NAME_MAP[tail]) {
    return TOOL_DISPLAY_NAME_MAP[tail];
  }

  return trimmed;
}

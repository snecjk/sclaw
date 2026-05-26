/**
 * Gateway RPC 安全黑名单
 *
 * 禁止 AI 诱导执行的升级/安装类危险 RPC 方法。
 * 该配置同时用于 renderer（WebSocket / HTTP transport）和 main process（IPC fallback）。
 */

/** 被禁止的 RPC 方法正则列表 */
export const BLOCKED_RPC_METHODS: RegExp[] = [
  // OpenClaw 自身升级/重装
  /^openclaw\./i,
  // 系统级危险操作
  /^system\.(update|upgrade|install|exec|shell|run)/i,
  // Shell / 进程执行类（可被用于间接执行升级命令）
  /^shell\./i,
  /^process\.(spawn|exec|run)/i,
  // CLI 工具升级（sai-cli update 已放行；install 仍禁止）
  /^cli\.(upgrade|install)/i,
  /^sai\.(upgrade|install)/i,
  // 包管理器直接调用
  /^(npm|pnpm|yarn)\./i,
  /^pip\.(install|upgrade|uninstall)/i,
  // 通用危险关键字（裸调用）
  /^(update|upgrade|install|exec|shell|run)$/i,
];

/**
 * 检查 RPC 方法是否在黑名单中。
 * @returns 中文错误信息（被阻止时）或 null（允许时）
 */
export function getBlockedRpcErrorMessage(method: string): string | null {
  for (const pattern of BLOCKED_RPC_METHODS) {
    if (pattern.test(method)) {
      return `系统安全策略已阻止该操作（${method}）：暂不支持通过对话执行升级或安装类命令，请通过设置页面手动操作。`;
    }
  }
  return null;
}

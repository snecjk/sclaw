/**
 * SClaw Web Bridge 主聊天链路未完成，上线前保持 false（与 main 一致）：
 * - 普通 Pi 会话使用 pi-browser-use（chrome-devtools-mcp / 托管 Chrome）
 * - bridge_* 找不到扩展会话时直接报错，不调用 ensure-session 自动接管本机 Chrome
 *
 * TODO(web-bridge): 功能就绪后改为 true，恢复 Web Bridge 主聊天路由。
 */
export const WEB_BRIDGE_ORDINARY_CHAT_ENABLED = false;

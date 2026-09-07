/**
 * Electron 主进程引导入口（AgentLoop 统一初始化）。
 *
 * bootstrap() 的执行顺序是本文件的核心契约：
 *   1. registerAgentLoopProbe() —— 同步 require('@loongsuite/cms_node_sdk/register')
 *      注册探针（进程内幂等；配置缺失/异常时 fail-open 并继续）；
 *   2. loadMainModule() —— 以动态 import('./main') 加载现有业务入口（window/tray/IPC/Claude Agent）。
 *
 * 由于步骤 1 在步骤 2 之前同步完成，Claude Agent SDK 的任何运行时加载
 * （经 claude-agent-sdk-loader 的 CommonJS require）都发生在探针注册之后，
 * 从而能被 @loongsuite/cms_node_sdk 自动插桩。
 *
 * 顺序由 bootstrap() 函数体强制，不依赖 ESM 静态导入提升排序，
 * 也不使用打包应用中受限的 NODE_OPTIONS --require。
 * 探针初始化失败 fail-open：bootstrap 内部已捕获降级。
 */

import { bootstrap } from './agentloop-init';

// 探针注册在 bootstrap 内部同步完成；业务入口加载失败属致命错误，记录并退出。
void bootstrap().catch((error) => {
  console.error('[AgentLoop] 主进程业务入口加载失败：', error);
  process.exit(1);
});

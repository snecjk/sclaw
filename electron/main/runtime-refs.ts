/**
 * 主进程运行时引用（无启动副作用）。
 *
 * 供 main.ts 在构造核心服务后写入 gatewayManager，供其它模块在需要时异步读取。
 * 与 electron/main/index.ts（引导入口）/ main.ts（业务入口）不同，本模块
 * 不执行任何 Electron 生命周期或窗口创建逻辑，可被安全地静态/动态导入。
 */

import type { GatewayManager } from '../gateway/manager';

let gatewayManagerRef: GatewayManager | null = null;

export function setGatewayManagerRef(gm: GatewayManager): void {
  gatewayManagerRef = gm;
}

export function getGatewayManagerRef(): GatewayManager | null {
  return gatewayManagerRef;
}

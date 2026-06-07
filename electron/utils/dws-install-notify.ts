import { dialog, type BrowserWindow } from 'electron';
import { logger } from './logger';

interface GatewayManagerLike {
  getStatus: () => { state: string };
  restart: () => Promise<void>;
}

export interface DwsInstallOutcome {
  success: boolean;
  updated?: boolean;
}

/**
 * 钉钉 CLI 安装/升级成功后提示用户重启 Gateway，确认后立即重启。
 * 已是最新版本（updated === false）或 Gateway 未运行时跳过。
 */
export async function promptGatewayRestartAfterDwsInstall(
  gatewayManager: GatewayManagerLike,
  parentWindow: BrowserWindow | null | undefined,
  installResult: DwsInstallOutcome,
): Promise<void> {
  if (!installResult.success) return;
  if (installResult.updated === false) return;
  if (gatewayManager.getStatus().state !== 'running') return;

  const window = parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined;
  try {
    await dialog.showMessageBox(window, {
      type: 'info',
      title: '钉钉 CLI 安装完成',
      message: '钉钉 CLI 已安装完成',
      detail: '对话中的 Agent 需要重启 Gateway 后才能使用钉钉命令。请点击「确定」重启 Gateway。',
      buttons: ['确定'],
      defaultId: 0,
      noLink: true,
    });
    await gatewayManager.restart();
    logger.info('Gateway restarted after dws CLI install (user confirmed)');
  } catch (error) {
    logger.warn('Failed to prompt or restart gateway after dws install:', error);
  }
}

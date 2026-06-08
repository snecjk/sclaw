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
 * 钉钉插件安装/升级成功后提示用户重启网关，确认后立即重启。
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
      title: '钉钉插件安装完成',
      message: '钉钉插件已安装完成',
      detail:
        '重启网关后即可使用钉钉能力。在对话输入框输入 @，可搜索联系人或群聊并分享内容。\n\n点击「确定」将立即重启网关。',
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

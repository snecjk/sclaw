import { webContents } from 'electron';

/** D1：把「自动操作中」标记发给承载 webview 的 renderer。 */
export function sendSclawEmbedAutomationMark(
  webContentsId: number,
  runtimeId: string,
  active: boolean,
): void {
  try {
    const guest = webContents.fromId(webContentsId);
    if (!guest || guest.isDestroyed()) return;
    const host = guest.hostWebContents;
    if (!host || host.isDestroyed()) return;
    host.send('sclaw-browser:automation-mark', { runtimeId, active });
  } catch {
    // Tests and detached guests have no host webContents.
  }
}

import { dialog, ipcMain } from 'electron';

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:open', async (_, options: Electron.OpenDialogOptions) => {
    return dialog.showOpenDialog(options);
  });

  ipcMain.handle('dialog:save', async (_, options: Electron.SaveDialogOptions) => {
    return dialog.showSaveDialog(options);
  });

  ipcMain.handle('dialog:message', async (_, options: Electron.MessageBoxOptions) => {
    return dialog.showMessageBox(options);
  });
}

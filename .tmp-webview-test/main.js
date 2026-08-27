const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  app.on('web-contents-created', (_e, wc) => {
    console.log('[wcc]', wc.getType(), wc.id);
    if (wc.getType() === 'webview') {
      wc.setWindowOpenHandler(({ url, frameName }) => {
        console.log('[HANDLER FIRED]', url, 'frameName=', frameName);
        return { action: 'deny' };
      });
    }
  });

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: { webviewTag: true, contextIsolation: false, nodeIntegration: true },
  });
  win.loadFile('index.html');
});

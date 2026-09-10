/**
 * Electron 40 实机 PoC：Accessibility.getFullAXTree
 * 对照 BrowserWindow.webContents 与 <webview> guest webContents。
 *
 *   pnpm exec electron scripts/ax-webview-poc.cjs
 *
 * 结果写入 reports/browser-bridge/ax-webview-poc-result.json
 */
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');

const OUT_DIR = join(__dirname, '..', 'reports', 'browser-bridge');
const OUT_FILE = join(OUT_DIR, 'ax-webview-poc-result.json');

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>AX PoC Fixture</title></head>
<body>
  <h1>Accessibility probe</h1>
  <p>Interactive controls for getFullAXTree.</p>
  <button id="go" type="button">Go</button>
  <label>Name <input id="name" type="text" aria-label="Name" value="demo"></label>
  <a href="#x">Skip link</a>
</body>
</html>`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeNodes(result) {
  const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
  const roles = [];
  for (const node of nodes) {
    const role = node?.role?.value ?? node?.role ?? '';
    if (role) roles.push(String(role));
  }
  const interactive = nodes.filter((node) => {
    const role = String(node?.role?.value ?? node?.role ?? '').toLowerCase();
    return ['button', 'link', 'textbox', 'textfield', 'checkbox', 'radio', 'combobox'].includes(role);
  }).length;
  return {
    nodeCount: nodes.length,
    interactiveApprox: interactive,
    sampleRoles: roles.slice(0, 16),
  };
}

async function probeAx(label, webContents) {
  const started = Date.now();
  const report = {
    label,
    webContentsType: typeof webContents.getType === 'function' ? webContents.getType() : 'unknown',
    webContentsId: webContents.id,
    durationMs: 0,
    withoutEnable: { ok: false, nodeCount: 0, error: null },
    withEnable: { ok: false, nodeCount: 0, error: null },
  };

  try {
    webContents.debugger.attach('1.3');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already attached/i.test(message)) {
      report.error = message;
      report.durationMs = Date.now() - started;
      return report;
    }
  }

  const send = (method, params) => webContents.debugger.sendCommand(method, params);

  try {
    const raw = await send('Accessibility.getFullAXTree');
    const summary = summarizeNodes(raw);
    report.withoutEnable = { ok: summary.nodeCount > 0, ...summary, error: null };
  } catch (error) {
    report.withoutEnable.error = error instanceof Error ? error.message : String(error);
  }

  try {
    await send('Accessibility.enable');
    const raw = await send('Accessibility.getFullAXTree');
    const summary = summarizeNodes(raw);
    report.withEnable = { ok: summary.nodeCount > 0, ...summary, error: null };
  } catch (error) {
    report.withEnable.error = error instanceof Error ? error.message : String(error);
  }

  try {
    webContents.debugger.detach();
  } catch {
    /* ignore */
  }

  report.durationMs = Date.now() - started;
  report.domFallbackStillRequired = !(report.withoutEnable.ok || report.withEnable.ok);
  return report;
}

async function runWindowProbe() {
  const win = new BrowserWindow({
    show: true,
    width: 800,
    height: 600,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(FIXTURE_HTML)}`);
  await sleep(400);
  const result = await probeAx('BrowserWindow.webContents', win.webContents);
  win.close();
  return result;
}

async function runWebviewProbe() {
  const dir = join(os.tmpdir(), 'stoclaw-ax-poc');
  mkdirSync(dir, { recursive: true });
  const fixturePath = join(dir, 'fixture.html');
  const hostPath = join(dir, 'host.html');
  writeFileSync(fixturePath, FIXTURE_HTML);
  writeFileSync(
    hostPath,
    `<!doctype html>
<html>
<body>
  <webview id="guest" src="${pathToFileURL(fixturePath).href}" partition="ax-poc"
    style="width:800px;height:600px"></webview>
</body>
</html>`,
  );

  const win = new BrowserWindow({
    show: true,
    width: 840,
    height: 640,
    webPreferences: {
      webviewTag: true,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const guestPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for webview guest')), 20_000);
    win.webContents.on('did-attach-webview', (_event, guest) => {
      guest.on('did-finish-load', () => {
        clearTimeout(timer);
        resolve(guest);
      });
    });
  });

  await win.loadFile(hostPath);
  const guest = await guestPromise;
  await sleep(500);
  const result = await probeAx('webview.guest.webContents', guest);
  win.close();
  return result;
}

app.whenReady().then(async () => {
  const electronVersion = process.versions.electron;
  const chromeVersion = process.versions.chrome;
  /** @type {Record<string, unknown>} */
  const output = {
    at: new Date().toISOString(),
    electronVersion,
    chromeVersion,
    platform: process.platform,
    probes: [],
    conclusion: '',
  };

  try {
    output.probes.push(await runWindowProbe());
  } catch (error) {
    output.probes.push({
      label: 'BrowserWindow.webContents',
      error: error instanceof Error ? error.message : String(error),
      domFallbackStillRequired: true,
    });
  }

  try {
    output.probes.push(await runWebviewProbe());
  } catch (error) {
    output.probes.push({
      label: 'webview.guest.webContents',
      error: error instanceof Error ? error.message : String(error),
      domFallbackStillRequired: true,
    });
  }

  const windowOk = output.probes.find((p) => p.label === 'BrowserWindow.webContents');
  const guestOk = output.probes.find((p) => p.label === 'webview.guest.webContents');
  const windowHasAx = Boolean(windowOk?.withoutEnable?.ok || windowOk?.withEnable?.ok);
  const guestHasAx = Boolean(guestOk?.withoutEnable?.ok || guestOk?.withEnable?.ok);
  const guestNeedsEnable = Boolean(guestOk?.withEnable?.ok && !guestOk?.withoutEnable?.ok);

  if (guestHasAx && windowHasAx) {
    output.conclusion = guestNeedsEnable
      ? 'AX available on window and webview guest; guest only populated after Accessibility.enable. Observer can try enable then getFullAXTree before DOM fallback.'
      : 'AX available on both BrowserWindow and webview guest without requiring a permanent DOM-only path.';
  } else if (windowHasAx && !guestHasAx) {
    output.conclusion = 'AX works on BrowserWindow.webContents but not on <webview> guest — keep CDP_DOMAIN_UNSUPPORTED → DOM fallback for embed.';
  } else {
    output.conclusion = 'Accessibility.getFullAXTree did not return a usable tree on this Electron build. Keep DOM fallback.';
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
  console.log(`wrote ${OUT_FILE}`);
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

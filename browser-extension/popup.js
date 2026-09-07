const $ = (id) => document.getElementById(id);

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  const mismatch = Boolean(status.versionMismatch);
  $('mismatch').hidden = !mismatch;
  $('disconnected').hidden = mismatch || status.connected;
  $('connected').hidden = mismatch || !status.connected;
  if (mismatch) {
    $('mismatch-versions').textContent = `已安装 ${status.installedVersion}，StoClaw 内置 ${status.bundledVersion || '?'}`;
  }
  $('tab-url').textContent = status.tabUrl || '(无标签)';
  const restricted = /^(chrome|chrome-extension|edge|about|devtools):/i.test(status.tabUrl || '');
  $('restricted').hidden = !restricted;
  $('versions').textContent = `扩展 ${status.installedVersion}`
    + (status.bundledVersion ? ` · Host ${status.bundledVersion}` : '')
    + (status.sessionId ? ` · ${status.sessionId}` : '');
  $('update').hidden = !status.updateAvailable || mismatch;
}

$('auto-connect').addEventListener('click', async () => {
  $('status').textContent = '连接中…';
  const result = await chrome.runtime.sendMessage({ type: 'autoConnect' });
  $('status').textContent = result.ok ? '已拿到 token' : (result.error || '失败');
  await refresh();
});

$('pair').addEventListener('click', async () => {
  const code = $('pairing-code').value.trim();
  $('status').textContent = '配对中…';
  const result = await chrome.runtime.sendMessage({ type: 'pair', code });
  $('status').textContent = result.ok ? '配对成功' : (result.error || '失败');
  await refresh();
});

$('disconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'disconnect' });
  $('status').textContent = '已断开';
  await refresh();
});

void refresh();

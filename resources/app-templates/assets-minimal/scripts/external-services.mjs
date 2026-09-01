import { readFile } from 'node:fs/promises';

const host = (process.env.SCLAW_HOST_API_URL || 'http://127.0.0.1:3210').replace(/\/$/, '');
const marker = JSON.parse(
  await readFile(new URL('../.sclaw/app-dev.json', import.meta.url), 'utf8'),
);
if (!marker.workspaceId) {
  throw new Error('当前应用缺少 workspaceId，请在 SClaw 中重新打开应用');
}

async function call(path, init) {
  const response = await fetch(`${host}${path}`, init);
  const payload = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.errMessage || `HTTP ${response.status}`);
  }
  return payload;
}

const [action, ...args] = process.argv.slice(2);
const workspaceId = marker.workspaceId;
let result;

switch (action) {
  case 'search': {
    const keyword = args.join(' ').trim();
    const query = new URLSearchParams({ workspaceId, ...(keyword ? { keyword } : {}) });
    result = await call(`/api/app-external-services/search?${query}`);
    break;
  }
  case 'list': {
    const query = new URLSearchParams({ workspaceId });
    result = await call(`/api/app-external-services/bindings?${query}`);
    break;
  }
  case 'bind': {
    const [serviceId, version, alias] = args;
    if (!serviceId) throw new Error('用法: pnpm sclaw:services -- bind <serviceId> [version] [alias]');
    result = await call('/api/app-external-services/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, serviceId, version, alias }),
    });
    break;
  }
  case 'upgrade': {
    const [alias, version] = args;
    if (!alias || !version) throw new Error('用法: pnpm sclaw:services -- upgrade <alias> <version>');
    result = await call('/api/app-external-services/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, alias, version }),
    });
    break;
  }
  case 'remove': {
    const [alias] = args;
    if (!alias) throw new Error('用法: pnpm sclaw:services -- remove <alias>');
    result = await call('/api/app-external-services/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, alias }),
    });
    break;
  }
  default:
    throw new Error('用法: pnpm sclaw:services -- search|list|bind|upgrade|remove');
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

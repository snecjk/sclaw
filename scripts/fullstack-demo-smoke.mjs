#!/usr/bin/env node
/**
 * P4 DoD driver for local fullstack template.
 *
 * Modes:
 * 1) Direct (default): copy site-fullstack → install → migrate → start → smoke → stop → start → smoke
 * 2) Host API: set SCLAW_HOST_API=http://127.0.0.1:3210 and WORKSPACE_ID=<id>
 *    → runtime/start → runtime/smoke → runtime/stop → runtime/start → runtime/smoke
 *
 * Requires managed Node on PATH (or NODE_BIN / SCLAW_NODE_HOME).
 */
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = join(root, 'resources', 'app-templates', 'site-fullstack');
const hostApi = (process.env.SCLAW_HOST_API || '').replace(/\/$/, '');
const workspaceId = process.env.WORKSPACE_ID || '';

function managedNodeBin() {
  if (process.env.NODE_BIN) return process.env.NODE_BIN;
  const home = process.env.SCLAW_NODE_HOME
    || join(process.env.HOME || '', '.stoclaw', 'runtime', 'node', 'v22.14.0');
  return join(home, 'bin', 'node');
}

function managedNpmBin() {
  if (process.env.NPM_BIN) return process.env.NPM_BIN;
  return join(dirname(managedNodeBin()), 'npm');
}

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}), PATH: `${dirname(managedNodeBin())}:${process.env.PATH || ''}` },
      stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let out = '';
    if (opts.silent) {
      child.stdout?.on('data', (d) => { out += String(d); });
      child.stderr?.on('data', (d) => { out += String(d); });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(out);
      else reject(new Error(`${cmd} ${args.join(' ')} exit=${code}\n${out.slice(-2000)}`));
    });
  });
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolvePort(port)));
    });
    server.on('error', reject);
  });
}

async function waitHealth(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'timeout';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        const body = await res.json();
        if (body?.ok) return;
      }
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`health fail: ${last}`);
}

async function hostJson(path, init) {
  const res = await fetch(`${hostApi}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && body?.success !== true) {
    throw new Error(`${path} → ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

async function runHostApiMode() {
  console.log('[demo-smoke] Host API mode', hostApi, workspaceId);
  await hostJson('/api/app-dev/runtime/start', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
  let status = await hostJson(`/api/app-dev/runtime/status?workspaceId=${encodeURIComponent(workspaceId)}`);
  console.log('[demo-smoke] DoD-1 start', status.status?.backendUrl, status.status?.phase);

  let smoke = await hostJson('/api/app-dev/runtime/smoke', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
  if (!smoke.success) throw new Error(`DoD-1 smoke FAIL: ${smoke.errMessage || ''}`);
  console.log('[demo-smoke] DoD-1 PASS');

  await hostJson('/api/app-dev/runtime/stop', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
  await hostJson('/api/app-dev/runtime/start', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
  smoke = await hostJson('/api/app-dev/runtime/smoke', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
  if (!smoke.success) throw new Error(`DoD-2 smoke FAIL: ${smoke.errMessage || ''}`);
  console.log('[demo-smoke] DoD-2 PASS (stop→start persist)');
  console.log('[demo-smoke] ALL PASS (Host API; DoD-3 is UI auto-heal — verify in workbench)');
}

async function runDirectMode() {
  const npm = managedNpmBin();
  const node = managedNodeBin();
  console.log('[demo-smoke] direct mode', { node, npm });

  const work = await mkdtemp(join(tmpdir(), 'fullstack-demo-'));
  const appPath = join(work, 'app');
  try {
    await cp(template, appPath, { recursive: true });
    const pkg = JSON.parse(await readFile(join(appPath, 'package.json'), 'utf8'));
    pkg.name = 'fullstack-demo-smoke';
    await writeFile(join(appPath, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

    console.log('[demo-smoke] npm install…');
    await run(npm, ['install', '--registry=https://registry.npmmirror.com'], { cwd: appPath });

    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    await mkdir(join(appPath, '.data'), { recursive: true });
    const env = {
      PORT: String(port),
      DATABASE_URL: join(appPath, '.data', 'app.db'),
      SESSION_SECRET: 'demo-smoke-secret',
      SMOKE_BASE_URL: url,
    };

    console.log('[demo-smoke] migrate…');
    await run(npm, ['run', 'db:migrate'], { cwd: appPath, env, silent: true });

    const startServer = () => {
      const child = spawn(npm, ['run', 'dev:server'], {
        cwd: appPath,
        env: { ...process.env, ...env, PATH: `${dirname(node)}:${process.env.PATH || ''}` },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      return child;
    };

    let child = startServer();
    try {
      await waitHealth(url);
      console.log('[demo-smoke] DoD-1 health ok', url);
      await run(npm, ['run', 'smoke'], { cwd: appPath, env, silent: true });
      console.log('[demo-smoke] DoD-1 PASS');

      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      await new Promise((r) => setTimeout(r, 800));

      child = startServer();
      await waitHealth(url);
      await run(npm, ['run', 'smoke'], { cwd: appPath, env, silent: true });
      console.log('[demo-smoke] DoD-2 PASS (stop→start persist)');
      console.log('[demo-smoke] ALL PASS (direct; DoD-3 is UI auto-heal — verify in workbench)');
    } finally {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  if (hostApi && workspaceId) await runHostApiMode();
  else await runDirectMode();
}

main().catch((err) => {
  console.error('[demo-smoke] FAIL', err instanceof Error ? err.message : err);
  process.exit(1);
});

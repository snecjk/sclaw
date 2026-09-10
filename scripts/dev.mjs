#!/usr/bin/env node
/**
 * Dev launcher: runs Vite, and on Ctrl+C always hard-kills this repo's Electron
 * tree so the Dock icon cannot linger as an orphan after pnpm/vite exit.
 *
 * Why: vite-plugin-electron treeKill only SIGTERMs; Electron before-quit swallows
 * it. Async vite SIGINT handlers often get aborted when pnpm prints ELIFECYCLE.
 */
import { spawn, spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_MARKERS = ['memory-center-doc/sto-claw', 'aiwork2/memory-center-doc/sto-claw', root];

let shuttingDown = false;
/** @type {import('node:child_process').ChildProcess | null} */
let viteChild = null;

function killPid(pid) {
  if (!pid || !Number.isFinite(pid)) return;
  try {
    spawnSync('kill', ['-9', String(pid)], { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

function descendants(rootPid) {
  const out = [];
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const text = execSync(`pgrep -P ${pid}`, { encoding: 'utf8' }).trim();
      for (const part of text.split(/\s+/)) {
        const child = Number(part);
        if (Number.isFinite(child) && child > 0) {
          out.push(child);
          queue.push(child);
        }
      }
    } catch {
      // no children
    }
  }
  return out;
}

function killTree(rootPid) {
  if (!rootPid) return;
  for (const pid of descendants(rootPid).reverse()) killPid(pid);
  killPid(rootPid);
}

function sweepStoClawElectron() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;
  try {
    const listed = execSync('ps -ax -o pid= -o command=', { encoding: 'utf8' });
    for (const line of listed.split('\n')) {
      const trimmed = line.trim();
      const m = trimmed.match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const cmd = m[2] || '';
      if (!Number.isFinite(pid) || pid === process.pid) continue;
      if (viteChild?.pid && pid === viteChild.pid) continue;

      const inRepo = REPO_MARKERS.some((marker) => cmd.includes(marker));
      const electronish = /Electron/i.test(cmd)
        || /electron\/dist/i.test(cmd)
        || /dist-electron\/main/i.test(cmd);
      if (inRepo && electronish) killPid(pid);
    }
  } catch {
    // ignore
  }

  for (const pattern of [
    'memory-center-doc/sto-claw.*Electron',
    'sto-claw/node_modules/electron/dist/Electron',
    'sto-claw/node_modules/.pnpm/electron@',
    'sto-claw/dist-electron/main',
  ]) {
    spawnSync('pkill', ['-9', '-f', pattern], { stdio: 'ignore' });
  }
}

function shutdown(code) {
  if (shuttingDown) {
    sweepStoClawElectron();
    process.exit(code);
    return;
  }
  shuttingDown = true;

  const vitePid = viteChild?.pid ?? null;

  // Find Electron under vite (vite-plugin mounts it as vite's child).
  let electronPid = null;
  if (vitePid) {
    try {
      const kids = execSync(`pgrep -P ${vitePid}`, { encoding: 'utf8' })
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      for (const kid of kids) {
        try {
          const cmd = execSync(`ps -p ${kid} -o command=`, { encoding: 'utf8' });
          if (/Electron/i.test(cmd) || /electron/i.test(cmd)) {
            electronPid = kid;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (!electronPid && kids[0]) electronPid = kids[0];
    } catch {
      // ignore
    }
  }

  // 1) Ask Electron to quit so OpenIM can logout/unInit.
  if (electronPid) {
    try {
      process.kill(electronPid, 'SIGTERM');
    } catch {
      // ignore
    }
  }

  // 2) Blocking wait (must be sync — async gets aborted when pnpm tears down).
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (!electronPid) break;
    try {
      process.kill(electronPid, 0);
    } catch {
      electronPid = null;
      break;
    }
    spawnSync('sleep', ['0.1'], { stdio: 'ignore' });
  }

  // 3) Hard kill Electron tree + any repo orphans + vite.
  if (electronPid) killTree(electronPid);
  sweepStoClawElectron();
  if (vitePid) killTree(vitePid);
  sweepStoClawElectron();

  process.exit(code);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(0));

const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
viteChild = spawn(process.execPath, [viteBin], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

viteChild.on('exit', (code, signal) => {
  if (shuttingDown) return;
  // Vite exited on its own — still sweep Electron so Dock cannot linger.
  shuttingDown = true;
  sweepStoClawElectron();
  if (signal) {
    process.exit(signal === 'SIGINT' ? 130 : 1);
  }
  process.exit(code ?? 0);
});

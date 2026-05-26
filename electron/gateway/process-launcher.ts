import { app, utilityProcess } from 'electron';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import type { GatewayLaunchContext } from './config-sync';
import type { GatewayLifecycleState } from './process-policy';
import { logger } from '../utils/logger';
import { appendNodeRequireToNodeOptions } from '../utils/paths';

const GATEWAY_FETCH_PRELOAD_SOURCE = `'use strict';
(function () {
  // ── Security: block upgrade/install commands inside Gateway process ──
  // Prevents AI agent from executing openclaw upgrade or package
  // manager install commands that would break the Gateway installation.
  // sai-cli update/upgrade is allowed (standalone binary).

  var BLOCKED_FETCH_URL_PATTERNS = [
    /\\/api\\/v1\\/cli\\/update/i,
    /\\/api\\/v1\\/cli\\/download/i
  ];

  var UPGRADE_ARG_PATTERNS = [
    /\\bupdate\\b/i,
    /\\bupgrade\\b/i,
    /\\binstall\\b.*\\bopenclaw\\b/i,
    /\\binstall\\b.*\\bsai[- ]?cli\\b/i,
    /\\bopenclaw\\b.*\\b(update|upgrade|install)\\b/i,
    /\\bsai[- ]?cli\\b.*\\b(update|upgrade|install)\\b/i,
    /api\\/v1\\/cli\\/(update|download)/i
  ];

  var BLOCKED_BINARIES = /^(openclaw|sai-cli|sai\\.exe)$/i;
  var PKG_MANAGERS = /^(npm|pnpm|yarn|npx)$/i;
  var DOWNLOAD_TOOLS = /^(curl|wget|aria2c)$/i;
  var PYTHON_PKGS = /^(pip|pip3|uv)$/i;
  var PYTHON_BLOCKED_ARGS = /\\bopenclaw\\b|\\bsai[- ]?cli\\b/i;

  function isBlockedCommand(cmd, argsList) {
    var c = typeof cmd === 'string' ? cmd.trim() : '';
    var a = Array.isArray(argsList) ? argsList.join(' ') : '';
    // Allow sai-cli update/upgrade (standalone binary); block install/uninstall/remove only
    if (/^sai-cli$/i.test(c) || /^sai\.exe$/i.test(c)) {
      return /\binstall\b/i.test(a) || /\buninstall\b/i.test(a) || /\bremove\b/i.test(a);
    }
    if (BLOCKED_BINARIES.test(c)) {
      for (var i = 0; i < UPGRADE_ARG_PATTERNS.length; i++) {
        if (UPGRADE_ARG_PATTERNS[i].test(a)) return true;
      }
    }
    if (PKG_MANAGERS.test(c)) {
      for (var i = 0; i < UPGRADE_ARG_PATTERNS.length; i++) {
        if (UPGRADE_ARG_PATTERNS[i].test(a)) return true;
      }
    }
    if (DOWNLOAD_TOOLS.test(c)) {
      for (var i = 0; i < UPGRADE_ARG_PATTERNS.length; i++) {
        if (UPGRADE_ARG_PATTERNS[i].test(a)) return true;
      }
    }
    if (PYTHON_PKGS.test(c) && PYTHON_BLOCKED_ARGS.test(a)) return true;
    return false;
  }

  function securityError(desc) {
    var e = new Error('[StoClaw 安全策略] 禁止在应用内执行升级/安装操作：' + desc);
    e.code = 'EPERM';
    return e;
  }

  // ── Patch globalThis.fetch ────────────────────────────────────────
  var _fetch = globalThis.fetch;
  if (typeof _fetch === 'function' && !globalThis.__clawxFetchPatched) {
    globalThis.__clawxFetchPatched = true;
    globalThis.fetch = function clawxFetch(input, init) {
      var url = typeof input === 'string' ? input
        : (input && typeof input === 'object' && typeof input.url === 'string') ? input.url : '';

      for (var i = 0; i < BLOCKED_FETCH_URL_PATTERNS.length; i++) {
        if (BLOCKED_FETCH_URL_PATTERNS[i].test(url)) throw securityError(url);
      }

      if (url.indexOf('openrouter.ai') !== -1) {
        init = init ? Object.assign({}, init) : {};
        var prev = init.headers;
        var flat = {};
        if (prev && typeof prev.forEach === 'function') {
          prev.forEach(function (v, k) { flat[k] = v; });
        } else if (prev && typeof prev === 'object') {
          Object.assign(flat, prev);
        }
        delete flat['http-referer']; delete flat['HTTP-Referer'];
        delete flat['x-title']; delete flat['X-Title'];
        flat['HTTP-Referer'] = 'https://claw-x.com';
        flat['X-Title'] = 'StoClaw';
        init.headers = flat;
      }
      return _fetch.call(globalThis, input, init);
    };
  }

  // ── Patch child_process ───────────────────────────────────────────
  try {
    var cp = require('child_process');
    if (!cp.__clawxSecurityPatched) {
      cp.__clawxSecurityPatched = true;
      var EventEmitter = require('events').EventEmitter;

      function fakeChild(err) {
        var ch = new EventEmitter();
        ch.stdout = { on: function(){}, pipe: function(){}, resume: function(){}, destroy: function(){} };
        ch.stderr = { on: function(){}, pipe: function(){}, resume: function(){}, destroy: function(){} };
        ch.stdin = { on: function(){}, pipe: function(){}, end: function(){}, write: function(){}, destroy: function(){} };
        ch.kill = function(){};
        ch.pid = undefined;
        ch.connected = false;
        ch.exitCode = 1;
        setImmediate(function() { ch.emit('error', err); ch.emit('close', 1, null); });
        return ch;
      }

      ['spawn', 'exec', 'execFile'].forEach(function(m) {
        var orig = cp[m];
        if (typeof orig !== 'function') return;
        cp[m] = function() {
          var args = Array.prototype.slice.call(arguments);
          var cmd = typeof args[0] === 'string' ? args[0] : '';
          var cmdArgs = Array.isArray(args[1]) ? args[1] : [];
          if (isBlockedCommand(cmd, cmdArgs)) {
            var err = securityError(cmd + ' ' + cmdArgs.join(' '));
            for (var i = args.length - 1; i >= 1; i--) {
              if (typeof args[i] === 'function') {
                setImmediate(function() { args[i](err, '', ''); });
                break;
              }
            }
            return fakeChild(err);
          }
          var optIdx = -1;
          for (var i = 1; i < args.length; i++) {
            if (args[i] && typeof args[i] === 'object' && !Array.isArray(args[i]) && typeof args[i] !== 'function') { optIdx = i; break; }
          }
          if (optIdx >= 0) { args[optIdx].windowsHide = true; }
          else {
            var o = { windowsHide: true };
            if (typeof args[args.length - 1] === 'function') args.splice(args.length - 1, 0, o);
            else args.push(o);
          }
          return orig.apply(this, args);
        };
      });

      ['spawnSync', 'execSync', 'execFileSync'].forEach(function(m) {
        var orig = cp[m];
        if (typeof orig !== 'function') return;
        cp[m] = function() {
          var args = Array.prototype.slice.call(arguments);
          var cmd = typeof args[0] === 'string' ? args[0] : '';
          var cmdArgs = Array.isArray(args[1]) ? args[1] : [];
          if (isBlockedCommand(cmd, cmdArgs)) throw securityError(cmd + ' ' + cmdArgs.join(' '));
          var optIdx = -1;
          for (var i = 1; i < args.length; i++) {
            if (args[i] && typeof args[i] === 'object' && !Array.isArray(args[i])) { optIdx = i; break; }
          }
          if (optIdx >= 0) { args[optIdx].windowsHide = true; }
          else args.push({ windowsHide: true });
          return orig.apply(this, args);
        };
      });
    }
  } catch (e) {
    // child_process not available in this context
  }
})();
`;

function ensureGatewayFetchPreload(): string {
  const dest = path.join(app.getPath('userData'), 'gateway-fetch-preload.cjs');
  try {
    writeFileSync(dest, GATEWAY_FETCH_PRELOAD_SOURCE, 'utf-8');
  } catch {
    // best-effort
  }
  return dest;
}

export async function launchGatewayProcess(options: {
  port: number;
  launchContext: GatewayLaunchContext;
  sanitizeSpawnArgs: (args: string[]) => string[];
  getCurrentState: () => GatewayLifecycleState;
  getShouldReconnect: () => boolean;
  onStderrLine: (line: string) => void;
  onSpawn: (pid: number | undefined) => void;
  onExit: (child: Electron.UtilityProcess, code: number | null) => void;
  onError: (error: Error) => void;
}): Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }> {
  const {
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  } = options.launchContext;

  logger.info(
    `Starting Gateway process (mode=${mode}, port=${options.port}, entry="${entryScript}", args="${options.sanitizeSpawnArgs(gatewayArgs).join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'}, providerKeys=${loadedProviderKeyCount}, channels=${channelStartupSummary}, proxy=${proxySummary})`,
  );
  const lastSpawnSummary = `mode=${mode}, entry="${entryScript}", args="${options.sanitizeSpawnArgs(gatewayArgs).join(' ')}", cwd="${openclawDir}"`;

  const runtimeEnv = { ...forkEnv };
  // Security + OpenRouter preload must apply in ALL modes (dev + production)
  // to block upgrade/install commands inside the Gateway process.
  try {
    const preloadPath = ensureGatewayFetchPreload();
    if (existsSync(preloadPath)) {
      runtimeEnv.NODE_OPTIONS = appendNodeRequireToNodeOptions(
        runtimeEnv.NODE_OPTIONS,
        preloadPath,
      );
    }
  } catch (err) {
    logger.warn('Failed to set up Gateway security preload:', err);
  }

  return await new Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }>((resolve, reject) => {
    const child = utilityProcess.fork(entryScript, gatewayArgs, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: runtimeEnv as NodeJS.ProcessEnv,
      serviceName: 'OpenClaw Gateway',
    });

    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve({ child, lastSpawnSummary });
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.on('error', (error: Error | string) => {
      const err = typeof error === 'string' ? new Error(error) : error;
      logger.error('Gateway process spawn error:', err);
      options.onError(err);
      rejectOnce(err);
    });

    child.on('exit', (code: number) => {
      const expectedExit = !options.getShouldReconnect() || options.getCurrentState() === 'stopped';
      const level = expectedExit ? logger.info : logger.warn;
      level(`Gateway process exited (code=${code}, expected=${expectedExit ? 'yes' : 'no'})`);
      options.onExit(child, code);
    });

    child.stderr?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        options.onStderrLine(line);
      }
    });

    child.on('spawn', () => {
      logger.info(`Gateway process started (pid=${child.pid})`);
      options.onSpawn(child.pid);
      resolveOnce();
    });
  });
}

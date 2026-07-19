/**
 * Gateway child_process preload — bundled to gateway-fetch-preload.cjs.
 * DWS 发送规范化逻辑与 shared/dws-send-text.ts 同源，避免在 process-launcher 内重复维护。
 */
import {
  fixDwsChatMessageSendArgv,
  fixDwsChatMessageSendShellScript,
  parseDwsChatMessageSendShellCommandArgs,
  rewriteDwsSendSpawnInvocation,
} from '../../shared/dws-send-text';

/** Must match electron/utils/sai-client-id.ts — keep inline to avoid pulling Electron utils into preload. */
const SAI_CLIENT_ID_VALUE = 'sto-claw';

// Ensure Agent exec / skill shells inherit client id even if forkEnv was stale.
process.env.SAI_CLIENT_ID = SAI_CLIENT_ID_VALUE;

const DWS_CHAT_MSG_SEND = /dws\s+chat\s+message\s+send\b/i;

function isBlockedDwsSendSpam(cmd: string, argsList: string[]): boolean {
  const full = `${cmd} ${argsList.join(' ')}`;
  if (!DWS_CHAT_MSG_SEND.test(full)) return false;
  if (/--dry-run\b/i.test(full)) return false;
  if ((full.match(/dws\s+chat\s+message\s+send\b/gi)?.length ?? 0) > 1) return true;
  if (/\b(?:for|while|until|seq|xargs)\b/i.test(full) && DWS_CHAT_MSG_SEND.test(full)) return true;
  return false;
}

function normalizeDwsSendInvocation(cmd: string, argsList: string[]): string[] {
  const c = cmd.trim();
  const args = [...argsList];
  if (/^dws(\.exe)?$/i.test(c)) {
    return fixDwsChatMessageSendArgv(args);
  }
  if (/bash|sh|zsh|dash/i.test(c) || /\\bash$|\\sh$/.test(c)) {
    const cIdx = args.indexOf('-c') >= 0 ? args.indexOf('-c') : args.indexOf('/c');
    if (cIdx >= 0 && cIdx + 1 < args.length && typeof args[cIdx + 1] === 'string') {
      const script = args[cIdx + 1];
      if (DWS_CHAT_MSG_SEND.test(script)) {
        const fixedScript = fixDwsChatMessageSendShellScript(script);
        if (fixedScript !== script) {
          const shellCopy = [...args];
          shellCopy[cIdx + 1] = fixedScript;
          return shellCopy;
        }
      }
    }
  }
  if (/powershell/i.test(c)) {
    const cmdIdx = args.findIndex((arg) => /^-command$/i.test(String(arg)));
    if (cmdIdx >= 0 && cmdIdx + 1 < args.length && typeof args[cmdIdx + 1] === 'string') {
      const script = args[cmdIdx + 1];
      if (DWS_CHAT_MSG_SEND.test(script)) {
        const fixedScript = fixDwsChatMessageSendShellScript(script, { execShell: 'powershell' });
        if (fixedScript !== script) {
          const shellCopy = [...args];
          shellCopy[cmdIdx + 1] = fixedScript;
          return shellCopy;
        }
      }
    }
  }
  return args;
}

const BLOCKED_FETCH_URL_PATTERNS = [
  /\/api\/v1\/cli\/update/i,
  /\/api\/v1\/cli\/download/i,
];

const UPGRADE_ARG_PATTERNS = [
  /\bupdate\b/i,
  /\bupgrade\b/i,
  /\binstall\b.*\bopenclaw\b/i,
  /\binstall\b.*\bsai[- ]?cli\b/i,
  /\binstall\b.*\bdws\b/i,
  /\bopenclaw\b.*\b(update|upgrade|install)\b/i,
  /\bsai[- ]?cli\b.*\b(update|upgrade|install)\b/i,
  /\bdws\b.*\b(update|upgrade|install)\b/i,
  /api\/v1\/cli\/(update|download)/i,
];

const BLOCKED_BINARIES = /^(openclaw|sai-cli|sai\.exe|dws|dws\.exe)$/i;
const PKG_MANAGERS = /^(npm|pnpm|yarn|npx)$/i;
const DOWNLOAD_TOOLS = /^(curl|wget|aria2c)$/i;
const PYTHON_PKGS = /^(pip|pip3|uv)$/i;
const PYTHON_BLOCKED_ARGS = /\bopenclaw\b|\bsai[- ]?cli\b|\bdws\b/i;

function isBlockedUpgradeCommand(cmd: string, argsList: string[]): boolean {
  const a = argsList.join(' ');
  if (/^sai-cli$/i.test(cmd) || /^sai\.exe$/i.test(cmd)) {
    return /\binstall\b/i.test(a) || /\buninstall\b/i.test(a) || /\bremove\b/i.test(a);
  }
  if (/^dws$/i.test(cmd) || /^dws\.exe$/i.test(cmd)) {
    return /\b(upgrade|install|uninstall|remove)\b/i.test(a);
  }
  if (BLOCKED_BINARIES.test(cmd)) {
    return UPGRADE_ARG_PATTERNS.some((pattern) => pattern.test(a));
  }
  if (PKG_MANAGERS.test(cmd)) {
    return UPGRADE_ARG_PATTERNS.some((pattern) => pattern.test(a));
  }
  if (DOWNLOAD_TOOLS.test(cmd)) {
    return UPGRADE_ARG_PATTERNS.some((pattern) => pattern.test(a));
  }
  if (PYTHON_PKGS.test(cmd) && PYTHON_BLOCKED_ARGS.test(a)) return true;
  return false;
}

function securityError(desc: string): Error {
  const e = new Error(`[StoClaw 安全策略] ${desc}`);
  (e as NodeJS.ErrnoException).code = 'EPERM';
  return e;
}

function upgradeSecurityError(desc: string): Error {
  return securityError(`禁止在应用内执行升级/安装操作：${desc}`);
}

function resolveBlockedSpawnError(cmd: string, argsList: string[]): Error | null {
  if (isBlockedDwsSendSpam(cmd, argsList)) {
    return securityError('禁止通过循环或批量命令多次调用 dws chat message send。请一次只发送一条消息。');
  }
  if (isBlockedUpgradeCommand(cmd, argsList)) {
    return upgradeSecurityError(`${cmd} ${argsList.join(' ')}`);
  }
  return null;
}

function patchFetch(): void {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function' || (globalThis as { __clawxFetchPatched?: boolean }).__clawxFetchPatched) {
    return;
  }
  (globalThis as { __clawxFetchPatched?: boolean }).__clawxFetchPatched = true;
  globalThis.fetch = function clawxFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string'
      ? input
      : (input && typeof input === 'object' && 'url' in input && typeof input.url === 'string')
        ? input.url
        : '';

    for (const pattern of BLOCKED_FETCH_URL_PATTERNS) {
      if (pattern.test(url)) throw upgradeSecurityError(url);
    }

    if (url.includes('openrouter.ai')) {
      const nextInit = init ? { ...init } : {};
      const prev = nextInit.headers;
      const flat: Record<string, string> = {};
      if (prev && typeof (prev as Headers).forEach === 'function') {
        (prev as Headers).forEach((v, k) => { flat[k] = v; });
      } else if (prev && typeof prev === 'object') {
        Object.assign(flat, prev);
      }
      delete flat['http-referer'];
      delete flat['HTTP-Referer'];
      delete flat['x-title'];
      delete flat['X-Title'];
      flat['HTTP-Referer'] = 'https://claw-x.com';
      flat['X-Title'] = 'StoClaw';
      nextInit.headers = flat;
      return originalFetch.call(globalThis, input, nextInit);
    }
    return originalFetch.call(globalThis, input, init);
  };
}

function injectSaiClientIdIntoSpawnOptions(options: { env?: NodeJS.ProcessEnv }): void {
  const env = options.env && typeof options.env === 'object'
    ? { ...options.env }
    : { ...process.env };
  env.SAI_CLIENT_ID = SAI_CLIENT_ID_VALUE;
  options.env = env;
}

function patchChildProcess(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require('child_process') as typeof import('child_process') & { __clawxSecurityPatched?: boolean };
  if (cp.__clawxSecurityPatched) return;
  cp.__clawxSecurityPatched = true;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const EventEmitter = require('events').EventEmitter as typeof import('events').EventEmitter;
  const originalExecFile = cp.execFile.bind(cp);
  const originalExecFileSync = cp.execFileSync.bind(cp);

  function fakeChild(err: Error) {
    const ch = new EventEmitter() as import('child_process').ChildProcess;
    ch.stdout = { on() {}, pipe() {}, resume() {}, destroy() {} } as NodeJS.ReadableStream;
    ch.stderr = { on() {}, pipe() {}, resume() {}, destroy() {} } as NodeJS.ReadableStream;
    ch.stdin = { on() {}, pipe() {}, end() {}, write() {}, destroy() {} } as NodeJS.WritableStream;
    ch.kill = () => true;
    ch.pid = undefined;
    ch.connected = false;
    ch.exitCode = 1;
    setImmediate(() => {
      ch.emit('error', err);
      ch.emit('close', 1, null);
    });
    return ch;
  }

  (['spawn', 'exec', 'execFile'] as const).forEach((method) => {
    const original = cp[method].bind(cp);
    cp[method] = ((...args: unknown[]) => {
      const mutable = [...args];
      let cmd = typeof mutable[0] === 'string' ? mutable[0] : '';
      let cmdArgs = Array.isArray(mutable[1]) ? (mutable[1] as string[]) : [];

      if (method === 'exec' || method === 'execFile') {
        if (typeof mutable[0] === 'string' && DWS_CHAT_MSG_SEND.test(mutable[0])) {
          if (process.platform === 'win32') {
            const parsedArgs = parseDwsChatMessageSendShellCommandArgs(mutable[0]);
            if (parsedArgs) {
              const blockedErr = resolveBlockedSpawnError('dws', parsedArgs);
              if (blockedErr) {
                for (let i = mutable.length - 1; i >= 1; i -= 1) {
                  if (typeof mutable[i] === 'function') {
                    const cb = mutable[i] as (err: Error) => void;
                    setImmediate(() => cb(blockedErr));
                    break;
                  }
                }
                return fakeChild(blockedErr);
              }

              const execFileArgs: unknown[] = ['dws', parsedArgs];
              for (let i = 1; i < mutable.length; i += 1) {
                execFileArgs.push(mutable[i]);
              }
              return originalExecFile(...(execFileArgs as Parameters<typeof originalExecFile>));
            }
            mutable[0] = fixDwsChatMessageSendShellScript(mutable[0], { execShell: 'powershell' });
            cmd = mutable[0] as string;
          } else {
            mutable[0] = fixDwsChatMessageSendShellScript(mutable[0]);
            cmd = mutable[0] as string;
          }
        }
      } else if (Array.isArray(mutable[1])) {
        const rewritten = rewriteDwsSendSpawnInvocation(cmd, cmdArgs);
        if (rewritten) {
          mutable[0] = rewritten.cmd;
          mutable[1] = rewritten.args;
          cmd = rewritten.cmd;
          cmdArgs = rewritten.args;
        } else {
          mutable[1] = normalizeDwsSendInvocation(cmd, cmdArgs);
          cmdArgs = mutable[1] as string[];
        }
      }

      const blockedErr = resolveBlockedSpawnError(cmd, cmdArgs);
      if (blockedErr) {
        for (let i = mutable.length - 1; i >= 1; i -= 1) {
          if (typeof mutable[i] === 'function') {
            const cb = mutable[i] as (err: Error) => void;
            setImmediate(() => cb(blockedErr));
            break;
          }
        }
        return fakeChild(blockedErr);
      }

      let optIdx = -1;
      for (let i = 1; i < mutable.length; i += 1) {
        if (mutable[i] && typeof mutable[i] === 'object' && !Array.isArray(mutable[i]) && typeof mutable[i] !== 'function') {
          optIdx = i;
          break;
        }
      }
      if (optIdx >= 0) {
        const options = mutable[optIdx] as { windowsHide?: boolean; env?: NodeJS.ProcessEnv };
        options.windowsHide = true;
        injectSaiClientIdIntoSpawnOptions(options);
      } else {
        const options: { windowsHide: boolean; env: NodeJS.ProcessEnv } = {
          windowsHide: true,
          env: { ...process.env, SAI_CLIENT_ID: SAI_CLIENT_ID_VALUE },
        };
        if (typeof mutable[mutable.length - 1] === 'function') mutable.splice(mutable.length - 1, 0, options);
        else mutable.push(options);
      }
      return original(...(mutable as Parameters<typeof original>));
    }) as typeof cp[typeof method];
  });

  (['spawnSync', 'execSync', 'execFileSync'] as const).forEach((method) => {
    const original = cp[method].bind(cp);
    cp[method] = ((...args: unknown[]) => {
      const mutable = [...args];
      let cmd = typeof mutable[0] === 'string' ? mutable[0] : '';
      let cmdArgs = Array.isArray(mutable[1]) ? (mutable[1] as string[]) : [];

      if (method === 'execSync' || method === 'execFileSync') {
        if (typeof mutable[0] === 'string' && DWS_CHAT_MSG_SEND.test(mutable[0])) {
          if (process.platform === 'win32') {
            const parsedArgs = parseDwsChatMessageSendShellCommandArgs(mutable[0]);
            if (parsedArgs) {
              const blockedErr = resolveBlockedSpawnError('dws', parsedArgs);
              if (blockedErr) throw blockedErr;

              const execFileArgs: unknown[] = ['dws', parsedArgs];
              for (let i = 1; i < mutable.length; i += 1) {
                execFileArgs.push(mutable[i]);
              }
              return originalExecFileSync(...(execFileArgs as Parameters<typeof originalExecFileSync>));
            }
            mutable[0] = fixDwsChatMessageSendShellScript(mutable[0], { execShell: 'powershell' });
            cmd = mutable[0] as string;
          } else {
            mutable[0] = fixDwsChatMessageSendShellScript(mutable[0]);
            cmd = mutable[0] as string;
          }
        }
      } else if (Array.isArray(mutable[1])) {
        const rewritten = rewriteDwsSendSpawnInvocation(cmd, cmdArgs);
        if (rewritten) {
          mutable[0] = rewritten.cmd;
          mutable[1] = rewritten.args;
          cmd = rewritten.cmd;
          cmdArgs = rewritten.args;
        } else {
          mutable[1] = normalizeDwsSendInvocation(cmd, cmdArgs);
          cmdArgs = mutable[1] as string[];
        }
      }

      const blockedErr = resolveBlockedSpawnError(cmd, cmdArgs);
      if (blockedErr) throw blockedErr;

      let optIdx = -1;
      for (let i = 1; i < mutable.length; i += 1) {
        if (mutable[i] && typeof mutable[i] === 'object' && !Array.isArray(mutable[i])) {
          optIdx = i;
          break;
        }
      }
      if (optIdx >= 0) {
        const options = mutable[optIdx] as { windowsHide?: boolean; env?: NodeJS.ProcessEnv };
        options.windowsHide = true;
        injectSaiClientIdIntoSpawnOptions(options);
      } else {
        mutable.push({
          windowsHide: true,
          env: { ...process.env, SAI_CLIENT_ID: SAI_CLIENT_ID_VALUE },
        });
      }
      return original(...(mutable as Parameters<typeof original>));
    }) as typeof cp[typeof method];
  });
}

patchFetch();
try {
  patchChildProcess();
} catch {
  // child_process not available in this context
}

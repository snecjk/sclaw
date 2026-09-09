import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { join, normalize } from 'node:path';
import { buildWindowsHDrop } from './clipboard-rich-write';
import { getOpenClawResolvedDir } from './paths';
import { buildSilentPowerShellArgs } from './win-shell';

const execFileAsync = promisify(execFile);
const localRequire = createRequire(import.meta.url);

const CF_HDROP = 15;
const GMEM_MOVEABLE = 0x0002;

type KoffiModule = typeof import('koffi');

let koffiWriter: ((filePaths: string[]) => void) | null | undefined;

function normalizeWindowsClipboardPaths(filePaths: string[]): string[] {
  return filePaths.map((path) => normalize(path.trim())).filter(Boolean);
}

function resolveKoffiModule(): KoffiModule | null {
  if (process.platform !== 'win32') return null;

  const requireRoots: string[] = [];
  const openclawDir = getOpenClawResolvedDir();
  requireRoots.push(join(openclawDir, 'package.json'));
  if (openclawDir.endsWith('.asar')) {
    requireRoots.push(join(`${openclawDir}.unpacked`, 'package.json'));
  }

  for (const root of requireRoots) {
    try {
      const openclawRequire = createRequire(root);
      return openclawRequire('koffi') as KoffiModule;
    } catch {
      // try next resolution root
    }
  }

  try {
    return localRequire('koffi') as KoffiModule;
  } catch {
    return null;
  }
}

function loadKoffiWriter(): ((filePaths: string[]) => void) | null {
  if (koffiWriter !== undefined) return koffiWriter;
  if (process.platform !== 'win32') {
    koffiWriter = null;
    return null;
  }

  try {
    const koffi = resolveKoffiModule();
    if (!koffi) {
      koffiWriter = null;
      return null;
    }

    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    const OpenClipboard = user32.func('bool __stdcall OpenClipboard(void *hWndNewOwner)');
    const CloseClipboard = user32.func('bool __stdcall CloseClipboard()');
    const EmptyClipboard = user32.func('bool __stdcall EmptyClipboard()');
    const SetClipboardData = user32.func('void * __stdcall SetClipboardData(uint32 uFormat, void *hMem)');

    const GlobalAlloc = kernel32.func('void * __stdcall GlobalAlloc(uint32 uFlags, size_t dwBytes)');
    const GlobalLock = kernel32.func('void * __stdcall GlobalLock(void *hMem)');
    const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(void *hMem)');
    const GlobalFree = kernel32.func('void * __stdcall GlobalFree(void *hMem)');
    const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(void *dest, void *src, size_t length)');

    koffiWriter = (filePaths: string[]) => {
      const paths = normalizeWindowsClipboardPaths(filePaths);
      if (paths.length === 0) return;

      const payload = buildWindowsHDrop(paths);
      const size = payload.length;

      const hGlobal = GlobalAlloc(GMEM_MOVEABLE, size);
      if (!hGlobal) throw new Error('GlobalAlloc failed for CF_HDROP');

      const locked = GlobalLock(hGlobal);
      if (!locked) {
        GlobalFree(hGlobal);
        throw new Error('GlobalLock failed for CF_HDROP');
      }

      let clipboardOpened = false;
      try {
        RtlMoveMemory(locked, payload, size);
        if (!GlobalUnlock(hGlobal)) {
          GlobalFree(hGlobal);
          throw new Error('GlobalUnlock failed for CF_HDROP');
        }

        if (!OpenClipboard(0)) {
          GlobalFree(hGlobal);
          throw new Error('OpenClipboard failed');
        }
        clipboardOpened = true;

        EmptyClipboard();
        const result = SetClipboardData(CF_HDROP, hGlobal);
        if (!result) {
          GlobalFree(hGlobal);
          throw new Error('SetClipboardData(CF_HDROP) failed');
        }
      } catch (error) {
        if (!clipboardOpened) {
          try { GlobalUnlock(hGlobal); } catch { /* ignore */ }
          GlobalFree(hGlobal);
        }
        throw error;
      } finally {
        if (clipboardOpened) CloseClipboard();
      }
    };
  } catch {
    koffiWriter = null;
  }

  return koffiWriter;
}

/** Build a Set-Clipboard script that works in PowerShell Constrained Language Mode. */
export function buildSetClipboardLiteralPathScript(filePaths: string[]): string {
  const paths = normalizeWindowsClipboardPaths(filePaths);
  const quoted = paths.map((path) => `'${path.replace(/'/g, "''")}'`);
  return `Set-Clipboard -LiteralPath @(${quoted.join(',')})`;
}

export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function writeViaSetClipboardCmdlet(filePaths: string[]): Promise<void> {
  const paths = normalizeWindowsClipboardPaths(filePaths);
  if (paths.length === 0) return;

  const script = buildSetClipboardLiteralPathScript(paths);
  await execFileAsync(
    'powershell.exe',
    buildSilentPowerShellArgs(['-EncodedCommand', encodePowerShellCommand(script)]),
    { windowsHide: true, timeout: 20000 },
  );
}

/** Write local file paths to the Windows clipboard so Explorer accepts Ctrl+V paste. */
export async function writeWindowsFilePathsToClipboard(filePaths: string[]): Promise<void> {
  const paths = normalizeWindowsClipboardPaths(filePaths);
  if (paths.length === 0) return;

  const writer = loadKoffiWriter();
  if (writer) {
    try {
      writer(paths);
      return;
    } catch {
      // Fall back to Set-Clipboard cmdlet (CLM-safe).
    }
  }

  await writeViaSetClipboardCmdlet(paths);
}

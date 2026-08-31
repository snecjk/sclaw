import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const SHELL_PATH_EXPANSION = /(?:\$\(|`|\$\{?(?:HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|PWD)\}?|\$env:|%(?:USERPROFILE|HOMEDRIVE|HOMEPATH|CD)%|(?:^|\s)~[/\\])/i;

/** Resolve symlinks for existing paths and the closest existing parent for new files. */
export async function canonicalPiToolPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    let cursor = absolute;
    while (dirname(cursor) !== cursor) {
      cursor = dirname(cursor);
      try {
        const existing = await realpath(cursor);
        return resolve(existing, relative(cursor, absolute));
      } catch {
        // Continue to the closest existing parent.
      }
    }
    return absolute;
  }
}

export async function isPiToolPathAllowed(path: string, roots: string[]): Promise<boolean> {
  const candidate = await canonicalPiToolPath(path);
  for (const root of roots) {
    const canonical = await canonicalPiToolPath(root);
    const child = relative(canonical, candidate);
    if (child === '' || (!child.startsWith('..') && !isAbsolute(child))) return true;
  }
  return false;
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote: '"' | "'" | null = null;
  const flush = () => {
    const value = token.trim().replace(/^[(),]+|[(),]+$/g, '');
    if (value) tokens.push(value);
    token = '';
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if ((char === '"' || char === "'") && command[index - 1] !== '\\') {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      else token += char;
      continue;
    }
    if (!quote && (/\s/.test(char) || /[;&|<>]/.test(char))) {
      flush();
      continue;
    }
    token += char;
  }
  flush();
  return tokens;
}

/** Extract paths that are absolute for the requested host platform. */
export function extractScheduledCommandAbsolutePaths(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const values = new Set<string>();
  for (const token of tokenizeShellCommand(command)) {
    const candidates = [token, token.includes('=') ? token.slice(token.indexOf('=') + 1) : ''];
    for (const candidate of candidates) {
      if (!candidate || /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) continue;
      const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(candidate)
        || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(candidate)
        || /^[\\/][^\\/]/.test(candidate);
      const posixAbsolute = candidate.startsWith('/');
      if (platform === 'win32' ? windowsAbsolute : posixAbsolute) values.add(candidate);
    }
  }
  return [...values];
}

export async function piBashViolatesScheduledPolicy(
  command: string,
  roots: string[],
): Promise<boolean> {
  if (/\b(?:sudo|shutdown|reboot|diskpart|format|mkfs|reg\s+delete)\b/i.test(command)) return true;
  if (/(?:^|[\s/\\])\.\.(?:[/\\]|\s|$)/.test(command)) return true;
  if (SHELL_PATH_EXPANSION.test(command)) return true;
  const absolutePaths = extractScheduledCommandAbsolutePaths(command);
  for (const value of absolutePaths) {
    if (!(await isPiToolPathAllowed(value, roots))) return true;
  }
  return false;
}

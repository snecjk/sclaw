import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function getClaudeBinaryName(): string {
  return process.platform === 'win32' ? 'claude.exe' : 'claude';
}

function getClaudeNativePackageName(): string {
  return `claude-agent-sdk-${process.platform}-${process.arch}`;
}

function getClaudeNativePackageSpecifier(): string {
  return `@anthropic-ai/${getClaudeNativePackageName()}`;
}

function firstExistingPath(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveInstalledClaudeExecutablePath(binaryName: string): string | undefined {
  try {
    return require.resolve(`${getClaudeNativePackageSpecifier()}/${binaryName}`);
  } catch {
    return undefined;
  }
}

export function getClaudeExecutablePath(): string | undefined {
  const binaryName = getClaudeBinaryName();
  const nativePackageName = getClaudeNativePackageName();

  return firstExistingPath([
    process.resourcesPath
      ? join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@anthropic-ai',
        nativePackageName,
        binaryName,
      )
      : undefined,
    join(process.cwd(), 'node_modules', '@anthropic-ai', nativePackageName, binaryName),
    resolveInstalledClaudeExecutablePath(binaryName),
  ]);
}

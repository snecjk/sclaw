import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export function buildTarGzExtractInvocation(
  archivePath: string,
  destDir: string,
  platform: NodeJS.Platform = process.platform,
): { args: string[]; cwd: string } {
  const pathApi = platform === 'win32' ? win32 : posix;
  const cwd = pathApi.dirname(archivePath);
  const relativeDest = pathApi.relative(cwd, destDir) || '.';
  const destOperand = platform === 'win32'
    ? relativeDest.replace(/\\/g, '/')
    : relativeDest;
  return {
    // GNU tar on Windows does not reliably accept drive-letter paths in either
    // the archive operand or `-C`. Keep both operands relative to `cwd`.
    args: ['-xzf', pathApi.basename(archivePath), '-C', destOperand],
    cwd,
  };
}

export function extractTarGz(archivePath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const invocation = buildTarGzExtractInvocation(archivePath, destDir);
  const result = spawnSync('tar', invocation.args, {
    cwd: invocation.cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || '解压 tar.gz 失败');
  }
}

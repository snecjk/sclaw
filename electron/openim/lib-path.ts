import { app } from 'electron';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger';

const require = createRequire(import.meta.url);

function getLibSuffix(): string {
  const platform = process.platform;
  const arch = os.arch();
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return join(`mac_${arch}`, 'libopenimsdk.dylib');
  }
  if (platform === 'win32' && arch === 'x64') {
    return join('win_x64', 'libopenimsdk.dll');
  }
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    return join(`linux_${arch}`, 'libopenimsdk.so');
  }
  throw new Error(`Unsupported OpenIM SDK platform: ${platform}/${arch}`);
}

function resolveFromPackageJson(): string | null {
  try {
    const pkgJson = require.resolve('@openim/electron-client-sdk/package.json');
    return join(dirname(pkgJson), 'assets', getLibSuffix());
  } catch {
    return null;
  }
}

/** Resolve native OpenIM library path for dev and packaged builds. */
export function resolveOpenIMLibPath(): string | null {
  const suffix = getLibSuffix();
  const fromPackage = resolveFromPackageJson();
  const candidates = [
    fromPackage,
    join(app.getAppPath(), 'node_modules', '@openim', 'electron-client-sdk', 'assets', suffix),
    join(__dirname, '../../node_modules/@openim/electron-client-sdk/assets', suffix),
    join(process.cwd(), 'node_modules', '@openim/electron-client-sdk', 'assets', suffix),
    join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@openim',
      'electron-client-sdk',
      'assets',
      suffix,
    ),
    join(process.resourcesPath, 'openim-sdk', suffix),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      logger.info(`[OpenIM] Using native library: ${candidate}`);
      return candidate;
    }
  }

  const message = `[OpenIM] Native library not found. appPath=${app.getAppPath()} cwd=${process.cwd()} tried=${candidates.join(' | ')}`;
  logger.error(message);
  console.error(message);
  return null;
}

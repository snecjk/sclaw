import { app, utilityProcess } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { GatewayLaunchContext } from './config-sync';
import type { GatewayLifecycleState } from './process-policy';
import { logger } from '../utils/logger';
import { appendNodeRequireToNodeOptions } from '../utils/paths';

function resolveBundledGatewayPreloadPath(): string | null {
  const candidates = [
    path.join(__dirname, 'gateway-fetch-preload.cjs'),
    path.join(__dirname, '..', 'gateway', 'gateway-fetch-preload.cjs'),
    path.join(app.getAppPath(), 'electron', 'gateway', 'gateway-fetch-preload.cjs'),
    path.join(app.getAppPath(), 'gateway-fetch-preload.cjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function ensureGatewayFetchPreload(): string {
  const dest = path.join(app.getPath('userData'), 'gateway-fetch-preload.cjs');
  const bundled = resolveBundledGatewayPreloadPath();
  if (!bundled) {
    logger.warn('gateway-fetch-preload.cjs not found; Gateway security preload disabled');
    return dest;
  }
  try {
    writeFileSync(dest, readFileSync(bundled, 'utf-8'), 'utf-8');
  } catch (err) {
    logger.warn('Failed to copy Gateway preload to userData:', err);
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
  onStdoutLine: (line: string) => void;
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

    // stdout MUST be drained: piped streams start paused, and once the OS
    // pipe buffer fills (as small as 4KB on Windows) any write to stdout
    // blocks the whole Gateway process — it then misses heartbeats and gets
    // force-restarted, showing up as random mid-run Gateway interruptions.
    child.stdout?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        options.onStdoutLine(line);
      }
    });

    child.on('spawn', () => {
      logger.info(`Gateway process started (pid=${child.pid})`);
      options.onSpawn(child.pid);
      resolveOnce();
    });
  });
}

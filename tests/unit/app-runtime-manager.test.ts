import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  spawnMock,
  startDevServer,
  stopDevServer,
  getDevServer,
  getDevServerLogs,
  allocateDevServerPort,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  startDevServer: vi.fn(async () => ({
    previewUrl: 'http://127.0.0.1:5173/',
    child: { exitCode: null },
  })),
  stopDevServer: vi.fn(),
  getDevServer: vi.fn(() => null),
  getDevServerLogs: vi.fn(() => ['vite ready']),
  allocateDevServerPort: vi.fn(async () => 18787),
}));

vi.mock('../../electron/services/app-dev-server-manager', () => ({
  startDevServer,
  stopDevServer,
  getDevServer,
  getDevServerLogs,
  allocateDevServerPort,
}));

vi.mock('../../electron/utils/node-runtime', () => ({
  getManagedNodePaths: () => ({ npmBin: '/mock/npm' }),
  getNodeSpawnEnv: () => ({ PATH: '/usr/bin' }),
}));

vi.mock('../../electron/services/app-dev-secrets', () => ({
  getAppDevSecretsEnv: vi.fn(async () => ({})),
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('electron', () => ({
  app: { on: vi.fn() },
}));

vi.mock('../../electron/utils/config', () => ({
  getPort: vi.fn(() => 18765),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const spawn = (...args: unknown[]) => spawnMock(...args);
  return {
    ...actual,
    spawn,
    default: {
      ...actual,
      spawn,
    },
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => JSON.stringify({ version: 'v1', proxies: [] })),
    writeFile: vi.fn(async () => undefined),
  };
});

describe('app-runtime-manager', () => {
  beforeEach(() => {
    startDevServer.mockClear();
    stopDevServer.mockClear();
    spawnMock.mockReset();
    allocateDevServerPort.mockClear();
    getDevServer.mockImplementation((workspaceId: string) => {
      if (startDevServer.mock.calls.some((c) => c[0] === workspaceId)) {
        return {
          appPath: 'mock-app',
          previewUrl: 'http://127.0.0.1:5173/',
          child: { exitCode: null },
          stopping: false,
        };
      }
      return null;
    });
  });

  it('startRuntime migrates, starts backend, then frontend; stop clears both', async () => {
    const migrateChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid: number;
      kill: ReturnType<typeof vi.fn>;
    };
    migrateChild.stdout = new EventEmitter();
    migrateChild.stderr = new EventEmitter();
    migrateChild.pid = 101;
    migrateChild.kill = vi.fn();

    const backendChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid: number;
      exitCode: null;
      kill: ReturnType<typeof vi.fn>;
    };
    backendChild.stdout = new EventEmitter();
    backendChild.stderr = new EventEmitter();
    backendChild.pid = 102;
    backendChild.exitCode = null;
    backendChild.kill = vi.fn();

    let spawnCount = 0;
    spawnMock.mockImplementation(() => {
      spawnCount += 1;
      if (spawnCount === 1) {
        queueMicrotask(() => migrateChild.emit('close', 0));
        return migrateChild;
      }
      return backendChild;
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })));

    const { startRuntime, stopRuntime, getRuntimeStatus, getRuntimeLogs } = await import(
      '../../electron/services/app-runtime-manager'
    );

    stopRuntime('ws-rt');
    const appPath = join(process.cwd(), 'resources', 'app-templates', 'site-fullstack');
    const status = await startRuntime('ws-rt', appPath);
    expect(status.phase).toBe('ready');
    expect(status.backendUrl).toBe('http://127.0.0.1:18787');
    expect(startDevServer).toHaveBeenCalledWith('ws-rt', appPath);
    expect(getRuntimeStatus('ws-rt', appPath).backendRunning).toBe(true);

    const logs = getRuntimeLogs('ws-rt');
    expect(logs.some((l) => l.includes('[frontend]'))).toBe(true);

    stopRuntime('ws-rt');
    expect(stopDevServer).toHaveBeenCalledWith('ws-rt');
    vi.unstubAllGlobals();
  });

  it('drainBackendErrors keeps repair-worthy lines only', async () => {
    const migrateChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid: number;
      kill: ReturnType<typeof vi.fn>;
    };
    migrateChild.stdout = new EventEmitter();
    migrateChild.stderr = new EventEmitter();
    migrateChild.pid = 201;
    migrateChild.kill = vi.fn();

    const backendChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid: number;
      exitCode: null;
      kill: ReturnType<typeof vi.fn>;
    };
    backendChild.stdout = new EventEmitter();
    backendChild.stderr = new EventEmitter();
    backendChild.pid = 202;
    backendChild.exitCode = null;
    backendChild.kill = vi.fn();

    let spawnCount = 0;
    spawnMock.mockImplementation(() => {
      spawnCount += 1;
      if (spawnCount === 1) {
        queueMicrotask(() => migrateChild.emit('close', 0));
        return migrateChild;
      }
      return backendChild;
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })));

    const { startRuntime, stopRuntime, drainBackendErrors, buildBackendRepairPrompt } = await import(
      '../../electron/services/app-runtime-manager'
    );

    stopRuntime('ws-err');
    const appPath = join(process.cwd(), 'resources', 'app-templates', 'site-fullstack');
    await startRuntime('ws-err', appPath);

    backendChild.stderr.emit('data', Buffer.from('[tsx] Restarting...\nSQLITE_ERROR: boom\n'));
    const drained = drainBackendErrors('ws-err');
    expect(drained.some((l) => l.includes('SQLITE_ERROR'))).toBe(true);
    expect(drained.some((l) => l.includes('[tsx]'))).toBe(false);
    expect(buildBackendRepairPrompt(drained)).toContain('自动修复');

    stopRuntime('ws-err');
    vi.unstubAllGlobals();
  });
});

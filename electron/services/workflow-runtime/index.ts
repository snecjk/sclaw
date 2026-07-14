/**
 * workflow-runtime IPC 暴露 + Electron 主进程注册（Plan 2 Task 12）。
 *
 * 主进程启动时：engine.recover()（收口在途 run）+ engine.startSync()（起 outbox flushLoop）。
 * renderer 经 IPC：workflow-runtime:start / :resume / :cancel / :resumeApproval。
 */
import { ipcMain } from 'electron';
import { createEngine, type EngineDeps } from './engine';

export interface RuntimeHandlers {
  start: (a: any) => Promise<void>;
  resume: (runId: string) => Promise<void>;
  cancel: (runId: string, nodeId: string) => void;
  recover: () => Promise<void>;
  startSync: () => void;
  stopSync: () => void;
}

export function registerWorkflowRuntimeHandlers(deps: EngineDeps): RuntimeHandlers {
  const engine = createEngine(deps);
  ipcMain.handle('workflow-runtime:start', async (_e, a) => { await engine.startRun(a); });
  ipcMain.handle('workflow-runtime:resume', async (_e, runId: string) => { await engine.resumeRun(runId); });
  ipcMain.handle('workflow-runtime:cancel', async (_e, { runId, nodeId }: { runId: string; nodeId: string }) => { engine.cancel(runId, nodeId); });
  ipcMain.handle('workflow-runtime:resumeApproval', async (_e, { runId, nodeId, decision }: any) => { await engine.resumeApproval(runId, nodeId, decision); });
  return {
    start: (a) => engine.startRun(a),
    resume: (runId) => engine.resumeRun(runId),
    cancel: (runId, nodeId) => engine.cancel(runId, nodeId),
    recover: () => engine.recover(),
    startSync: () => engine.startSync(),
    stopSync: () => engine.stopSync(),
  };
}

import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import type { GatewayManager } from '../../gateway/manager';

import { agentMemoryOrchestrator } from '../../services/agent-memory-orchestrator';
import { memoryCaptureService, type MemoryCaptureInput } from '../../services/memory-capture-service';

export function registerAgentMemoryHandlers(gatewayManager: GatewayManager): void {
  void memoryCaptureService.recover(gatewayManager).catch(() => undefined);
  ipcMain.handle('agent-memory:initialize', async () => {
    return await agentMemoryOrchestrator.initialize();
  });

  ipcMain.handle('agent-memory:status', async () => {
    return await agentMemoryOrchestrator.getStatus();
  });

  ipcMain.handle('agent-memory:bootstrap', async (_event: IpcMainInvokeEvent, forceRefresh?: boolean) => {
    return await agentMemoryOrchestrator.getBootstrap(forceRefresh === true);
  });

  ipcMain.handle('agent-memory:index', async (_event: IpcMainInvokeEvent, records: unknown) => {
    return await agentMemoryOrchestrator.indexRecords(
      Array.isArray(records) ? records : [],
    );
  });

  ipcMain.handle(
    'agent-memory:add',
    async (
      _event: IpcMainInvokeEvent,
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
      options?: {
        userId?: string;
        agentId?: string;
        runId?: string;
        metadata?: Record<string, unknown>;
        infer?: boolean;
      },
    ) => {
      return await agentMemoryOrchestrator.addMemories(Array.isArray(messages) ? messages : [], options);
    },
  );

  ipcMain.handle(
    'agent-memory:search',
    async (_event: IpcMainInvokeEvent, query: string, options?: Record<string, unknown>) => {
    return await agentMemoryOrchestrator.search(query, options as {
      topK?: number;
      agentId?: string;
      sessionId?: string;
      memoryTypes?: string[];
    });
    },
  );

  ipcMain.handle('agent-memory:delete', async (_event: IpcMainInvokeEvent, recordIds: string[]) => {
    return await agentMemoryOrchestrator.delete(Array.isArray(recordIds) ? recordIds : []);
  });

  ipcMain.handle(
    'agent-memory:mem0-search',
    async (
      _event: IpcMainInvokeEvent,
      query: string,
      options: { userId?: string; agentId?: string; runId?: string; topK?: number },
    ) => {
      return await agentMemoryOrchestrator.searchMemories(query, options ?? {});
    },
  );

  ipcMain.handle(
    'agent-memory:mem0-list',
    async (
      _event: IpcMainInvokeEvent,
      options: { userId?: string; agentId?: string; runId?: string; topK?: number },
    ) => {
      return await agentMemoryOrchestrator.getAllMemories(options ?? {});
    },
  );

  ipcMain.handle('agent-memory:mem0-delete', async (_event: IpcMainInvokeEvent, memoryId: string) => {
    return await agentMemoryOrchestrator.deleteMemory(memoryId);
  });

  ipcMain.handle(
    'agent-memory:mem0-delete-all',
    async (_event: IpcMainInvokeEvent, options: { userId?: string; agentId?: string; runId?: string }) => {
      return await agentMemoryOrchestrator.deleteAllMemories(options ?? {});
    },
  );

  ipcMain.handle('agent-memory:mem0-history', async (_event: IpcMainInvokeEvent, memoryId: string) => {
    return await agentMemoryOrchestrator.getMemoryHistory(memoryId);
  });

  ipcMain.handle('agent-memory:mem0-reset', async () => {
    return await agentMemoryOrchestrator.resetMemories();
  });

  ipcMain.handle(
    'agent-memory:summarize-execution-experience',
    async (_event: IpcMainInvokeEvent, input: Record<string, unknown>) => {
      return await agentMemoryOrchestrator.summarizeExecutionExperience(
        input && typeof input === 'object' ? input : {},
      );
    },
  );

  ipcMain.handle(
    'agent-memory:capture',
    async (_event: IpcMainInvokeEvent, input: MemoryCaptureInput) => {
      await memoryCaptureService.capture(input, gatewayManager);
      return { accepted: true };
    },
  );

  ipcMain.handle(
    'execution-memory:bind-injected-memories',
    async (_event: IpcMainInvokeEvent, input: {
      runId?: string;
      sessionKey?: string;
      agentId?: string;
      memories?: Array<{ memoryId?: string; memory?: string }>;
    }) => {
      memoryCaptureService.bindInjectedExecutionMemories(input ?? {});
      return { accepted: true };
    },
  );

}

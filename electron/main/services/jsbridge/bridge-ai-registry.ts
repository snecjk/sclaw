export interface BridgeAiRunRecord {
  requestId: string;
  sessionKey: string;
  appId: string;
  webContentsId: number;
  ownerId: string;
  idempotencyKey: string;
  runId: string | null;
  startedAt: number;
  abort?: () => void;
}

const runsByRequestId = new Map<string, BridgeAiRunRecord>();

export function registerBridgeAiRun(record: BridgeAiRunRecord): void {
  runsByRequestId.set(record.requestId, record);
}

export function getBridgeAiRun(requestId: string): BridgeAiRunRecord | null {
  return runsByRequestId.get(requestId) ?? null;
}

export function unregisterBridgeAiRun(requestId: string): BridgeAiRunRecord | null {
  const record = runsByRequestId.get(requestId) ?? null;
  runsByRequestId.delete(requestId);
  return record;
}

export function listBridgeAiRunsForApp(appId: string): BridgeAiRunRecord[] {
  return [...runsByRequestId.values()].filter((record) => record.appId === appId);
}

export function listBridgeAiRunsForWebContents(webContentsId: number): BridgeAiRunRecord[] {
  return [...runsByRequestId.values()].filter((record) => record.webContentsId === webContentsId);
}

export function abortBridgeAiRunsForWebContents(webContentsId: number): void {
  for (const record of listBridgeAiRunsForWebContents(webContentsId)) {
    record.abort?.();
    runsByRequestId.delete(record.requestId);
  }
}

import { apiTokenRuntime } from './api-token-runtime';
import { managedCliRuntime } from './managed-cli-runtime';
import type { KindRuntime } from './types';

const runtimes: Map<string, KindRuntime> = new Map([
  [managedCliRuntime.kind, managedCliRuntime],
  ['managed-cli', managedCliRuntime],
  [apiTokenRuntime.kind, apiTokenRuntime],
]);

export function getKindRuntime(kind: string): KindRuntime | null {
  return runtimes.get(kind.trim()) ?? null;
}

export function listRegisteredKinds(): string[] {
  return [...runtimes.keys()];
}

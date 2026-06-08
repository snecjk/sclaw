import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getClawXConfigDir } from '../utils/paths';
import type { AgentEngineType } from './types';

export interface EngineSessionRegistryEntry {
  sessionKey: string;
  engineType: AgentEngineType;
  agentId: string;
  sessionId?: string;
  cwd: string;
  updatedAt?: number;
  title?: string;
  model?: string;
  accountId?: string;
}

interface EngineSessionRegistryDocument {
  entries?: EngineSessionRegistryEntry[];
}

const ENGINE_SESSION_REGISTRY_FILE = join(getClawXConfigDir(), 'engine-sessions.json');

async function readRegistryDocument(): Promise<EngineSessionRegistryDocument> {
  try {
    const raw = await readFile(ENGINE_SESSION_REGISTRY_FILE, 'utf8');
    return JSON.parse(raw) as EngineSessionRegistryDocument;
  } catch {
    return {};
  }
}

async function writeRegistryDocument(doc: EngineSessionRegistryDocument): Promise<void> {
  await mkdir(getClawXConfigDir(), { recursive: true });
  await writeFile(ENGINE_SESSION_REGISTRY_FILE, JSON.stringify(doc, null, 2), 'utf8');
}

export async function listEngineSessionRegistryEntries(engineType?: AgentEngineType): Promise<EngineSessionRegistryEntry[]> {
  const doc = await readRegistryDocument();
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  return engineType ? entries.filter((entry) => entry.engineType === engineType) : entries;
}

export async function getEngineSessionRegistryEntry(sessionKey: string): Promise<EngineSessionRegistryEntry | null> {
  const entries = await listEngineSessionRegistryEntries();
  return entries.find((entry) => entry.sessionKey === sessionKey) ?? null;
}

export async function upsertEngineSessionRegistryEntry(entry: EngineSessionRegistryEntry): Promise<void> {
  const doc = await readRegistryDocument();
  const entries = Array.isArray(doc.entries) ? [...doc.entries] : [];
  const index = entries.findIndex((item) => item.sessionKey === entry.sessionKey);
  if (index >= 0) {
    entries[index] = { ...entries[index], ...entry };
  } else {
    entries.push(entry);
  }
  await writeRegistryDocument({ entries });
}

export async function deleteEngineSessionRegistryEntry(sessionKey: string): Promise<EngineSessionRegistryEntry | null> {
  const doc = await readRegistryDocument();
  const entries = Array.isArray(doc.entries) ? [...doc.entries] : [];
  const index = entries.findIndex((item) => item.sessionKey === sessionKey);
  if (index < 0) return null;
  const [removed] = entries.splice(index, 1);
  await writeRegistryDocument({ entries });
  return removed ?? null;
}

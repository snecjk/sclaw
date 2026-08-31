/**
 * Device-local bindings: cloud appCode → local path / workspace.
 */
import { app } from 'electron';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

export interface StoAppBinding {
  appCode: string;
  applicationName: string;
  localPath: string;
  workspaceId: string;
  updatedAt: string;
}

interface BindingFile {
  version: 2;
  bindings: Record<string, StoAppBinding>;
}

function bindingsPath(): string {
  return join(app.getPath('userData'), 'sto-app-bindings.json');
}

function normalizeLegacyBinding(raw: unknown): StoAppBinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const appCode = typeof row.appCode === 'string' && row.appCode.trim()
    ? row.appCode.trim()
    : typeof row.applicationCode === 'string' && row.applicationCode.trim()
      ? row.applicationCode.trim()
      : typeof row.applicationId === 'string' && row.applicationId.trim()
        ? row.applicationId.trim()
        : '';
  if (!appCode) return null;
  const applicationName = typeof row.applicationName === 'string' && row.applicationName.trim()
    ? row.applicationName.trim()
    : appCode;
  const localPath = typeof row.localPath === 'string' ? row.localPath : '';
  const workspaceId = typeof row.workspaceId === 'string' ? row.workspaceId : '';
  const updatedAt = typeof row.updatedAt === 'string'
    ? row.updatedAt
    : new Date().toISOString();
  if (!localPath || !workspaceId) return null;
  return { appCode, applicationName, localPath, workspaceId, updatedAt };
}

async function readAll(): Promise<BindingFile> {
  const path = bindingsPath();
  if (!existsSync(path)) return { version: 2, bindings: {} };
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<BindingFile>;
    if (!raw || typeof raw.bindings !== 'object' || !raw.bindings) {
      return { version: 2, bindings: {} };
    }
    const bindings: Record<string, StoAppBinding> = {};
    for (const [key, value] of Object.entries(raw.bindings)) {
      const normalized = normalizeLegacyBinding(value);
      if (normalized) {
        bindings[normalized.appCode] = normalized;
      } else if (value && typeof value === 'object') {
        const legacy = normalizeLegacyBinding({ ...value as Record<string, unknown>, appCode: key });
        if (legacy) bindings[legacy.appCode] = legacy;
      }
    }
    return { version: 2, bindings };
  } catch {
    return { version: 2, bindings: {} };
  }
}

async function writeAll(file: BindingFile): Promise<void> {
  const path = bindingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

export async function listStoAppBindings(): Promise<StoAppBinding[]> {
  const file = await readAll();
  return Object.values(file.bindings);
}

export async function getStoAppBinding(appCode: string): Promise<StoAppBinding | null> {
  const id = appCode.trim();
  if (!id) return null;
  const file = await readAll();
  return file.bindings[id] ?? null;
}

export async function upsertStoAppBinding(input: {
  appCode: string;
  applicationName: string;
  localPath: string;
  workspaceId: string;
}): Promise<StoAppBinding> {
  const appCode = input.appCode.trim();
  if (!appCode) throw new Error('缺少 appCode');
  const binding: StoAppBinding = {
    appCode,
    applicationName: input.applicationName.trim() || appCode,
    localPath: input.localPath,
    workspaceId: input.workspaceId,
    updatedAt: new Date().toISOString(),
  };
  const file = await readAll();
  file.bindings[appCode] = binding;
  await writeAll(file);
  return binding;
}

export async function removeStoAppBinding(appCode: string): Promise<void> {
  const id = appCode.trim();
  if (!id) return;
  const file = await readAll();
  if (!(id in file.bindings)) return;
  delete file.bindings[id];
  await writeAll(file);
}

export async function removeStoAppBindingByWorkspaceId(workspaceId: string): Promise<void> {
  const id = workspaceId.trim();
  if (!id) return;
  const file = await readAll();
  let changed = false;
  for (const [key, binding] of Object.entries(file.bindings)) {
    if (binding.workspaceId === id) {
      delete file.bindings[key];
      changed = true;
    }
  }
  if (changed) await writeAll(file);
}

export async function getStoAppBindingByWorkspaceId(
  workspaceId: string,
): Promise<StoAppBinding | null> {
  const id = workspaceId.trim();
  if (!id) return null;
  const file = await readAll();
  for (const binding of Object.values(file.bindings)) {
    if (binding.workspaceId === id) return binding;
  }
  return null;
}

export async function getStoAppBindingByLocalPath(
  localPath: string,
): Promise<StoAppBinding | null> {
  const target = resolve(localPath.trim());
  if (!target) return null;
  const file = await readAll();
  for (const binding of Object.values(file.bindings)) {
    if (resolve(binding.localPath) === target) return binding;
  }
  return null;
}

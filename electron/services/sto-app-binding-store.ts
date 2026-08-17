/**
 * Device-local bindings: cloud applicationId → local path / workspace.
 * Cloud `sto-app apps list` remains authoritative for ownership.
 */
import { app } from 'electron';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

export interface StoAppBinding {
  applicationId: string;
  applicationName: string;
  localPath: string;
  workspaceId: string;
  updatedAt: string;
}

interface BindingFile {
  version: 1;
  bindings: Record<string, StoAppBinding>;
}

function bindingsPath(): string {
  return join(app.getPath('userData'), 'sto-app-bindings.json');
}

async function readAll(): Promise<BindingFile> {
  const path = bindingsPath();
  if (!existsSync(path)) return { version: 1, bindings: {} };
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<BindingFile>;
    if (!raw || typeof raw.bindings !== 'object' || !raw.bindings) {
      return { version: 1, bindings: {} };
    }
    return { version: 1, bindings: raw.bindings };
  } catch {
    return { version: 1, bindings: {} };
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

export async function getStoAppBinding(applicationId: string): Promise<StoAppBinding | null> {
  const id = applicationId.trim();
  if (!id) return null;
  const file = await readAll();
  return file.bindings[id] ?? null;
}

export async function upsertStoAppBinding(input: {
  applicationId: string;
  applicationName: string;
  localPath: string;
  workspaceId: string;
}): Promise<StoAppBinding> {
  const applicationId = input.applicationId.trim();
  if (!applicationId) throw new Error('缺少 applicationId');
  const binding: StoAppBinding = {
    applicationId,
    applicationName: input.applicationName.trim() || applicationId,
    localPath: input.localPath,
    workspaceId: input.workspaceId,
    updatedAt: new Date().toISOString(),
  };
  const file = await readAll();
  file.bindings[applicationId] = binding;
  await writeAll(file);
  return binding;
}

export async function removeStoAppBinding(applicationId: string): Promise<void> {
  const id = applicationId.trim();
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

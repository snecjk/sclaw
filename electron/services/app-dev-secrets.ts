/**
 * Per-workspace app secrets for local fullstack backends.
 * Stored in electron-store under `appDevSecrets:<workspaceId>`; values never
 * round-trip to the renderer list API.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type SecretsMap = Record<string, string>;

const SECRET_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ENC_PREFIX = 'enc:v1:';

let storeInstance: { get: (k: string) => unknown; set: (k: string, v: unknown) => void } | null = null;

async function getStore() {
  if (storeInstance) return storeInstance;
  const Store = (await import('electron-store')).default;
  storeInstance = new Store({ name: 'app-dev-secrets' }) as typeof storeInstance;
  return storeInstance!;
}

function storageKey(workspaceId: string): string {
  return `appDevSecrets:${workspaceId}`;
}

function deriveKey(workspaceId: string): Buffer {
  return createHash('sha256').update(`sclaw-app-dev-secrets:${workspaceId}`).digest();
}

function encryptValue(workspaceId: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(workspaceId), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

function decryptValue(workspaceId: string, stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const parts = stored.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('密钥数据损坏');
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(workspaceId),
    Buffer.from(ivB64!, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64!, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function assertSecretKey(key: string): string {
  const trimmed = key.trim();
  if (!SECRET_KEY_PATTERN.test(trimmed)) {
    throw new Error('密钥名不合法（字母/数字/下划线，且不以数字开头）');
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('密钥名不合法');
  }
  return trimmed;
}

export async function listAppDevSecretKeys(workspaceId: string): Promise<string[]> {
  const store = await getStore();
  const map = (store.get(storageKey(workspaceId)) ?? {}) as SecretsMap;
  return Object.keys(map).sort();
}

export async function getAppDevSecretsEnv(workspaceId: string): Promise<Record<string, string>> {
  const store = await getStore();
  const map = (store.get(storageKey(workspaceId)) ?? {}) as SecretsMap;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    env[key] = decryptValue(workspaceId, value);
  }
  return env;
}

export async function setAppDevSecret(
  workspaceId: string,
  key: string,
  value: string,
): Promise<void> {
  const safeKey = assertSecretKey(key);
  if (!value) throw new Error('密钥值不能为空');
  const store = await getStore();
  const map = { ...((store.get(storageKey(workspaceId)) ?? {}) as SecretsMap) };
  map[safeKey] = encryptValue(workspaceId, value);
  store.set(storageKey(workspaceId), map);
}

export async function deleteAppDevSecret(workspaceId: string, key: string): Promise<void> {
  const safeKey = assertSecretKey(key);
  const store = await getStore();
  const map = { ...((store.get(storageKey(workspaceId)) ?? {}) as SecretsMap) };
  delete map[safeKey];
  store.set(storageKey(workspaceId), map);
}

/** Test helper: reset in-memory store binding. */
export function __resetAppDevSecretsStoreForTests(): void {
  storeInstance = null;
}

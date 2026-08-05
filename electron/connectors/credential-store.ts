/**
 * Persist connector API tokens separately from status state.
 * Tokens never go into state.json / renderer payloads.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface ConnectorCredential {
  serverUrl: string;
  token: string;
  updatedAt: number;
}

interface CredentialFile {
  version: 1;
  items: Record<string, ConnectorCredential>;
}

function credentialsDir(): string {
  const override = process.env.STOCLAW_CONNECTORS_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.stoclaw', 'connectors');
}

function credentialsPath(): string {
  return join(credentialsDir(), 'credentials.json');
}

function emptyFile(): CredentialFile {
  return { version: 1, items: {} };
}

function readFile(): CredentialFile {
  const path = credentialsPath();
  if (!existsSync(path)) return emptyFile();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as CredentialFile;
    if (!raw || typeof raw !== 'object' || !raw.items) return emptyFile();
    return { version: 1, items: raw.items };
  } catch {
    return emptyFile();
  }
}

function writeFile(file: CredentialFile): void {
  const dir = credentialsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(credentialsPath(), `${JSON.stringify(file, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function getConnectorCredential(connectorId: string): ConnectorCredential | null {
  return readFile().items[connectorId] ?? null;
}

export function setConnectorCredential(
  connectorId: string,
  serverUrl: string,
  token: string,
): void {
  const file = readFile();
  file.items[connectorId] = {
    serverUrl: serverUrl.replace(/\/+$/, ''),
    token,
    updatedAt: Date.now(),
  };
  writeFile(file);
}

export function deleteConnectorCredential(connectorId: string): void {
  const file = readFile();
  if (!(connectorId in file.items)) return;
  delete file.items[connectorId];
  writeFile(file);
}

export function maskToken(token: string): string {
  const value = token.trim();
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

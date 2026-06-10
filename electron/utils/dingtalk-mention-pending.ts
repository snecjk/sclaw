import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DingTalkAttachedFileHint } from '../../shared/dingtalk-file-send';
import type { DingTalkMention } from '../../shared/dingtalk-mention';

const CACHE_DIR = join(homedir(), '.stoclaw', 'cache', 'dingtalk-mention-pending');
const PENDING_TTL_MS = 5 * 60 * 1000;

export interface DingTalkMentionPendingPayload {
  sessionKey: string;
  mentions: DingTalkMention[];
  userText: string;
  writtenAt: number;
  sendFileIntent?: boolean;
  attachedFiles?: DingTalkAttachedFileHint[];
}

function cachePathForSession(sessionKey: string): string {
  const safeName = Buffer.from(sessionKey, 'utf8').toString('base64url');
  return join(CACHE_DIR, `${safeName}.json`);
}

export async function writeDingTalkMentionPending(
  sessionKey: string,
  mentions: DingTalkMention[],
  userText: string,
  options?: {
    sendFileIntent?: boolean;
    attachedFiles?: DingTalkAttachedFileHint[];
  },
): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const payload: DingTalkMentionPendingPayload = {
    sessionKey,
    mentions,
    userText,
    writtenAt: Date.now(),
    sendFileIntent: options?.sendFileIntent,
    attachedFiles: options?.attachedFiles,
  };
  await writeFile(cachePathForSession(sessionKey), JSON.stringify(payload), 'utf8');
}

export async function readDingTalkMentionPending(
  sessionKey: string,
): Promise<DingTalkMentionPendingPayload | null> {
  try {
    const raw = await readFile(cachePathForSession(sessionKey), 'utf8');
    const parsed = JSON.parse(raw) as DingTalkMentionPendingPayload;
    if (parsed.sessionKey !== sessionKey || !Array.isArray(parsed.mentions) || parsed.mentions.length === 0) {
      return null;
    }
    if (Date.now() - parsed.writtenAt > PENDING_TTL_MS) {
      await clearDingTalkMentionPending(sessionKey);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearDingTalkMentionPending(sessionKey: string): Promise<void> {
  try {
    await unlink(cachePathForSession(sessionKey));
  } catch {
    // ignore missing file
  }
}

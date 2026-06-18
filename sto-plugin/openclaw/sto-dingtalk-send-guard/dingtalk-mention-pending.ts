import { readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DingTalkAttachedFileHint } from './shared/dingtalk-file-send';
import type { DingTalkMention } from './shared/dingtalk-mention';

export type DingTalkMentionPendingPayload = {
  sessionKey: string;
  mentions: DingTalkMention[];
  userText: string;
  writtenAt: number;
  sendFileIntent?: boolean;
  attachedFiles?: DingTalkAttachedFileHint[];
};

const DINGTALK_MENTION_PENDING_TTL_MS = 5 * 60 * 1000;

function pendingMentionCachePath(sessionKey: string): string {
  const safeName = Buffer.from(sessionKey, 'utf8').toString('base64url');
  return join(homedir(), '.stoclaw', 'cache', 'dingtalk-mention-pending', `${safeName}.json`);
}

export async function readDingTalkMentionPending(
  sessionKey: string,
): Promise<DingTalkMentionPendingPayload | null> {
  const cachePath = pendingMentionCachePath(sessionKey);
  try {
    const raw = await readFile(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as DingTalkMentionPendingPayload;
    if (
      parsed.sessionKey !== sessionKey
      || !Array.isArray(parsed.mentions)
      || parsed.mentions.length === 0
    ) {
      await unlink(cachePath).catch(() => undefined);
      return null;
    }
    if (Date.now() - parsed.writtenAt > DINGTALK_MENTION_PENDING_TTL_MS) {
      await unlink(cachePath).catch(() => undefined);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearDingTalkMentionPending(sessionKey: string): Promise<void> {
  await unlink(pendingMentionCachePath(sessionKey)).catch(() => undefined);
}

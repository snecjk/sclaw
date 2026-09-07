import { createSclawCapabilityToken } from '../../../../shared/agent-extensions';
import type { DingTalkAttachedFileHint } from '../../../../shared/dingtalk-send/dingtalk-file-send';
import type { DingTalkMention } from '../../../../shared/dingtalk-send/dingtalk-mention';

export type DingTalkSendCategory = 'text' | 'image';

export interface DingTalkPendingContext {
  sessionKey: string;
  mentions: DingTalkMention[];
  userText: string;
  writtenAt: number;
  sendFileIntent?: boolean;
  attachedFiles?: DingTalkAttachedFileHint[];
}

export interface DingTalkSendReservationInput {
  sessionKey: string;
  toolCallId: string;
  category: DingTalkSendCategory;
  recipientKey?: string;
  normalizedText?: string;
  scheduledExecution: boolean;
  now?: number;
}

export type DingTalkSendReservation =
  | { allowed: true }
  | { allowed: false; code: 'rate_limited' | 'duplicate'; reason: string };

export interface StoDingTalkSendGuardPort {
  hasPendingContext(sessionKey: string): Promise<boolean>;
  consumePendingContext(sessionKey: string): Promise<DingTalkPendingContext | null>;
  reserveSend(input: DingTalkSendReservationInput): Promise<DingTalkSendReservation>;
  completeSend(input: {
    sessionKey: string;
    toolCallId: string;
    success: boolean;
    now?: number;
  }): Promise<void>;
}

export const STO_DINGTALK_SEND_GUARD_CAPABILITY =
  createSclawCapabilityToken<StoDingTalkSendGuardPort>('sto.dingtalk-send-guard');

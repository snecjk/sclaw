/**
 * Main ↔ Weixin Worker MessagePort contract (stable).
 * Do not put raw iLink field names here.
 *
 * MVP: typing + commit + cancel.
 * Phase 3: outbound.sendMedia + inbound parts (local paths).
 */

export type WeixinReasonCode =
  | 'AUTH_EXPIRED'
  | 'PROTOCOL_REJECTED'
  | 'CONTEXT_MISSING'
  | 'CONTEXT_REJECTED'
  | 'NETWORK'
  | 'MEDIA_FAILED'
  | 'UNKNOWN';

export type WeixinInboundPartKind =
  | 'text'
  | 'image'
  | 'file'
  | 'voice'
  | 'video'
  | 'unknown';

export type WeixinInboundPart = {
  kind: WeixinInboundPartKind;
  text?: string;
  /** Absolute local path after Worker CDN download/decrypt. */
  localPath?: string;
  mimeType?: string;
  fileName?: string;
  /** Degraded notice when media cannot be materialized. */
  notice?: string;
};

export type WeixinWireEvent =
  | { type: 'runtime.ready' }
  | { type: 'runtime.failed'; error: { message: string; code?: string } }
  | {
      type: 'account.status';
      status: 'connected' | 'disconnected' | 'paused' | 'error';
      accountId?: string;
      reasonCode?: WeixinReasonCode;
      message?: string;
    }
  | {
      type: 'message.inbound';
      accountId: string;
      peerId: string;
      messageId: string;
      contextToken?: string;
      createdAtMs: number;
      text?: string;
      parts?: WeixinInboundPart[];
      rawProtocolVersion: string;
    }
  | {
      type: 'outbound.result';
      ok: boolean;
      clientRequestId?: string;
      messageId?: string;
      reasonCode?: WeixinReasonCode;
      message?: string;
    }
  | {
      type: 'transport.health';
      pollLatencyMs?: number;
      consecutiveFailures: number;
    };

export type WeixinWireCommand =
  | { type: 'runtime.start' }
  | { type: 'runtime.stop' }
  | {
      type: 'account.upsert';
      accountId: string;
      token: string;
      baseUrl?: string;
      userId?: string;
    }
  | { type: 'account.remove'; accountId: string }
  | {
      type: 'outbound.typing';
      peerId: string;
      typingTicket?: string;
      contextToken?: string;
    }
  | {
      type: 'outbound.commit';
      peerId: string;
      text: string;
      contextToken?: string;
      clientRequestId?: string;
    }
  | {
      type: 'outbound.sendMedia';
      peerId: string;
      /** Absolute local filesystem path (Host resolves; Worker uploads). */
      filePath: string;
      caption?: string;
      contextToken?: string;
      clientRequestId?: string;
    }
  | {
      type: 'outbound.cancel';
      peerId?: string;
      clientRequestId?: string;
    };

/** Reserved — GENERATING draft snapshot; not implemented. */
export type WeixinWireCommandPhase3Reserved = {
  type: 'outbound.sendText';
  peerId: string;
  text: string;
  contextToken?: string;
};

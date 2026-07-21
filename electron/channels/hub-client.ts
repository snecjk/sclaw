import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger';
import { resolveSclawHubWsUrl } from './hub-config';
import { touchDingTalkOnline } from './binding-service';

/** Hub → Desktop 多模态分片（url 可直接下载） */
export interface SclawInboundMediaPart {
  type?: 'text' | 'picture' | 'audio' | 'video' | 'file' | string;
  content?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
}

export interface SclawInboundEnvelope {
  type: string;
  deviceId?: string;
  reason?: string;
  payload?: {
    channelTraceId?: string;
    chatUid?: string;
    robotCode?: string;
    dingUserId?: string;
    peerId?: string;
    group?: boolean;
    text?: string;
    senderNick?: string;
    /** Hub 控制动作；卡片“新对话”按钮使用 new_session。 */
    action?: 'new_session' | string;
    /** 钉钉原始 msgtype */
    msgtype?: string;
    /** 多模态 parts；优先于仅 text */
    parts?: SclawInboundMediaPart[];
  };
}

export type SclawBindReplacedReason = 'bound_on_another_device' | 'unbound' | string;

type HubClientState = 'idle' | 'connecting' | 'connected' | 'closed';

/**
 * Channel Hub WebSocket 客户端（钉钉入站下行 + ping/delta 上行）。
 */
export class SclawHubClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private state: HubClientState = 'idle';
  private refreshToken: string | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;

  getStatus(): { state: HubClientState; connected: boolean } {
    return {
      state: this.state,
      connected: this.state === 'connected' && !!this.ws && this.ws.readyState === WebSocket.OPEN,
    };
  }

  async connect(refreshToken: string): Promise<void> {
    this.manualClose = false;
    this.refreshToken = refreshToken;
    await this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.state = 'closed';
  }

  /** 被换绑/解绑后永久停连，避免旧 refreshToken 无限重连 */
  disconnectPermanently(): void {
    this.refreshToken = null;
    this.disconnect();
  }

  send(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  sendDelta(chatUid: string, content: string, finalize = false): boolean {
    return this.send({
      type: finalize ? 'done' : 'delta',
      chatUid,
      content,
      finalize,
    });
  }

  private async openSocket(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('refreshToken required');
    }
    this.clearReconnect();
    // 先关掉旧连接，避免重连时残留 socket 抢状态 / 触发二次 scheduleReconnect
    if (this.ws) {
      const prev = this.ws;
      this.ws = null;
      prev.removeAllListeners();
      try {
        prev.close();
      } catch {
        // ignore
      }
    }
    this.state = 'connecting';
    const url = resolveSclawHubWsUrl(this.refreshToken);
    logger.info(`[SclawHub] connecting ${url.replace(/refreshToken=[^&]+/, 'refreshToken=***')}`);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      const settleOk = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const settleErr = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      ws.on('open', () => {
        this.state = 'connected';
        this.reconnectAttempt = 0;
        this.startPing();
        void touchDingTalkOnline();
        logger.info('[SclawHub] connected');
        this.emit('connected');
        settleOk();
      });

      ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', () => {
        this.state = 'closed';
        this.clearPing();
        this.ws = null;
        this.emit('disconnected');
        if (!this.manualClose) {
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        logger.warn('[SclawHub] socket error', err);
        settleErr(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as SclawInboundEnvelope;
      if (msg.type === 'pong') {
        return;
      }
      if (msg.type === 'connected') {
        this.emit('connected', msg);
        return;
      }
      if (msg.type === 'inbound') {
        this.emit('inbound', msg);
        return;
      }
      if (msg.type === 'bind.replaced') {
        const reason = (msg.reason || 'bound_on_another_device') as SclawBindReplacedReason;
        logger.info(`[SclawHub] bind.replaced reason=${reason}`);
        this.emit('bindReplaced', { reason, deviceId: msg.deviceId });
        this.disconnectPermanently();
        return;
      }
      logger.debug('[SclawHub] ignore message type=', msg.type);
    } catch (error) {
      logger.warn('[SclawHub] bad message', error);
    }
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30_000);
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearPing();
    this.clearReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.refreshToken || this.manualClose) return;
    this.clearReconnect();
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectAttempt += 1;
    logger.info(`[SclawHub] reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      void this.openSocket().catch((err) => {
        logger.warn('[SclawHub] reconnect failed', err);
        this.scheduleReconnect();
      });
    }, delay);
  }
}

let singleton: SclawHubClient | null = null;

export function getSclawHubClient(): SclawHubClient {
  if (!singleton) {
    singleton = new SclawHubClient();
  }
  return singleton;
}

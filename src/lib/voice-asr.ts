/**
 * memory-center 实时 ASR（STT）客户端：模型目录 HTTP + WebSocket PCM 流。
 * 渲染进程直连 `/agent/v1/voice/asr/stream`（host-api HTTP 代理不支持 WS）。
 */

import { hostApiFetch } from '@/lib/host-api';
import type { SsoEnvironment } from '@/stores/auth';

export type VoiceAsrEventType = 'ready' | 'partial' | 'final' | 'finished' | 'error';

export interface VoiceAsrServerEvent {
  type: VoiceAsrEventType;
  text?: string;
  sentenceEnd?: boolean;
  taskId?: string;
  message?: string;
  beginTime?: number;
  endTime?: number;
}

export interface VoiceSttModel {
  id: string;
  name: string;
  modelType: string;
  provider: string;
  protocol?: string;
  upstreamModel?: string;
  parameters?: {
    format?: string;
    sample_rate?: number;
    max_sentence_silence?: number;
    heartbeat?: boolean;
  };
}

export interface VoiceModelsResponse {
  defaultSttModelId: string;
  asrWsPath: string;
  /** Apollo ``voice.default.stt.idle.second``；未配置时不下发，客户端兜底 5s */
  transcriptIdleSeconds?: number;
  models: {
    stt: VoiceSttModel[];
    tts: VoiceSttModel[];
  };
}

/** 转写业务空闲默认秒数（Apollo 未配置时） */
export const DEFAULT_TRANSCRIPT_IDLE_SECONDS = 5;

/** 将目录里的空闲秒数解析为毫秒；非法/缺失 → 本地兜底 5s */
export function resolveTranscriptIdleMs(seconds?: number | null): number {
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }
  return DEFAULT_TRANSCRIPT_IDLE_SECONDS * 1000;
}

const MEMORY_CENTER_BASE: Record<SsoEnvironment, string> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn',
  'pre-release': 'https://pre-baseinfo-aimemory.sto.cn',
  local: 'http://127.0.0.1:7001',
  'production-external': 'https://baseinfo-aimemory.sto.cn',
  'production-internal': 'https://baseinfo-aimemory.sto.cn',
};

const TARGET_SAMPLE_RATE = 16000;
const SCRIPT_BUFFER_SIZE = 4096;
/** 声纹条数（与 UI 一致） */
export const VOICE_LEVEL_BAR_COUNT = 64;

export function resolveMemoryCenterHttpBase(ssoEnvironment: SsoEnvironment): string {
  return MEMORY_CENTER_BASE[ssoEnvironment] || MEMORY_CENTER_BASE['production-external'];
}

export function toWebSocketBaseUrl(httpBase: string): string {
  if (httpBase.startsWith('https://')) return `wss://${httpBase.slice('https://'.length)}`;
  if (httpBase.startsWith('http://')) return `ws://${httpBase.slice('http://'.length)}`;
  return httpBase.replace(/^http/, 'ws');
}

export async function fetchVoiceModels(): Promise<VoiceModelsResponse> {
  const payload = await hostApiFetch<VoiceModelsResponse>('/ai-memory/agent/v1/voice/models');
  if (!payload || typeof payload !== 'object') {
    throw new Error('语音模型目录响应无效');
  }
  return payload;
}

export function buildVoiceAsrWsUrl(options: {
  httpBase: string;
  asrWsPath?: string;
  modelId: string;
  stoToken: string;
}): string {
  const path = (options.asrWsPath || '/agent/v1/voice/asr/stream').startsWith('/')
    ? (options.asrWsPath || '/agent/v1/voice/asr/stream')
    : `/${options.asrWsPath}`;
  const wsBase = toWebSocketBaseUrl(options.httpBase.replace(/\/+$/, ''));
  const url = new URL(`${wsBase}${path}`);
  url.searchParams.set('model_id', options.modelId);
  url.searchParams.set('stoToken', options.stoToken);
  return url.toString();
}

/** Float32 mono → Int16 PCM，并重采样到 16kHz。 */
export function floatToPcm16(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate = TARGET_SAMPLE_RATE,
): Int16Array {
  if (input.length === 0) return new Int16Array(0);

  if (inputSampleRate === outputSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    return out;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    const sample = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
    const s = Math.max(-1, Math.min(1, sample));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export type VoiceAsrSessionHandlers = {
  onEvent?: (event: VoiceAsrServerEvent) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
  /** 0–1 频段电平，供声纹 UI 跟随真实麦音量 */
  onLevel?: (levels: Float32Array) => void;
};

/**
 * 打开麦克风 + ASR WebSocket，持续推送 16k PCM。
 * 调用 `stop()` 发送 finish 并释放资源。
 */
export class VoiceAsrSession {
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelRaf = 0;
  private levelFrame = 0;
  private readonly levelBins = new Float32Array(VOICE_LEVEL_BAR_COUNT);
  private ready = false;
  private closed = false;
  private pendingChunks: ArrayBuffer[] = [];

  constructor(private readonly handlers: VoiceAsrSessionHandlers = {}) {}

  get isActive(): boolean {
    return !this.closed && this.ws !== null;
  }

  async start(options: {
    wsUrl: string;
    sampleRate?: number;
  }): Promise<void> {
    if (this.ws || this.closed) {
      throw new Error('VoiceAsrSession 不可重复 start');
    }

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.mediaStream = mediaStream;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioCtx();
    this.audioContext = audioContext;
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const ws = new WebSocket(options.wsUrl);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('语音识别连接失败'));
      };
      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
    });

    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      let parsed: VoiceAsrServerEvent;
      try {
        parsed = JSON.parse(ev.data) as VoiceAsrServerEvent;
      } catch {
        return;
      }
      if (parsed.type === 'ready') {
        this.ready = true;
        this.flushPending();
      }
      if (parsed.type === 'error') {
        this.handlers.onError?.(parsed.message || '语音识别失败');
      }
      this.handlers.onEvent?.(parsed);
    });

    ws.addEventListener('close', () => {
      this.handlers.onClose?.();
      void this.cleanupMedia();
    });

    const source = audioContext.createMediaStreamSource(mediaStream);
    this.source = source;

    // 频谱分析 → UI 声纹（与 PCM 推流并行）
    if (this.handlers.onLevel) {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      // 更跟手：少平滑、放宽动态范围，小声也更容易顶起来
      analyser.smoothingTimeConstant = 0.45;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -18;
      this.analyser = analyser;
      source.connect(analyser);
      this.startLevelPump();
    }

    // ScriptProcessor 已弃用但仍是 Electron/Chromium 下最稳妥的跨版本方案
    const processor = audioContext.createScriptProcessor(SCRIPT_BUFFER_SIZE, 1, 1);
    this.processor = processor;
    const inputRate = audioContext.sampleRate;
    const targetRate = options.sampleRate ?? TARGET_SAMPLE_RATE;

    processor.onaudioprocess = (event) => {
      if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatToPcm16(input, inputRate, targetRate);
      if (pcm.length === 0) return;
      const buffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
      if (!this.ready) {
        this.pendingChunks.push(buffer);
        // 避免 ready 前无限堆积
        if (this.pendingChunks.length > 50) this.pendingChunks.shift();
        return;
      }
      this.ws.send(buffer);
    };

    // ScriptProcessor 必须接入输出图才会回调；增益置 0 避免麦克风回放啸叫
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    this.silentGain = silentGain;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
  }

  private startLevelPump(): void {
    const analyser = this.analyser;
    const onLevel = this.handlers.onLevel;
    if (!analyser || !onLevel) return;

    const freq = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (this.closed || !this.analyser) {
        this.levelRaf = 0;
        return;
      }
      this.levelRaf = window.requestAnimationFrame(tick);
      // ~30fps 推 UI，减轻 React 压力
      this.levelFrame += 1;
      if (this.levelFrame % 2 !== 0) return;

      analyser.getByteFrequencyData(freq);
      const bars = this.levelBins;
      const n = bars.length;
      // 人声主要在偏低中频，略跳过直流/超高频
      const usable = Math.max(8, Math.floor(freq.length * 0.72));
      const start = 2;
      const span = Math.max(1, usable - start);
      // 中间 → 两侧对称：中心吃低频（人声能量），越靠边越高频
      const mid = (n - 1) / 2;
      for (let i = 0; i < n; i += 1) {
        const dist = mid <= 0 ? 0 : Math.abs(i - mid) / mid;
        const t0 = start + Math.floor(dist * span * 0.999);
        const t1 = Math.min(start + span, t0 + Math.max(1, Math.floor(span / (n / 2))));
        let sum = 0;
        let count = 0;
        for (let t = t0; t < t1; t += 1) {
          sum += freq[t] ?? 0;
          count += 1;
        }
        const raw = (sum / Math.max(1, count)) / 255;
        // 提高增益 + 更陡曲线；中心略加重，强化「从中间荡开」
        const centerBoost = 1 + (1 - dist) * 0.35;
        const shaped = Math.pow(Math.min(1, raw * 2.15 * centerBoost), 0.62);
        bars[i] = Math.max(0.03, shaped);
      }
      onLevel(bars);
    };
    this.levelRaf = window.requestAnimationFrame(tick);
  }

  stop(): void {
    void this.stopAsync();
  }

  /** 停麦并通知上游 finish，短暂等待最终结果后关闭。 */
  async stopAsync(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.cleanupMedia();

    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: 'finish' }));
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          ws.removeEventListener('message', onMessage);
          window.clearTimeout(timer);
          resolve();
        };
        const onMessage = (ev: MessageEvent) => {
          if (typeof ev.data !== 'string') return;
          try {
            const parsed = JSON.parse(ev.data) as VoiceAsrServerEvent;
            if (parsed.type === 'finished' || parsed.type === 'error') done();
          } catch {
            // ignore
          }
        };
        const timer = window.setTimeout(done, 900);
        ws.addEventListener('message', onMessage);
      });
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
  }

  private flushPending(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const chunk of this.pendingChunks) {
      this.ws.send(chunk);
    }
    this.pendingChunks = [];
  }

  private async cleanupMedia(): Promise<void> {
    if (this.levelRaf) {
      window.cancelAnimationFrame(this.levelRaf);
      this.levelRaf = 0;
    }
    try {
      this.analyser?.disconnect();
    } catch {
      // ignore
    }
    this.analyser = null;

    try {
      this.processor?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.silentGain?.disconnect();
    } catch {
      // ignore
    }
    this.processor = null;
    this.source = null;
    this.silentGain = null;

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }
  }
}

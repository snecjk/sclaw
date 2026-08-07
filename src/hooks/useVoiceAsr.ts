/**
 * 聊天输入框语音转写：点击麦克风开始/结束，识别结果写入 composer。
 * 支持句末（ASR final）回调，供上层做短确认后自动发送。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  buildVoiceAsrWsUrl,
  DEFAULT_TRANSCRIPT_IDLE_SECONDS,
  fetchVoiceModels,
  resolveMemoryCenterHttpBase,
  resolveTranscriptIdleMs,
  VOICE_LEVEL_BAR_COUNT,
  VoiceAsrSession,
  type VoiceAsrServerEvent,
} from '@/lib/voice-asr';
import { useAuthStore } from '@/stores/auth';

export type VoiceAsrStatus = 'idle' | 'connecting' | 'recording' | 'stopping';

const IDLE_LEVELS = () => Array.from({ length: VOICE_LEVEL_BAR_COUNT }, () => 0.06);

export interface UseVoiceAsrOptions {
  /** 每次收到 partial / final 时回调（可用于预览） */
  onTranscript?: (payload: { partial: string; finals: string }) => void;
  /** 录音结束并汇总最终文本（手动 stop 时） */
  onCommitText?: (text: string) => void;
  /**
   * 收到一句 ASR final 后自动结束本轮录音并回调完整文本。
   * 若设置，则不会在 stop 时再走 onCommitText（由上层负责写入）。
   * 另：有非空转写且连续空闲（Apollo transcriptIdleSeconds，默认 5s）无文字更新时，也会走此回调。
   */
  onUtteranceFinal?: (text: string) => void;
  /**
   * WS/开麦等致命失败：已停麦回到 idle，上层应退出语音循环 UI。
   * 正常 stop / 句末收尾不会触发。
   */
  onSessionFailed?: (message: string) => void;
  disabled?: boolean;
}

export interface StopVoiceOptions {
  /** 默认 true；句末自动结束时可设 false，避免与 onUtteranceFinal 重复写入 */
  commit?: boolean;
  /** 立即回到 idle，不展示「正在完成识别」（用于切会话等强制退出） */
  silent?: boolean;
}

export function useVoiceAsr(options: UseVoiceAsrOptions = {}) {
  const { onTranscript, onCommitText, onUtteranceFinal, onSessionFailed, disabled = false } = options;
  const [status, setStatus] = useState<VoiceAsrStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [finalsText, setFinalsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(IDLE_LEVELS);

  const sessionRef = useRef<VoiceAsrSession | null>(null);
  const finalsRef = useRef('');
  const partialRef = useRef('');
  const endingUtteranceRef = useRef(false);
  /** 主动 stop / 句末收尾，避免 onClose 误判为异常退出 */
  const intentionalCloseRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  /** Apollo 下发的空闲毫秒；未配置时用本地兜底 */
  const transcriptIdleMsRef = useRef(DEFAULT_TRANSCRIPT_IDLE_SECONDS * 1000);
  /** 上次用于空闲判定的合并文案；内容变化才重置空闲计时 */
  const lastIdleTextRef = useRef('');
  const onTranscriptRef = useRef(onTranscript);
  const onCommitTextRef = useRef(onCommitText);
  const onUtteranceFinalRef = useRef(onUtteranceFinal);
  const onSessionFailedRef = useRef(onSessionFailed);
  const stopRef = useRef<(stopOptions?: StopVoiceOptions) => Promise<void>>(async () => undefined);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onCommitTextRef.current = onCommitText;
  }, [onCommitText]);

  useEffect(() => {
    onUtteranceFinalRef.current = onUtteranceFinal;
  }, [onUtteranceFinal]);

  useEffect(() => {
    onSessionFailedRef.current = onSessionFailed;
  }, [onSessionFailed]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const resetTranscript = useCallback(() => {
    finalsRef.current = '';
    partialRef.current = '';
    lastIdleTextRef.current = '';
    setPartialText('');
    setFinalsText('');
    setLevels(IDLE_LEVELS());
  }, []);

  const failSession = useCallback((message: string) => {
    clearIdleTimer();
    intentionalCloseRef.current = true;
    endingUtteranceRef.current = false;
    const session = sessionRef.current;
    sessionRef.current = null;
    resetTranscript();
    setStatus('idle');
    setError(message);
    if (session) {
      try {
        session.stop();
      } catch {
        // ignore
      }
    }
    console.info('[voice-asr] session failed → exit voice mode', { message });
    onSessionFailedRef.current?.(message);
  }, [clearIdleTimer, resetTranscript]);

  /** 有非空转写且文案有变化时，重启空闲计时；空内容保持持续听 */
  const syncTranscriptIdleTimer = useCallback(() => {
    if (!onUtteranceFinalRef.current) {
      clearIdleTimer();
      return;
    }
    const text = `${finalsRef.current}${partialRef.current}`.trim();
    if (!text) {
      lastIdleTextRef.current = '';
      clearIdleTimer();
      return;
    }
    if (text === lastIdleTextRef.current && idleTimerRef.current != null) {
      return;
    }
    lastIdleTextRef.current = text;
    clearIdleTimer();
    const idleMs = transcriptIdleMsRef.current;
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      const utteranceHandler = onUtteranceFinalRef.current;
      if (!utteranceHandler || endingUtteranceRef.current) return;
      const fullText = `${finalsRef.current}${partialRef.current}`.trim();
      if (!fullText) return;
      endingUtteranceRef.current = true;
      console.info('[voice-asr] transcript idle timeout → confirm', {
        idleMs,
        textLength: fullText.length,
        textPreview: fullText.length > 80 ? `${fullText.slice(0, 80)}…` : fullText,
      });
      void (async () => {
        await stopRef.current({ commit: false });
        utteranceHandler(fullText);
      })();
    }, idleMs);
  }, [clearIdleTimer]);

  // sending/disabled 变 true 时立刻停麦，避免「等待回复」UI 下 ASR 仍在转
  useEffect(() => {
    if (!disabled) return;
    clearIdleTimer();
    intentionalCloseRef.current = true;
    if (!sessionRef.current) {
      if (status !== 'idle') setStatus('idle');
      return;
    }
    const session = sessionRef.current;
    sessionRef.current = null;
    endingUtteranceRef.current = false;
    resetTranscript();
    setStatus('idle');
    try {
      session.stop();
    } catch {
      // ignore
    }
  }, [clearIdleTimer, disabled, resetTranscript, status]);

  const stop = useCallback(async (stopOptions?: StopVoiceOptions) => {
    const shouldCommit = stopOptions?.commit !== false;
    const silent = stopOptions?.silent === true;
    clearIdleTimer();
    intentionalCloseRef.current = true;
    const session = sessionRef.current;
    if (!session) {
      setStatus('idle');
      endingUtteranceRef.current = false;
      return;
    }

    sessionRef.current = null;
    endingUtteranceRef.current = false;

    if (silent) {
      // 切会话等场景：立刻收起 UI，后台关掉 WS
      resetTranscript();
      setStatus('idle');
      try {
        session.stop();
      } catch {
        // ignore
      }
      return;
    }

    setStatus('stopping');
    try {
      await session.stopAsync();
    } catch {
      session.stop();
    }

    const text = `${finalsRef.current}${partialRef.current}`.trim();
    if (shouldCommit && text) {
      onCommitTextRef.current?.(text);
    }
    resetTranscript();
    setStatus('idle');
  }, [clearIdleTimer, resetTranscript]);

  stopRef.current = stop;

  const handleEvent = useCallback((event: VoiceAsrServerEvent) => {
    if (event.type === 'partial' && typeof event.text === 'string') {
      partialRef.current = event.text;
      setPartialText(event.text);
      onTranscriptRef.current?.({
        partial: event.text,
        finals: finalsRef.current,
      });
      syncTranscriptIdleTimer();
      return;
    }

    if (event.type === 'final' && typeof event.text === 'string' && event.text.trim()) {
      const piece = event.text.trim();
      finalsRef.current = finalsRef.current ? `${finalsRef.current}${piece}` : piece;
      partialRef.current = '';
      setPartialText('');
      setFinalsText(finalsRef.current);
      onTranscriptRef.current?.({
        partial: '',
        finals: finalsRef.current,
      });

      const utteranceHandler = onUtteranceFinalRef.current;
      if (utteranceHandler && !endingUtteranceRef.current) {
        endingUtteranceRef.current = true;
        clearIdleTimer();
        intentionalCloseRef.current = true;
        const fullText = finalsRef.current;
        console.info('[voice-asr] asr final → confirm', {
          textLength: fullText.trim().length,
          textPreview: fullText.trim().length > 80
            ? `${fullText.trim().slice(0, 80)}…`
            : fullText.trim(),
        });
        void (async () => {
          await stop({ commit: false });
          if (fullText.trim()) {
            utteranceHandler(fullText.trim());
          }
        })();
      } else {
        syncTranscriptIdleTimer();
      }
      return;
    }

    // error 由 VoiceAsrSession.onError → failSession 统一处理，避免双触发
  }, [clearIdleTimer, stop, syncTranscriptIdleTimer]);

  const start = useCallback(async () => {
    if (disabled || sessionRef.current || endingUtteranceRef.current) return;

    const { user, ssoEnvironment, isAuthenticated } = useAuthStore.getState();
    const token = user?.stoToken?.trim();
    if (!isAuthenticated || !token) {
      const tip = '请先登录后再使用语音输入';
      toast.error(tip);
      failSession(tip);
      return;
    }

    setError(null);
    setStatus('connecting');
    clearIdleTimer();
    resetTranscript();
    endingUtteranceRef.current = false;
    intentionalCloseRef.current = false;

    try {
      let modelId = 'fun-asr-realtime';
      let asrWsPath = '/agent/v1/voice/asr/stream';
      let sampleRate = 16000;
      // 目录拉取失败时仍用本地 5s 兜底
      transcriptIdleMsRef.current = DEFAULT_TRANSCRIPT_IDLE_SECONDS * 1000;
      try {
        const catalog = await fetchVoiceModels();
        modelId = catalog.defaultSttModelId || modelId;
        asrWsPath = catalog.asrWsPath || asrWsPath;
        transcriptIdleMsRef.current = resolveTranscriptIdleMs(catalog.transcriptIdleSeconds);
        console.info('[voice-asr] transcript idle config', {
          apolloSeconds: catalog.transcriptIdleSeconds ?? null,
          resolvedIdleMs: transcriptIdleMsRef.current,
          fallbackSeconds: DEFAULT_TRANSCRIPT_IDLE_SECONDS,
          fromApollo: typeof catalog.transcriptIdleSeconds === 'number'
            && Number.isFinite(catalog.transcriptIdleSeconds)
            && catalog.transcriptIdleSeconds > 0,
        });
        const active = catalog.models?.stt?.find((m) => m.id === modelId);
        const rate = active?.parameters?.sample_rate;
        if (typeof rate === 'number' && rate > 0) sampleRate = rate;
      } catch {
        // 模型目录失败时仍用内置默认，避免阻塞录音
        console.info('[voice-asr] transcript idle config', {
          apolloSeconds: null,
          resolvedIdleMs: transcriptIdleMsRef.current,
          fallbackSeconds: DEFAULT_TRANSCRIPT_IDLE_SECONDS,
          fromApollo: false,
          reason: 'voice-models-fetch-failed',
        });
      }

      const httpBase = resolveMemoryCenterHttpBase(ssoEnvironment);
      const wsUrl = buildVoiceAsrWsUrl({
        httpBase,
        asrWsPath,
        modelId,
        stoToken: token,
      });

      const session = new VoiceAsrSession({
        onEvent: handleEvent,
        onError: (message) => {
          toast.error(message);
          failSession(message);
        },
        onClose: () => {
          if (sessionRef.current !== session) return;
          sessionRef.current = null;
          clearIdleTimer();
          resetTranscript();
          const unexpected = !intentionalCloseRef.current && !endingUtteranceRef.current;
          intentionalCloseRef.current = false;
          setStatus((prev) => (prev === 'stopping' ? prev : 'idle'));
          if (unexpected) {
            const tip = '语音识别连接已断开';
            toast.error(tip);
            failSession(tip);
          }
        },
        onLevel: (bins) => {
          // 拷贝一份给 React，避免与 analyser 缓冲共用引用
          setLevels(Array.from(bins));
        },
      });
      sessionRef.current = session;
      await session.start({ wsUrl, sampleRate });
      if (sessionRef.current !== session) {
        intentionalCloseRef.current = true;
        await session.stopAsync();
        return;
      }
      setStatus('recording');
    } catch (err) {
      sessionRef.current?.stop();
      sessionRef.current = null;
      endingUtteranceRef.current = false;
      const message = err instanceof Error ? err.message : String(err);
      const denied = /Permission|NotAllowed|权限|denied/i.test(message);
      const tip = denied ? '无法访问麦克风，请在系统设置中允许麦克风权限' : (message || '启动语音识别失败');
      toast.error(tip);
      failSession(tip);
    }
  }, [clearIdleTimer, disabled, failSession, handleEvent, resetTranscript]);

  const toggle = useCallback(() => {
    if (disabled) return;
    if (status === 'recording' || status === 'connecting' || status === 'stopping') {
      void stop({ commit: true });
      return;
    }
    void start();
  }, [disabled, start, status, stop]);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      clearIdleTimer();
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, [clearIdleTimer]);

  return {
    status,
    partialText,
    finalsText,
    error,
    /** 实时麦声音频谱 0–1，供声纹 UI */
    levels,
    isActive: status === 'recording' || status === 'connecting' || status === 'stopping',
    start,
    stop,
    toggle,
  };
}

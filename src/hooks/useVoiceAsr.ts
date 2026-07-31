/**
 * 聊天输入框语音转写：点击麦克风开始/结束，识别结果写入 composer。
 * 支持句末（ASR final）回调，供上层做短确认后自动发送。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  buildVoiceAsrWsUrl,
  fetchVoiceModels,
  resolveMemoryCenterHttpBase,
  VoiceAsrSession,
  type VoiceAsrServerEvent,
} from '@/lib/voice-asr';
import { useAuthStore } from '@/stores/auth';

export type VoiceAsrStatus = 'idle' | 'connecting' | 'recording' | 'stopping';

export interface UseVoiceAsrOptions {
  /** 每次收到 partial / final 时回调（可用于预览） */
  onTranscript?: (payload: { partial: string; finals: string }) => void;
  /** 录音结束并汇总最终文本（手动 stop 时） */
  onCommitText?: (text: string) => void;
  /**
   * 收到一句 ASR final 后自动结束本轮录音并回调完整文本。
   * 若设置，则不会在 stop 时再走 onCommitText（由上层负责写入）。
   */
  onUtteranceFinal?: (text: string) => void;
  disabled?: boolean;
}

export interface StopVoiceOptions {
  /** 默认 true；句末自动结束时可设 false，避免与 onUtteranceFinal 重复写入 */
  commit?: boolean;
  /** 立即回到 idle，不展示「正在完成识别」（用于切会话等强制退出） */
  silent?: boolean;
}

export function useVoiceAsr(options: UseVoiceAsrOptions = {}) {
  const { onTranscript, onCommitText, onUtteranceFinal, disabled = false } = options;
  const [status, setStatus] = useState<VoiceAsrStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [finalsText, setFinalsText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<VoiceAsrSession | null>(null);
  const finalsRef = useRef('');
  const partialRef = useRef('');
  const endingUtteranceRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onCommitTextRef = useRef(onCommitText);
  const onUtteranceFinalRef = useRef(onUtteranceFinal);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onCommitTextRef.current = onCommitText;
  }, [onCommitText]);

  useEffect(() => {
    onUtteranceFinalRef.current = onUtteranceFinal;
  }, [onUtteranceFinal]);

  const resetTranscript = useCallback(() => {
    finalsRef.current = '';
    partialRef.current = '';
    setPartialText('');
    setFinalsText('');
  }, []);

  // sending/disabled 变 true 时立刻停麦，避免「等待回复」UI 下 ASR 仍在转
  useEffect(() => {
    if (!disabled) return;
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
  }, [disabled, resetTranscript, status]);

  const stop = useCallback(async (stopOptions?: StopVoiceOptions) => {
    const shouldCommit = stopOptions?.commit !== false;
    const silent = stopOptions?.silent === true;
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
  }, [resetTranscript]);

  const handleEvent = useCallback((event: VoiceAsrServerEvent) => {
    if (event.type === 'partial' && typeof event.text === 'string') {
      partialRef.current = event.text;
      setPartialText(event.text);
      onTranscriptRef.current?.({
        partial: event.text,
        finals: finalsRef.current,
      });
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
        const fullText = finalsRef.current;
        void (async () => {
          await stop({ commit: false });
          if (fullText.trim()) {
            utteranceHandler(fullText.trim());
          }
        })();
      }
      return;
    }

    if (event.type === 'error') {
      const message = event.message || '语音识别失败';
      setError(message);
      toast.error(message);
    }
  }, [stop]);

  const start = useCallback(async () => {
    if (disabled || sessionRef.current || endingUtteranceRef.current) return;

    const { user, ssoEnvironment, isAuthenticated } = useAuthStore.getState();
    const token = user?.stoToken?.trim();
    if (!isAuthenticated || !token) {
      toast.error('请先登录后再使用语音输入');
      return;
    }

    setError(null);
    setStatus('connecting');
    resetTranscript();
    endingUtteranceRef.current = false;

    try {
      let modelId = 'fun-asr-realtime';
      let asrWsPath = '/agent/v1/voice/asr/stream';
      let sampleRate = 16000;
      try {
        const catalog = await fetchVoiceModels();
        modelId = catalog.defaultSttModelId || modelId;
        asrWsPath = catalog.asrWsPath || asrWsPath;
        const active = catalog.models?.stt?.find((m) => m.id === modelId);
        const rate = active?.parameters?.sample_rate;
        if (typeof rate === 'number' && rate > 0) sampleRate = rate;
      } catch {
        // 模型目录失败时仍用内置默认，避免阻塞录音
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
          setError(message);
          toast.error(message);
        },
        onClose: () => {
          if (sessionRef.current === session) {
            sessionRef.current = null;
            setStatus((prev) => (prev === 'stopping' ? prev : 'idle'));
          }
        },
      });
      sessionRef.current = session;
      await session.start({ wsUrl, sampleRate });
      if (sessionRef.current !== session) {
        await session.stopAsync();
        return;
      }
      setStatus('recording');
    } catch (err) {
      sessionRef.current?.stop();
      sessionRef.current = null;
      setStatus('idle');
      endingUtteranceRef.current = false;
      const message = err instanceof Error ? err.message : String(err);
      const denied = /Permission|NotAllowed|权限|denied/i.test(message);
      const tip = denied ? '无法访问麦克风，请在系统设置中允许麦克风权限' : (message || '启动语音识别失败');
      setError(tip);
      toast.error(tip);
    }
  }, [disabled, handleEvent, resetTranscript]);

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
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  return {
    status,
    partialText,
    finalsText,
    error,
    isActive: status === 'recording' || status === 'connecting' || status === 'stopping',
    start,
    stop,
    toggle,
  };
}

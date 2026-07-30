/**
 * 聊天输入框语音转写：点击麦克风开始/结束，识别结果写入 composer。
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
  /** 录音结束并汇总最终文本 */
  onCommitText?: (text: string) => void;
  disabled?: boolean;
}

export function useVoiceAsr(options: UseVoiceAsrOptions = {}) {
  const { onTranscript, onCommitText, disabled = false } = options;
  const [status, setStatus] = useState<VoiceAsrStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [finalsText, setFinalsText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<VoiceAsrSession | null>(null);
  const finalsRef = useRef('');
  const partialRef = useRef('');
  const onTranscriptRef = useRef(onTranscript);
  const onCommitTextRef = useRef(onCommitText);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onCommitTextRef.current = onCommitText;
  }, [onCommitText]);

  const resetTranscript = useCallback(() => {
    finalsRef.current = '';
    partialRef.current = '';
    setPartialText('');
    setFinalsText('');
  }, []);

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
      return;
    }

    if (event.type === 'error') {
      const message = event.message || '语音识别失败';
      setError(message);
      toast.error(message);
    }
  }, []);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      setStatus('idle');
      return;
    }
    setStatus('stopping');
    sessionRef.current = null;
    try {
      await session.stopAsync();
    } catch {
      session.stop();
    }

    const text = `${finalsRef.current}${partialRef.current}`.trim();
    if (text) {
      onCommitTextRef.current?.(text);
    }
    resetTranscript();
    setStatus('idle');
  }, [resetTranscript]);

  const start = useCallback(async () => {
    if (disabled || sessionRef.current) return;

    const { user, ssoEnvironment, isAuthenticated } = useAuthStore.getState();
    const token = user?.stoToken?.trim();
    if (!isAuthenticated || !token) {
      toast.error('请先登录后再使用语音输入');
      return;
    }

    setError(null);
    setStatus('connecting');
    resetTranscript();

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
        // 用户在 connecting 期间点了停止
        await session.stopAsync();
        return;
      }
      setStatus('recording');
    } catch (err) {
      sessionRef.current?.stop();
      sessionRef.current = null;
      setStatus('idle');
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
      void stop();
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

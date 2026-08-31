/**
 * 语音循环能力：ASR、确认倒计时、panel/mic 派生 UI 状态。
 * Chat 按需挂载；Task 不挂。
 *
 * ## Types
 * - `UseInputComposerVoiceOptions` — editor/snapshot、会话 key、disabled/sending、自动发送回调
 * - `InputComposerVoice` — 返回 voicePanelOpen/mode/levels、mic handler、确认取消等
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import { useVoiceAsr } from '@/hooks/useVoiceAsr';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { useVoiceLoopStore } from '@/stores/voice-loop';
import { EMPTY_MENTION_COMPOSER_SNAPSHOT, type MentionComposerSnapshot } from '@/lib/dingtalk-mention-composer';

const VOICE_CONFIRM_MS = 5000;

/** 语音 hook 接线：需能写编辑器与 snapshot，并在确认结束时触发发送 */
export interface UseInputComposerVoiceOptions {
  /** MentionEditor 句柄（写入/清空语音文本） */
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  /** 同步清空/更新 composer snapshot */
  setComposerSnapshot: (snapshot: MentionComposerSnapshot) => void;
  /** 当前会话 key，绑定语音循环 */
  currentSessionKey: string;
  /** 禁用时不可开麦 */
  disabled?: boolean;
  /** 是否正在发送（影响 mic 可用性与恢复逻辑） */
  sending?: boolean;
  /** 确认倒计时结束 / 外部可调用自动发送 */
  onRequestSend: () => void;
}

export function useInputComposerVoice({
  mentionEditorRef,
  setComposerSnapshot,
  currentSessionKey,
  disabled = false,
  sending = false,
  onRequestSend,
}: UseInputComposerVoiceOptions) {
  const { t } = useTranslation('chat');

  const voiceLoopActive = useVoiceLoopStore((s) => s.active);
  const voiceLoopBoundSessionKey = useVoiceLoopStore((s) => s.boundSessionKey);
  const voiceAwaitingAgent = useVoiceLoopStore((s) => s.awaitingAgentReply);
  const voiceExpectMaterialization = useVoiceLoopStore((s) => s.expectMaterialization);
  const setVoiceLoopActive = useVoiceLoopStore((s) => s.setActive);
  const rebindVoiceLoopSession = useVoiceLoopStore((s) => s.rebindSessionKey);
  const clearVoiceLoop = useVoiceLoopStore((s) => s.clear);
  const markVoiceAwaitingAgent = useVoiceLoopStore((s) => s.markAwaitingAgentReply);
  const clearVoiceAwaitingAgent = useVoiceLoopStore((s) => s.clearAwaitingAgentReply);

  const [voiceConfirmText, setVoiceConfirmText] = useState<string | null>(null);
  const [voiceConfirmEndsAt, setVoiceConfirmEndsAt] = useState<number | null>(null);
  const [voiceConfirmRemainMs, setVoiceConfirmRemainMs] = useState(0);
  const prevSendingRef = useRef(sending);
  const resumeListenAfterAgentRef = useRef(false);
  const handleSendRef = useRef(onRequestSend);
  handleSendRef.current = onRequestSend;
  const voiceConfirming = voiceConfirmText != null && voiceConfirmEndsAt != null;

  const clearVoiceDraftText = useCallback(() => {
    mentionEditorRef.current?.clear();
    setComposerSnapshot(EMPTY_MENTION_COMPOSER_SNAPSHOT);
  }, [mentionEditorRef, setComposerSnapshot]);

  const commitVoiceText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const editor = mentionEditorRef.current;
    if (!editor) return;
    const existing = editor.getSnapshot().plainText ?? '';
    if (!existing.trim()) {
      editor.setPlainText(trimmed);
    } else {
      const sep = /\s$/.test(existing) || /[，。！？；、]$/.test(existing) ? '' : ' ';
      editor.setPlainText(`${existing}${sep}${trimmed}`);
    }
    editor.focus();
  }, [mentionEditorRef]);

  const handleVoiceUtteranceFinal = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    mentionEditorRef.current?.setPlainText(trimmed);
    setVoiceConfirmText(trimmed);
    setVoiceConfirmEndsAt(Date.now() + VOICE_CONFIRM_MS);
    setVoiceConfirmRemainMs(VOICE_CONFIRM_MS);
  }, [mentionEditorRef]);

  const cancelVoiceConfirm = useCallback(() => {
    setVoiceConfirmText(null);
    setVoiceConfirmEndsAt(null);
    setVoiceConfirmRemainMs(0);
  }, []);

  const handleCancelVoiceAutoSend = useCallback(() => {
    cancelVoiceConfirm();
    resumeListenAfterAgentRef.current = false;
    clearVoiceLoop();
  }, [cancelVoiceConfirm, clearVoiceLoop]);

  const exitVoiceLoop = useCallback(() => {
    resumeListenAfterAgentRef.current = false;
    clearVoiceLoop();
    cancelVoiceConfirm();
  }, [cancelVoiceConfirm, clearVoiceLoop]);

  const {
    status: voiceStatus,
    partialText: voicePartialText,
    finalsText: voiceFinalsText,
    isActive: voiceRecording,
    levels: voiceLevels,
    start: startVoiceInput,
    stop: stopVoiceInput,
  } = useVoiceAsr({
    disabled: disabled || sending || voiceAwaitingAgent,
    onCommitText: commitVoiceText,
    onUtteranceFinal: handleVoiceUtteranceFinal,
    onSessionFailed: () => {
      resumeListenAfterAgentRef.current = false;
      clearVoiceLoop();
      cancelVoiceConfirm();
      clearVoiceDraftText();
    },
  });

  const stopVoiceInputRef = useRef(stopVoiceInput);
  stopVoiceInputRef.current = stopVoiceInput;

  const voicePreviewText = voiceConfirming
    ? (voiceConfirmText ?? '')
    : `${voiceFinalsText}${voicePartialText}`.trim();

  const handleMicClick = useCallback(() => {
    if (disabled) return;
    if (voiceConfirming) {
      exitVoiceLoop();
      clearVoiceDraftText();
      return;
    }
    if (voiceRecording) {
      exitVoiceLoop();
      void stopVoiceInput({ commit: true });
      return;
    }
    if (voiceLoopActive) {
      exitVoiceLoop();
      return;
    }
    if (sending || voiceAwaitingAgent) return;
    clearVoiceDraftText();
    setVoiceLoopActive(true, currentSessionKey);
    void startVoiceInput();
  }, [
    clearVoiceDraftText,
    currentSessionKey,
    disabled,
    exitVoiceLoop,
    sending,
    setVoiceLoopActive,
    startVoiceInput,
    stopVoiceInput,
    voiceAwaitingAgent,
    voiceConfirming,
    voiceLoopActive,
    voiceRecording,
  ]);

  useEffect(() => {
    const { active, boundSessionKey, expectMaterialization } = useVoiceLoopStore.getState();
    if (!active || !boundSessionKey) return;
    if (boundSessionKey === currentSessionKey) return;

    if (
      expectMaterialization
      && boundSessionKey === DEFAULT_SESSION_KEY
      && currentSessionKey !== DEFAULT_SESSION_KEY
    ) {
      rebindVoiceLoopSession(currentSessionKey);
      return;
    }

    clearVoiceLoop();
    cancelVoiceConfirm();
    clearVoiceDraftText();
    resumeListenAfterAgentRef.current = false;
    void stopVoiceInputRef.current({ commit: false, silent: true });
  }, [
    cancelVoiceConfirm,
    clearVoiceDraftText,
    clearVoiceLoop,
    currentSessionKey,
    rebindVoiceLoopSession,
  ]);

  useEffect(() => {
    if (!voiceConfirming || voiceConfirmEndsAt == null) return;
    const tick = window.setInterval(() => {
      const remain = Math.max(0, voiceConfirmEndsAt - Date.now());
      setVoiceConfirmRemainMs(remain);
      if (remain <= 0) {
        window.clearInterval(tick);
        setVoiceConfirmText(null);
        setVoiceConfirmEndsAt(null);
        setVoiceConfirmRemainMs(0);
        handleSendRef.current();
      }
    }, 50);
    return () => window.clearInterval(tick);
  }, [voiceConfirmEndsAt, voiceConfirming]);

  useEffect(() => {
    const wasSending = prevSendingRef.current;
    prevSendingRef.current = sending;
    const { active, boundSessionKey } = useVoiceLoopStore.getState();
    if (
      wasSending
      && !sending
      && active
      && boundSessionKey === currentSessionKey
      && !voiceConfirming
      && !disabled
    ) {
      resumeListenAfterAgentRef.current = true;
      clearVoiceAwaitingAgent();
    }
  }, [
    clearVoiceAwaitingAgent,
    currentSessionKey,
    disabled,
    sending,
    voiceConfirming,
  ]);

  useEffect(() => {
    if (!resumeListenAfterAgentRef.current) return;
    if (voiceAwaitingAgent || sending || disabled || voiceConfirming || voiceRecording) return;
    const { active, boundSessionKey } = useVoiceLoopStore.getState();
    if (!active || boundSessionKey !== currentSessionKey) {
      resumeListenAfterAgentRef.current = false;
      return;
    }
    resumeListenAfterAgentRef.current = false;
    void startVoiceInput();
  }, [
    currentSessionKey,
    disabled,
    sending,
    startVoiceInput,
    voiceAwaitingAgent,
    voiceConfirming,
    voiceRecording,
  ]);

  useEffect(() => {
    const { active, boundSessionKey, awaitingAgentReply, expectMaterialization } =
      useVoiceLoopStore.getState();
    if (!active || awaitingAgentReply || expectMaterialization) return;
    if (boundSessionKey && boundSessionKey !== currentSessionKey) return;
    if (sending || voiceConfirming || voiceRecording || disabled) return;
    void startVoiceInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount recovery only
  }, []);

  const voiceBoundToCurrentSession = !voiceLoopBoundSessionKey
    || voiceLoopBoundSessionKey === currentSessionKey
    || (
      voiceLoopBoundSessionKey === DEFAULT_SESSION_KEY
      && currentSessionKey !== DEFAULT_SESSION_KEY
      && voiceExpectMaterialization
    );
  const voiceWaitingUi = Boolean(
    voiceLoopActive && voiceBoundToCurrentSession && (sending || voiceAwaitingAgent),
  );
  const voicePanelOpen = Boolean(
    voiceBoundToCurrentSession && (voiceRecording || voiceConfirming || voiceWaitingUi),
  );

  const voiceMode = voiceConfirming
    ? 'confirm' as const
    : voiceWaitingUi
      ? 'waiting' as const
      : 'listening' as const;

  const voiceStatusLabel = voiceConfirming
    ? t('composer.voiceConfirmCountdown', {
        seconds: Math.max(1, Math.ceil(voiceConfirmRemainMs / 1000)),
      })
    : voiceWaitingUi
      ? t('composer.voiceWaitingAgent')
      : voiceStatus === 'connecting'
        ? t('composer.voiceConnecting')
        : voiceStatus === 'stopping'
          ? t('composer.voiceStopping')
          : t('composer.voiceListening');

  const voiceButtonTitle = voiceConfirming
    ? t('composer.voiceConfirmCancelHint')
    : voiceWaitingUi
      ? t('composer.voiceWaitingAgent')
      : voiceStatus === 'connecting'
        ? t('composer.voiceConnecting')
        : voiceRecording
          ? t('composer.voiceListening')
          : voiceLoopActive && voiceBoundToCurrentSession
            ? t('composer.voiceExitLoop')
            : t('composer.voiceInput');

  return {
    voicePanelOpen,
    voiceMode,
    voiceStatusLabel,
    voiceButtonTitle,
    voicePreviewText,
    voiceLevels,
    voiceStatus,
    voiceConfirming,
    voiceConfirmRemainMs,
    voiceLoopActive,
    voiceAwaitingAgent,
    markVoiceAwaitingAgent,
    handleMicClick,
    handleCancelVoiceAutoSend,
    cancelVoiceConfirm,
    clearVoiceDraftText,
  };
}

/** 语音 hook 返回值：面板态、预览文案、mic/确认操作 */
export type InputComposerVoice = ReturnType<typeof useInputComposerVoice>;

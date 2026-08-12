/**
 * Chat 会话输入装配层（单文件）。
 * 在本文件内按需插拔组装 Shell / Editor / Panels / Toolbar / Voice / Send；
 * 能力 hook 来自 `input-composer`，发送 / 排队胶水留在此。
 *
 * ## Types
 * - `ChatInputProps` — onSend/onStop/onQueue、disabled/sending、
 *   seed/editDraft、layout、toolbarInlineSelectors、showProjectPicker 等
 * - 再导出：`FileAttachment`、`ChatDraftWorkflowMeta`、`ChatEditDraftEventDetail`、`CHAT_EDIT_DRAFT_EVENT`
 */
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  X,
  Loader2,
  Mic,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { chatComposerHomeStackShellClass } from '@/lib/surfaces';
import { resolveAgentById, useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { useVoiceLoopStore } from '@/stores/voice-loop';
import { getProjectIdFromProjectAgentId } from '../../../shared/project-agent';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import type { AgentSummary } from '@/types/agent';
import { useTranslation } from 'react-i18next';
import { DingTalkMentionEditor } from '@/components/dingtalk/DingTalkMentionEditor';
import { DingTalkMentionPopover } from '@/components/dingtalk/DingTalkMentionPopover';
import { AttachmentChips, type FileAttachment } from '@/components/attachments';
import { FlyToTargetLayer } from '@/components/fly-to-target';
import { QuickInputIcon } from '@/components/icons/composer-toolbar-icons';
import {
  InputComposerShell,
  InputComposerToolbar,
  InputComposerSendButton,
  InputComposerAgentPicker,
  SkillPickerPanel,
  WorkflowPickerPanel,
  QuickInputPickerPanel,
  useInputComposerCore,
  useInputComposerVoice,
  useInputComposerEditDraft,
  inputComposerHomeToolbarIconBtn,
  CHAT_EDIT_DRAFT_EVENT,
} from '@/components/input-composer';
import type {
  ChatDraftWorkflowMeta,
  ChatEditDraftEventDetail,
} from '@/components/input-composer';
import { HomeProjectWorkPicker } from '@/pages/Home/HomeProjectWorkPicker';
import { VoiceComposerPanel, VoiceTopCrawlWave } from '@/components/chat/VoiceComposerPanel';
import { resolveTrimmedSkillOffset } from '@/lib/dingtalk-mention-composer';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';

export { CHAT_EDIT_DRAFT_EVENT };
export type { FileAttachment } from '@/components/attachments';
export type { ChatDraftWorkflowMeta, ChatEditDraftEventDetail };

function logDingTalkMentionClient(message: string, data: unknown): void {
  void hostApiFetch('/api/logs/client', {
    method: 'POST',
    body: JSON.stringify({
      level: 'info',
      message,
      data,
    }),
  }).catch(() => undefined);
}

/** Chat 装配层 props：发送胶水 + 场景 chrome（底栏/项目选择器/内联选择器） */
interface ChatInputProps {
  onSend: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    workflowSource?: string | null,
    workflowName?: string | null,
    skillMeta?: SkillMeta,
  ) => void;
  onStop?: () => void;
  onQueue?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    skillMeta?: SkillMeta,
  ) => void;
  disabled?: boolean;
  sending?: boolean;
  isEmpty?: boolean;
  engineType?: AgentSummary['engineType'];
  /**
   * 场景标记：`embedded` 表示首页 hub 装配。
   * 排版请用 className / 父级壳。
   */
  variant?: 'default' | 'embedded';
  seedText?: string;
  seedSkillSlug?: string;
  editDraft?: {
    text: string;
    skill?: SkillMeta;
    version: number;
  } | null;
  onEditDraftApplied?: () => void;
  placeholder?: string;
  className?: string;
  composerLayout?: 'default' | 'home';
  toolbarInlineSelectors?: ReactNode;
  showProjectPicker?: boolean;
}

export function ChatInput({
  onSend,
  onStop,
  onQueue,
  disabled = false,
  sending = false,
  isEmpty: _isEmpty = false,
  engineType,
  seedText,
  seedSkillSlug,
  editDraft = null,
  onEditDraftApplied,
  placeholder,
  className,
  composerLayout = 'default',
  toolbarInlineSelectors,
  showProjectPicker = false,
}: ChatInputProps) {
  void _isEmpty;
  const { t } = useTranslation('chat');
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const handleSendRef = useRef<() => void>(() => undefined);

  const agents = useAgentsStore((s) => s.agents);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const pendingProjectId = useChatStore((s) => s.pendingProjectId);
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const sessionWorkspaceByKey = useSessionCatalogStore((s) => s.sessionWorkspaceByKey);
  const markVoiceExpectMaterialization = useVoiceLoopStore((s) => s.markExpectMaterialization);

  const currentAgentName = useMemo(() => {
    const projectId = getProjectIdFromProjectAgentId(currentAgentId ?? '')
      ?? sessionWorkspaceByKey[currentSessionKey]
      ?? pendingProjectId
      ?? null;
    const projectName = projectId
      ? workspaces.find((workspace) => workspace.id === projectId)?.name
      : null;
    return resolveAgentById(agents ?? [], currentAgentId, projectName)?.name ?? currentAgentId;
  }, [agents, currentAgentId, currentSessionKey, pendingProjectId, sessionWorkspaceByKey, workspaces]);

  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const selectedTarget = useMemo(
    () => (agents ?? []).find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  const showAgentPicker = false;

  const layout = composerLayout;
  const isHomeLayout = layout === 'home';
  const targetAgentIdRef = useRef<string | null>(null);
  targetAgentIdRef.current = targetAgentId;
  const coreRef = useRef<ReturnType<typeof useInputComposerCore> | null>(null);

  const core = useInputComposerCore({
    submitMode: 'send',
    disabled,
    onSubmit: () => handleSendRef.current(),
    onKeyDownExtra: (e) => {
      if (e.key !== 'Backspace' || !targetAgentIdRef.current) return false;
      const snap = coreRef.current?.getSnapshot();
      if (snap?.isEmpty) {
        setTargetAgentId(null);
        return true;
      }
      return false;
    },
  });
  coreRef.current = core;

  const {
    mentionEditorRef,
    composerShellRef,
    mentionPopoverHostRef,
    isComposingRef,
    composerSnapshot,
    attachments,
    allReady,
    clearAttachments,
    pickFiles,
    removeAttachment,
    dragOver,
    dingTalkPopoverProps,
    setComposerSnapshot,
    setMentionTrigger,
    closeDingTalkMention,
    skillPicker,
    workflowPicker,
    quickInputPicker,
    pickerMutex,
    getSnapshot,
    handleComposerSnapshotChange,
    handleKeyDown,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = core;

  const voice = useInputComposerVoice({
    mentionEditorRef,
    setComposerSnapshot,
    currentSessionKey,
    disabled,
    sending,
    onRequestSend: () => handleSendRef.current(),
  });

  const {
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
    markVoiceAwaitingAgent,
    handleMicClick,
    handleCancelVoiceAutoSend,
    cancelVoiceConfirm,
  } = voice;

  useInputComposerEditDraft({
    mentionEditorRef,
    editDraft,
    onEditDraftApplied,
    onAfterApply: () => {
      clearAttachments();
      setTargetAgentId(null);
      setPickerOpen(false);
      pickerMutex.closeAll();
      setMentionTrigger(null);
      closeDingTalkMention();
    },
  });

  useEffect(() => {
    if (!disabled) {
      mentionEditorRef.current?.focus();
    }
  }, [disabled, mentionEditorRef]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId) {
      setTargetAgentId(null);
      setPickerOpen(false);
      return;
    }
    if (!(agents ?? []).some((agent) => agent.id === targetAgentId)) {
      setTargetAgentId(null);
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, targetAgentId]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [pickerOpen]);

  const canSend = ((!composerSnapshot.isEmpty && composerSnapshot.plainText.trim().length > 0)
    || composerSnapshot.skill != null
    || attachments.length > 0)
    && allReady
    && !disabled;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    const snapshot = getSnapshot();
    const skillMetaToSend = snapshot.skill
      ? {
        ...snapshot.skill,
        tagOffset: resolveTrimmedSkillOffset(snapshot.plainText, snapshot.skillOffset),
      }
      : composerSnapshot.skill ?? mentionEditorRef.current?.readSkillMeta();
    const textToSend = snapshot.plainText.trim();
    const canSendNow = (textToSend.length > 0 || skillMetaToSend != null || readyAttachments.length > 0)
      && allReady
      && !disabled;
    if (!canSendNow) return;

    cancelVoiceConfirm();

    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;
    const mentionsToSend = snapshot.mentions.length > 0 ? snapshot.mentions : undefined;
    const workflowIdToSend = snapshot.workflowId;
    const workflowSourceToSend = snapshot.workflowSource ?? null;
    const workflowNameToSend = snapshot.workflowName ?? null;

    logDingTalkMentionClient('[dingtalk-mention] chat-input: send snapshot', {
      textLength: textToSend.length,
      mentionCount: snapshot.mentions.length,
      targetAgentId: targetAgentId ?? null,
      attachmentCount: readyAttachments.length,
      hasWorkflowId: Boolean(workflowIdToSend),
      hasSkill: Boolean(skillMetaToSend),
      queued: Boolean(sending && onQueue && !workflowIdToSend),
    });

    mentionEditorRef.current?.clear();
    clearAttachments();
    setMentionTrigger(null);
    setComposerSnapshot({ plainText: '', mentions: [], isEmpty: true });

    const voiceLoop = useVoiceLoopStore.getState();
    if (voiceLoop.active) {
      markVoiceAwaitingAgent();
      if (currentSessionKey === DEFAULT_SESSION_KEY) {
        markVoiceExpectMaterialization();
      }
    }

    if (sending && onQueue && !workflowIdToSend) {
      onQueue(textToSend, attachmentsToSend, targetAgentId, mentionsToSend, workflowIdToSend, skillMetaToSend);
    } else {
      onSend(
        textToSend,
        attachmentsToSend,
        targetAgentId,
        mentionsToSend,
        workflowIdToSend,
        workflowSourceToSend,
        workflowNameToSend,
        skillMetaToSend,
      );
    }
    setTargetAgentId(null);
    setPickerOpen(false);
    pickerMutex.closeAll();
    closeDingTalkMention();
  }, [
    allReady,
    attachments,
    cancelVoiceConfirm,
    clearAttachments,
    closeDingTalkMention,
    composerSnapshot.skill,
    currentSessionKey,
    disabled,
    getSnapshot,
    markVoiceAwaitingAgent,
    markVoiceExpectMaterialization,
    mentionEditorRef,
    onQueue,
    onSend,
    pickerMutex,
    sending,
    setComposerSnapshot,
    setMentionTrigger,
    targetAgentId,
  ]);

  handleSendRef.current = handleSend;

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const composerPlaceholder = disabled && engineType === 'openclaw'
    ? t('composer.gatewayDisconnectedPlaceholder')
    : placeholder?.trim() || t('composer.messagePlaceholder', { agent: currentAgentName });

  const agentPickerExtra = showAgentPicker ? (
    <InputComposerAgentPicker
      layout={layout}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      agents={mentionableAgents}
      selectedAgentId={targetAgentId}
      pickerRef={pickerRef}
      disabled={disabled}
      title={t('composer.pickAgent')}
      panelTitle={t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
      onSelect={(agentId) => {
        setTargetAgentId(agentId);
        setPickerOpen(false);
        mentionEditorRef.current?.focus();
      }}
    />
  ) : null;

  const shell = (
    <InputComposerShell
      ref={composerShellRef}
      layout={layout}
      dragOver={dragOver}
      hasChips={attachments.length > 0}
      overlayOpen={voicePanelOpen}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      topAccessory={
        voicePanelOpen && voiceMode === 'listening' ? <VoiceTopCrawlWave /> : null
      }
      mentionPopover={<DingTalkMentionPopover {...dingTalkPopoverProps} />}
      chips={(
        <AttachmentChips
          attachments={attachments}
          onRemove={removeAttachment}
        />
      )}
      aboveEditor={
        voicePanelOpen || !selectedTarget ? null : (
          <div
            className={cn(
              'px-4 pb-1',
              attachments.length > 0 ? 'pt-2' : 'pt-3',
            )}
          >
            <button
              type="button"
              onClick={() => setTargetAgentId(null)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-primary/6 px-3 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-primary/10"
              title={t('composer.clearTarget')}
            >
              <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        )
      }
      editorOrOverlay={(
        <div ref={mentionPopoverHostRef} className="relative flex-1 overflow-visible">
          {voicePanelOpen ? (
            <VoiceComposerPanel
              mode={voiceMode}
              compact={!isHomeLayout}
              connecting={voiceStatus === 'connecting' || voiceStatus === 'stopping'}
              statusLabel={voiceStatusLabel}
              transcript={voicePreviewText}
              levels={voiceMode === 'listening' ? voiceLevels : undefined}
              confirmSecondsLeft={
                voiceConfirming
                  ? Math.max(1, Math.ceil(voiceConfirmRemainMs / 1000))
                  : undefined
              }
              confirmTitle={
                voiceConfirming ? t('composer.voiceConfirmPreparing') : undefined
              }
            />
          ) : null}
          <div className={cn(voicePanelOpen && 'hidden')}>
            <DingTalkMentionEditor
              ref={mentionEditorRef}
              placeholder={composerPlaceholder}
              disabled={disabled || voicePanelOpen}
              seedText={seedText}
              seedSkillSlug={seedSkillSlug}
              onSnapshotChange={handleComposerSnapshotChange}
              onTriggerChange={setMentionTrigger}
              onTextInput={workflowPicker.handleTextInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
            />
            <SkillPickerPanel
              pickerRef={skillPicker.pickerRef}
              {...skillPicker.panelProps}
            />
            <WorkflowPickerPanel
              pickerRef={workflowPicker.pickerRef}
              {...workflowPicker.panelProps}
            />
            <QuickInputPickerPanel
              pickerRef={quickInputPicker.pickerRef}
              {...quickInputPicker.panelProps}
            />
          </div>
        </div>
      )}
      toolbarLeft={(
        <InputComposerToolbar
          layout={layout}
          disabled={disabled || voicePanelOpen}
          labels={{
            attach: t('composer.attachFiles'),
            skill: t('composer.pickSkill'),
            workflow: t('composer.pickWorkflow'),
            quickInput: t('composer.quickInputTitle'),
          }}
          onAttach={() => { void pickFiles(); }}
          onSkill={skillPicker.toggleToolbar}
          onWorkflow={workflowPicker.toggleToolbar}
          onQuickInput={quickInputPicker.toggle}
          onSaveCaret={() => mentionEditorRef.current?.saveCaret()}
          skillActive={skillPicker.open && skillPicker.mode === 'toolbar'}
          workflowActive={workflowPicker.open}
          quickInputActive={quickInputPicker.open}
          skillButtonRef={skillPicker.buttonRef}
          workflowButtonRef={workflowPicker.buttonRef}
          quickInputButtonRef={quickInputPicker.buttonRef}
          extra={agentPickerExtra}
        />
      )}
      toolbarRight={(
        <>
          {isHomeLayout && !voicePanelOpen ? toolbarInlineSelectors : null}
          {voiceConfirming ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'shrink-0 rounded-full px-3 text-[12px]',
                isHomeLayout ? 'h-[30px]' : 'h-9',
              )}
              onClick={handleCancelVoiceAutoSend}
              title={t('composer.voiceConfirmCancel')}
            >
              {t('composer.voiceConfirmCancel')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            type="button"
            size="icon"
            className={cn(
              isHomeLayout
                ? cn(
                    'h-[30px] w-[30px] shrink-0 rounded-[16px]',
                    inputComposerHomeToolbarIconBtn,
                    voicePanelOpen
                      ? 'bg-red-500/15 text-red-500 hover:bg-red-500/20 hover:text-red-500'
                      : undefined,
                  )
                : cn(
                    'h-9 w-9 shrink-0 rounded-full border transition-all',
                    voicePanelOpen
                      ? 'border-red-500/40 bg-red-500/15 text-red-500 hover:bg-red-500/20'
                      : 'border-transparent text-muted-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]',
                  ),
            )}
            onClick={handleMicClick}
            disabled={disabled || (sending && !voiceLoopActive && !voiceConfirming)}
            title={voiceButtonTitle}
            aria-pressed={voicePanelOpen}
          >
            {voiceStatus === 'connecting' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Mic className="h-4 w-4" aria-hidden />
            )}
          </Button>
          <InputComposerSendButton
            layout={layout}
            sending={sending}
            canSend={canSend}
            canStop={canStop}
            onSend={handleSend}
            onStop={handleStop}
            sendTitle={t('composer.send')}
            stopTitle={t('composer.stop')}
          />
        </>
      )}
    />
  );

  return (
    <div className={cn('w-full pb-0 pt-2 transition-all duration-300', className)}>
      <FlyToTargetLayer targetRef={quickInputPicker.buttonRef}>
        <QuickInputIcon className="h-full w-full text-foreground" />
      </FlyToTargetLayer>
      {showProjectPicker ? (
        <div className={chatComposerHomeStackShellClass}>
          {shell}
          <HomeProjectWorkPicker />
        </div>
      ) : (
        shell
      )}
    </div>
  );
}

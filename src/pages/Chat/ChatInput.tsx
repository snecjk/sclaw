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
  ListTree,
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
import type { FileAttachment } from '@/components/attachments';
import {
  ComposerAttachMenu,
  useComposerAttachSource,
} from '@/components/attachments';
import { AppDevInterfaceCatalogPicker } from '@/components/app-dev/AppDevInterfaceCatalogPicker';
import { DataCenterFilePickerModal } from '@/components/data-center-file-picker';
import { buildComposerGatewayPayload } from '@/lib/composer-gateway-text';
import { EMPTY_MENTION_COMPOSER_SNAPSHOT } from '@/lib/dingtalk-mention-composer';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
import { isSingleTemplateWorkflowSend } from '@/lib/workflow-template-send';
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
  InputComposerToolbarIconTooltip,
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
import type { ModelMessageCompositionV1 } from '../../../shared/model-message-composition';
import {
  clearMainChatComposerDraft,
  publishMainChatComposerDraft,
} from '@/lib/main-chat-composer-draft';
import { ComposerScenarioPills } from '@/components/flow-card/ComposerScenarioPills';
import { useComposerFlowStore } from '@/stores/composer-flow';
import type { EmbedComposerAction } from '../../../shared/embed-composer-actions';

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

export type ChatSendExtras = {
  skillMetas?: SkillMeta[];
  workflows?: Array<{ id: string; name: string; source?: string }>;
  composerSegments?: PersistedComposerSegment[];
  gatewayText?: string;
  composition?: ModelMessageCompositionV1;
};

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
    extras?: ChatSendExtras,
  ) => void;
  onStop?: () => void;
  onQueue?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    skillMeta?: SkillMeta,
    extras?: ChatSendExtras,
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
    segments?: PersistedComposerSegment[];
    attachments?: Array<Partial<FileAttachment> & { id: string; fileName: string; mimeType: string }>;
    version: number;
  } | null;
  onEditDraftApplied?: () => void;
  placeholder?: string;
  className?: string;
  composerLayout?: 'default' | 'home';
  toolbarInlineSelectors?: ReactNode;
  showProjectPicker?: boolean;
  /** 应用开发工作台：隐藏钉钉 @ 提及 */
  hideDingTalkMention?: boolean;
  /** 应用开发工作台：展示「接口清单」（sai-cli list 缓存） */
  showInterfaceCatalog?: boolean;
  /** Scenario pills above composer (e.g. quote workbench quick actions). */
  composerScenarioActions?: EmbedComposerAction[];
  /** 工具栏布局：应用广场窄栏用 dropdown 收起附件/技能等 */
  toolbarToolsLayout?: 'inline' | 'dropdown';
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
  hideDingTalkMention = false,
  showInterfaceCatalog = false,
  composerScenarioActions,
  toolbarToolsLayout = 'inline',
}: ChatInputProps) {
  void _isEmpty;
  const { t } = useTranslation('chat');
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const collapsedToolsAnchorRef = useRef<HTMLElement>(null);
  const handleSendRef = useRef<() => void>(() => undefined);
  const interfaceCatalogRef = useRef<HTMLDivElement>(null);
  const interfaceCatalogButtonRef = useRef<HTMLButtonElement>(null);
  const [interfaceCatalogOpen, setInterfaceCatalogOpen] = useState(false);

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
    () => (agents ?? []).find(
      (agent) => agent.id === targetAgentId && agent.id !== currentAgentId,
    ) ?? null,
    [agents, currentAgentId, targetAgentId],
  );
  const effectiveTargetAgentId = selectedTarget?.id ?? null;
  const showAgentPicker = false;

  const layout = composerLayout;
  const isHomeLayout = layout === 'home';
  const targetAgentIdRef = useRef<string | null>(null);
  const coreRef = useRef<ReturnType<typeof useInputComposerCore> | null>(null);

  useEffect(() => {
    targetAgentIdRef.current = effectiveTargetAgentId;
  }, [effectiveTargetAgentId]);

  const core = useInputComposerCore({
    submitMode: 'send',
    inlineAttachments: true,
    enableDingTalkMention: !hideDingTalkMention,
    disabled,
    onSubmit: () => handleSendRef.current(),
    onClearPendingWorkflow: () => {
      useChatStore.getState().clearPendingWorkflow();
    },
    onKeyDownExtra: (e) => {
      if (e.key !== 'Backspace' || !targetAgentIdRef.current) return false;
      const snap = coreRef.current?.getSnapshot();
      if (snap?.isEmpty) {
        setTargetAgentId(null);
        return true;
      }
      return false;
    },
    toolbarAnchorRef: toolbarToolsLayout === 'dropdown' ? collapsedToolsAnchorRef : undefined,
  });

  useEffect(() => {
    coreRef.current = core;
  }, [core]);

  const {
    mentionEditorRef,
    composerShellRef,
    mentionPopoverHostRef,
    isComposingRef,
    composerSnapshot,
    attachments,
    allReady,
    clearAttachments,
    setAttachmentsSilent,
    pickFiles,
    removeAttachment,
    stageDataCenterFiles,
    handleAttachmentRemoveFromEditor,
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

  // Mirror composer text for learning-center / connector handoff; clear on leave
  // so an unmounted editor reads as empty (same as the user sees on return).
  useEffect(() => {
    publishMainChatComposerDraft(composerSnapshot.plainText);
  }, [composerSnapshot.plainText]);
  useEffect(() => clearMainChatComposerDraft, []);

  const attachSource = useComposerAttachSource({
    pickFiles,
    stageDataCenterFiles,
  });

  const filePickerRequest = useComposerFlowStore((s) => s.filePickerRequest);
  const composerPhaseHint = useComposerFlowStore((s) => s.phaseHint);
  const activeScenarioId = useComposerFlowStore((s) => s.activeScenarioId);

  useEffect(() => {
    if (!filePickerRequest) return;
    const request = useComposerFlowStore.getState().takeFilePickerRequest();
    if (!request) return;
    void (async () => {
      const picked = await pickFiles({ multiple: request.multiple });
      if (!request.autoSend || picked.length === 0 || disabled) return;

      // Remove just-staged files from the composer strip — they go out with this send.
      for (const file of picked) {
        removeAttachment(file.id);
      }

      const sendText = request.sendText?.trim() || '';
      const payload = await buildComposerGatewayPayload({
        segments: picked.map((file) => ({ type: 'file' as const, attachmentId: file.id })),
        plainText: sendText,
        attachments: picked,
      });
      const extras: ChatSendExtras = {
        composerSegments: payload.persistedSegments.length ? payload.persistedSegments : undefined,
        gatewayText: payload.gatewayText,
        composition: payload.composition,
      };

      if (sending && onQueue) {
        onQueue(
          payload.displayText,
          payload.attachments,
          effectiveTargetAgentId,
          undefined,
          null,
          undefined,
          extras,
        );
        return;
      }
      onSend(
        payload.displayText,
        payload.attachments,
        effectiveTargetAgentId,
        undefined,
        null,
        null,
        null,
        undefined,
        extras,
      );
    })();
  }, [
    disabled,
    effectiveTargetAgentId,
    filePickerRequest,
    onQueue,
    onSend,
    pickFiles,
    removeAttachment,
    sending,
  ]);

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
    onApplyAttachments: (draftAttachments) => {
      setAttachmentsSilent(draftAttachments);
    },
    onAfterApply: () => {
      setTargetAgentId(null);
      setPickerOpen(false);
      pickerMutex.closeAll();
      setInterfaceCatalogOpen(false);
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
    || (composerSnapshot.skills?.length ?? 0) > 0
    || (composerSnapshot.workflows?.length ?? 0) > 0
    || (composerSnapshot.attachmentIds?.length ?? 0) > 0
    || attachments.length > 0)
    && allReady
    && !disabled;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    const snapshot = getSnapshot();

    void (async () => {
      const payload = await buildComposerGatewayPayload({
        segments: snapshot.segments ?? [],
        plainText: snapshot.plainText,
        attachments: readyAttachments,
      });

      const displayText = payload.displayText;
      const canSendNow = (
        displayText.length > 0
        || payload.skillMetas.length > 0
        || payload.workflows.length > 0
        || payload.attachments.length > 0
      ) && allReady && !disabled;
      if (!canSendNow) return;

      cancelVoiceConfirm();

      const attachmentsToSend = payload.attachments.length > 0 ? payload.attachments : undefined;
      const mentionsToSend = snapshot.mentions.length > 0 ? snapshot.mentions : undefined;
      const workflowIdToSend = snapshot.workflowId ?? payload.workflows[0]?.id ?? null;
      const workflowSourceToSend = snapshot.workflowSource ?? payload.workflows[0]?.source ?? null;
      const workflowNameToSend = snapshot.workflowName ?? payload.workflows[0]?.name ?? null;
      /** @deprecated 单字段兼容派生；正式坐标为 extras.skillMetas */
      const skillMetaToSend = payload.skillMetas[0]
        ? {
          ...payload.skillMetas[0],
          tagOffset: resolveTrimmedSkillOffset(
            snapshot.plainText,
            snapshot.skillOffset,
          ),
        }
        : undefined;
      const extras: ChatSendExtras = {
        skillMetas: payload.skillMetas.length ? payload.skillMetas : undefined,
        workflows: payload.workflows.length ? payload.workflows : undefined,
        composerSegments: payload.persistedSegments.length ? payload.persistedSegments : undefined,
        gatewayText: payload.gatewayText,
        composition: payload.composition,
      };

      logDingTalkMentionClient('[dingtalk-mention] chat-input: send snapshot', {
        textLength: displayText.length,
        mentionCount: snapshot.mentions.length,
        targetAgentId: effectiveTargetAgentId,
        attachmentCount: payload.attachments.length,
        workflowCount: payload.workflows.length,
        skillCount: payload.skillMetas.length,
        queued: Boolean(sending && onQueue),
      });

      mentionEditorRef.current?.clear();
      clearAttachments();
      setMentionTrigger(null);
      setComposerSnapshot(EMPTY_MENTION_COMPOSER_SNAPSHOT);

      const voiceLoop = useVoiceLoopStore.getState();
      if (voiceLoop.active) {
        markVoiceAwaitingAgent();
        if (currentSessionKey === DEFAULT_SESSION_KEY) {
          markVoiceExpectMaterialization();
        }
      }

      const templateOnlyWorkflow = isSingleTemplateWorkflowSend({
        workflows: payload.workflows,
        skillCount: payload.skillMetas.length,
      });

      if (sending && onQueue && !templateOnlyWorkflow) {
        onQueue(
          displayText,
          attachmentsToSend,
          effectiveTargetAgentId,
          mentionsToSend,
          workflowIdToSend,
          skillMetaToSend,
          extras,
        );
      } else {
        onSend(
          displayText,
          attachmentsToSend,
          effectiveTargetAgentId,
          mentionsToSend,
          workflowIdToSend,
          workflowSourceToSend,
          workflowNameToSend,
          skillMetaToSend,
          extras,
        );
      }
      setTargetAgentId(null);
      setPickerOpen(false);
      pickerMutex.closeAll();
      setInterfaceCatalogOpen(false);
      closeDingTalkMention();
    })();
  }, [
    allReady,
    attachments,
    cancelVoiceConfirm,
    clearAttachments,
    closeDingTalkMention,
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
    effectiveTargetAgentId,
  ]);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

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
      selectedAgentId={effectiveTargetAgentId}
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

  const interfaceCatalogExtra = showInterfaceCatalog ? (
    <InputComposerToolbarIconTooltip label="接口清单">
      <Button
        ref={interfaceCatalogButtonRef}
        variant="ghost"
        type="button"
        className={cn(
          isHomeLayout
            ? cn(
                inputComposerHomeToolbarIconBtn,
                interfaceCatalogOpen && 'bg-[#F0F2F5] hover:bg-[#F0F2F5] dark:bg-muted dark:hover:bg-muted',
              )
            : cn(
                'h-8 w-8 rounded-full p-0 text-muted-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]',
                interfaceCatalogOpen && 'bg-black/5 text-foreground hover:bg-black/5 dark:bg-white/[0.06] dark:hover:bg-white/[0.06]',
              ),
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          mentionEditorRef.current?.rememberCaret();
        }}
        onClick={() => {
          pickerMutex.closeAll();
          setInterfaceCatalogOpen((open) => !open);
        }}
        disabled={disabled || voicePanelOpen}
      >
        <ListTree className="h-4 w-4" aria-hidden />
      </Button>
    </InputComposerToolbarIconTooltip>
  ) : null;

  const toolbarExtra = (
    <>
      {interfaceCatalogExtra}
      {agentPickerExtra}
    </>
  );
  const useCollapsedToolbarTools = toolbarToolsLayout === 'dropdown';
  const attachMenuAnchorRef = useCollapsedToolbarTools
    ? collapsedToolsAnchorRef
    : attachSource.attachButtonRef;
  const toolbarAttachButtonRef = useCollapsedToolbarTools
    ? undefined
    : attachSource.attachButtonRef;
  const toolbarSkillButtonRef = useCollapsedToolbarTools
    ? undefined
    : skillPicker.buttonRef;
  const toolbarWorkflowButtonRef = useCollapsedToolbarTools
    ? undefined
    : workflowPicker.buttonRef;
  const toolbarQuickInputButtonRef = useCollapsedToolbarTools
    ? undefined
    : quickInputPicker.buttonRef;
  const quickInputFlyTargetRef = useCollapsedToolbarTools
    ? collapsedToolsAnchorRef
    : quickInputPicker.buttonRef;

  const shell = (
    <InputComposerShell
      ref={composerShellRef}
      layout={layout}
      dragOver={dragOver}
      hasChips={false}
      overlayOpen={voicePanelOpen}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      topAccessory={
        voicePanelOpen && voiceMode === 'listening' ? <VoiceTopCrawlWave /> : null
      }
      mentionPopover={hideDingTalkMention ? null : <DingTalkMentionPopover {...dingTalkPopoverProps} />}
      chips={null}
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
              onAttachmentRemove={handleAttachmentRemoveFromEditor}
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
            {showInterfaceCatalog ? (
              <AppDevInterfaceCatalogPicker
                ref={interfaceCatalogRef}
                open={interfaceCatalogOpen}
                anchorRef={interfaceCatalogButtonRef}
                onClose={() => setInterfaceCatalogOpen(false)}
                onSelect={(item) => {
                  mentionEditorRef.current?.insertSaiInterface(item.path, item.name);
                  setInterfaceCatalogOpen(false);
                  mentionEditorRef.current?.focus();
                }}
              />
            ) : null}
          </div>
        </div>
      )}
      toolbarLeft={(
        <InputComposerToolbar
          layout={layout}
          toolsLayout={toolbarToolsLayout}
          dropdownToolsAnchorRef={useCollapsedToolbarTools ? collapsedToolsAnchorRef : undefined}
          disabled={disabled || voicePanelOpen}
          labels={{
            attach: t('composer.attachFiles'),
            skill: t('composer.pickSkill'),
            workflow: t('composer.pickWorkflow'),
            quickInput: t('composer.quickInputTitle'),
            toolsMenu: t('composer.toolsMenu', { defaultValue: '工具' }),
          }}
          onAttach={attachSource.openAttachMenu}
          onSkill={useCollapsedToolbarTools ? skillPicker.openToolbar : skillPicker.toggleToolbar}
          onWorkflow={useCollapsedToolbarTools ? workflowPicker.openToolbar : workflowPicker.toggleToolbar}
          onQuickInput={useCollapsedToolbarTools ? quickInputPicker.openToolbar : quickInputPicker.toggle}
          onSaveCaret={() => mentionEditorRef.current?.saveCaret()}
          skillActive={skillPicker.open && skillPicker.mode === 'toolbar'}
          workflowActive={workflowPicker.open}
          quickInputActive={quickInputPicker.open}
          skillButtonRef={toolbarSkillButtonRef}
          workflowButtonRef={toolbarWorkflowButtonRef}
          quickInputButtonRef={toolbarQuickInputButtonRef}
          attachButtonRef={toolbarAttachButtonRef}
          extra={toolbarExtra}
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
          <InputComposerToolbarIconTooltip label={voiceButtonTitle}>
          <span className="inline-flex shrink-0">
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
            aria-pressed={voicePanelOpen}
          >
            {voiceStatus === 'connecting' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Mic className="h-4 w-4" aria-hidden />
            )}
          </Button>
          </span>
          </InputComposerToolbarIconTooltip>
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
      <FlyToTargetLayer targetRef={quickInputFlyTargetRef}>
        <QuickInputIcon className="h-full w-full text-foreground" />
      </FlyToTargetLayer>
      {composerScenarioActions?.length ? (
        <ComposerScenarioPills
          actions={composerScenarioActions}
          activeId={activeScenarioId}
          disabled={disabled || sending}
        />
      ) : null}
      {showProjectPicker ? (
        <div className={chatComposerHomeStackShellClass}>
          {shell}
          <HomeProjectWorkPicker />
        </div>
      ) : (
        shell
      )}
      {composerPhaseHint ? (
        <p className="mt-2 px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
          {composerPhaseHint}
        </p>
      ) : null}
      <ComposerAttachMenu
        open={attachSource.menuOpen}
        onOpenChange={attachSource.setMenuOpen}
        anchorRef={attachMenuAnchorRef}
        showSharedArtifact={attachSource.showSharedArtifact}
        onSelect={attachSource.handleMenuSelect}
        labels={{
          local: t('composer.attachLocal'),
          drive: t('composer.attachDrive'),
          qaArtifact: t('composer.attachQaArtifact'),
          siteSharedArtifact: t('composer.attachSiteShared'),
        }}
      />
      <DataCenterFilePickerModal
        open={attachSource.pickerOpen}
        type={attachSource.pickerType}
        onClose={attachSource.closePicker}
        onConfirm={(files) => { void attachSource.handlePickerConfirm(files); }}
      />
    </div>
  );
}

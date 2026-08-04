/**
 * Recover inline parameter forms and their submit handlers after loadHistory,
 * page refresh, or session switch. Handlers live in memory only; this module
 * re-registers them from message content + workflow memory.
 */
import { toast } from 'sonner';
import { registerParameterFormHandler, hasParameterFormHandler, resolveParameterFormId } from '@/components/parameter-form/form-handlers';
import { buildWorkflowFormConfig, buildStartupPreset, buildWorkflowFormId } from '@/lib/workflow-form-utils';
import type { WorkflowSchemaReadyData } from '@/lib/builtin-tool-envelope';
import { parseStoToolEnvelope } from '@/lib/builtin-tool-envelope';
import { isWorkflowFormUserTurn } from '@/hooks/use-workflow-intent';
import { PARAM_FORM_MARKER_REGEX, parseParameterFormMarker } from '@/lib/parameter-form-marker';
import { currentUserTurnHasWorkflowSubmission } from '@/lib/workflow-card-injection';
import { messageHasWorkflowContext } from '@/lib/workflow-context';
import { deriveSessionLabelFromUserText } from '@/lib/workflow-session-hint';
import {
  extractWorkflowExecutionsFromHistory,
  findLatestSchemaReadyTemplateId,
  seedWorkflowMemoryFromHistory,
  shouldSkipWorkflowSchemaAbsorb,
} from '@/lib/workflow-history-recovery';
import { appendWorkflowSessionRecord } from '@/lib/workflow-session-record-client';
import { clearPendingWorkflowDraft, saveWorkflowRecord, sessionHasWorkflowExecution } from '@/stores/workflow-memory';
import { useChatStore } from '@/stores/chat';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import { getSessionDisplayMessages } from './display-selectors';
import { buildChatSessionRuntimeView } from './runtime-selectors';
import { isToolResultRole } from '@/stores/chat/helpers';
import type { WorkflowSchema } from '@/types/workflow';
import type { ContentBlock, PendingWorkflow, RawMessage } from './types';
import type { ChatGet, ChatSet } from './store-api';

function getPendingWorkflow(sessionKey?: string): PendingWorkflow | null {
  const state = useChatStore.getState();
  return state.workflowChatUiBySessionKey[sessionKey ?? state.currentSessionKey]?.pendingWorkflow ?? null;
}

function rawMessageText(message: RawMessage, getMessageText: (content: unknown) => string): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return getMessageText(content);
  return (content as ContentBlock[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function findLastUserMessageIndex(messages: RawMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

function sessionHistoryHasSchemaReady(
  rawMessages: RawMessage[],
  templateId: string,
): boolean {
  for (const msg of rawMessages) {
    if (!isToolResultRole(msg.role)) continue;
    const envelope = parseStoToolEnvelope(msg.content);
    if (envelope?.type !== 'workflow_schema_ready' || !envelope.success) continue;
    const data = (envelope.data ?? {}) as WorkflowSchemaReadyData;
    if (data.templateId === templateId) return true;
  }
  return false;
}

function findLastRawUserMessage(
  rawMessages: RawMessage[],
): RawMessage | undefined {
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    if (rawMessages[i].role === 'user') return rawMessages[i];
  }
  return undefined;
}

function rawMessageHasWorkflowContextForTemplate(
  text: string,
  templateId: string,
): boolean {
  if (!messageHasWorkflowContext(text)) return false;
  return text.includes(`"templateId": "${templateId}"`)
    || text.includes(`"templateId":"${templateId}"`);
}

function hasLivePendingWorkflowForTemplate(
  templateId: string,
  options?: { allowLivePending?: boolean },
): boolean {
  if (!options?.allowLivePending) return false;
  const state = useChatStore.getState();
  const pending = getPendingWorkflow(state.currentSessionKey);
  // Only treat as "live" while the form submit is in-flight — not after modelGuidanceSent alone.
  return Boolean(
    pending?.templateId === templateId
    && pending.schema
    && isCurrentSessionSending(),
  );
}

/** `/` picker or sendWithWorkflow hidden workflow_context on the latest user turn. */
export function lastUserTurnIsWorkflowPicker(
  templateId: string,
  uiMessages: RawMessage[],
  rawMessages: RawMessage[],
  getMessageText: (content: unknown) => string,
): boolean {
  const lastUserIdx = findLastUserMessageIndex(uiMessages);
  if (lastUserIdx < 0) return false;

  const visible = deriveSessionLabelFromUserText(
    rawMessageText(uiMessages[lastUserIdx], getMessageText),
  );
  if (visible.startsWith('/') && visible.length > 1) return true;

  const lastRawUser = findLastRawUserMessage(rawMessages);
  if (lastRawUser) {
    return rawMessageHasWorkflowContextForTemplate(
      rawMessageText(lastRawUser, getMessageText),
      templateId,
    );
  }
  return false;
}

/**
 * Only inject workflow form when the latest user turn is workflow creation
 * or a `/` workflow picker send (not unrelated chat in a session that once
 * called get_workflow_schema).
 */
export function isWorkflowFormInjectionAllowed(
  templateId: string,
  uiMessages: RawMessage[],
  getMessageText: (content: unknown) => string,
  sessionKey: string,
  options?: {
    rawMessages?: RawMessage[];
    targetAssistantIndex?: number;
    allowLivePending?: boolean;
  },
): boolean {
  if (
    sessionHasWorkflowExecution(sessionKey, templateId)
    && !hasLivePendingWorkflowForTemplate(templateId, options)
  ) {
    return false;
  }

  const lastUserIdx = findLastUserMessageIndex(uiMessages);
  if (lastUserIdx < 0) return false;

  let targetAssistantIdx = -1;
  if (options?.targetAssistantIndex !== undefined) {
    targetAssistantIdx = options.targetAssistantIndex;
  } else {
    for (let i = uiMessages.length - 1; i > lastUserIdx; i--) {
      if (uiMessages[i].role === 'assistant') {
        targetAssistantIdx = i;
        break;
      }
    }
  }

  if (targetAssistantIdx >= 0) {
    const assistant = uiMessages[targetAssistantIdx];
    if (parseParameterFormMarker(getMessageText(assistant.content))) return true;
    if (
      Array.isArray(assistant.content)
      && (assistant.content as ContentBlock[]).some(
        (b) => b.type === 'parameter_form' && b.formContext?.sourceId === templateId,
      )
    ) {
      return true;
    }
  }

  const rawMessages = options?.rawMessages ?? [];
  const lastUser = uiMessages[lastUserIdx];
  const userVisible = deriveSessionLabelFromUserText(
    rawMessageText(lastUser, getMessageText),
  );

  const isPickerTurn = lastUserTurnIsWorkflowPicker(
    templateId,
    uiMessages,
    rawMessages,
    getMessageText,
  );

  if (isPickerTurn) {
    const pending = getPendingWorkflow(sessionKey);
    if (pending?.templateId === templateId && pending.schema) {
      return true;
    }
    const lastRawUser = findLastRawUserMessage(rawMessages);
    if (
      lastRawUser
      && rawMessageHasWorkflowContextForTemplate(
        rawMessageText(lastRawUser, getMessageText),
        templateId,
      )
    ) {
      return true;
    }
    return false;
  }

  const pendingForTurn = getPendingWorkflow(sessionKey);
  const templateName =
    pendingForTurn?.templateId === templateId ? pendingForTurn.templateName : undefined;

  if (options?.allowLivePending) {
    const pending = getPendingWorkflow(sessionKey);
    if (
      pending?.templateId === templateId
      && pending.schema
      && isCurrentSessionSending()
      && isWorkflowFormUserTurn(userVisible, pending.templateName)
    ) {
      return true;
    }
  }

  if (!isWorkflowFormUserTurn(userVisible, templateName)) return false;

  if (rawMessages.length > 0 && sessionHistoryHasSchemaReady(rawMessages, templateId)) {
    return true;
  }

  const pendingState = getPendingWorkflow(sessionKey);
  if (pendingState?.templateId === templateId && pendingState.schema) {
    return true;
  }

  return false;
}

/** Drop pending schema when the latest user turn is not workflow creation. */
export function reconcilePendingWorkflowForSession(
  uiMessages: RawMessage[],
  rawMessages: RawMessage[],
  sessionKey: string,
  getMessageText: (content: unknown) => string,
): void {
  const pending = getPendingWorkflow(sessionKey);
  if (!pending?.templateId) return;
  // 本轮已提交并启动工作流时，pending 属于 stale 状态，避免 B3 等待指示残留
  if (currentUserTurnHasWorkflowSubmission(uiMessages, getMessageText)) {
    useChatStore.getState().clearPendingWorkflow();
    return;
  }
  if (
    isWorkflowFormInjectionAllowed(
      pending.templateId,
      uiMessages,
      getMessageText,
      sessionKey,
      {
        rawMessages,
        allowLivePending: isCurrentSessionSending(),
      },
    )
  ) {
    return;
  }
  useChatStore.getState().clearPendingWorkflow();
}

export interface ParameterFormRecoveryOptions {
  sessionKey: string;
  get: ChatGet;
  set: ChatSet;
  getMessageText: (content: unknown) => string;
  thinkingLevel?: string | null;
}

export interface ParameterFormRecoveryResult {
  messages: RawMessage[];
  /** When true, history snapshot application should return early (async recovery already set state). */
  deferSet: boolean;
}

function registerWorkflowSubmitHandler(
  formId: string,
  params: {
    templateId: string;
    templateName: string;
    schemaHash: string;
    schema: WorkflowSchema;
    get: ChatGet;
  },
): void {
  const { templateId, templateName, schemaHash, schema, get } = params;
  registerParameterFormHandler(formId, async (values: Record<string, unknown>) => {
    const chatState = get();
    try {
      const { createWorkflow, startWorkflowLocal } = await import('@/lib/workflow-api');
      const { saveWorkflowExecution } = await import('@/stores/workflow-memory');
      const created = await createWorkflow({
        templateId,
        startup: buildStartupPreset(values, schemaHash),
        idempotencyKey: `create-wf-${templateId}-${Date.now()}`,
      });
      saveWorkflowRecord(chatState.currentSessionKey, {
        workflowId: created.workflowId,
        templateId,
        templateName,
        schemaHash,
        collectedInputs: values,
        createdAt: Date.now(),
      });
      const trackStartMs = Date.now();
      const { buildWorkflowStartUserText } = await import('@/lib/workflow-local-turn');
      const userText = buildWorkflowStartUserText(schema, values);
      const run = await startWorkflowLocal({
        workflowId: created.workflowId,
        inputs: values,
        idempotencyKey: `start-wf-${created.workflowId}-${Date.now()}`,
        sessionKey: chatState.currentSessionKey,
        triggerType: 'chat',
        // Recovery resumes a legacy form submission created before engine choice
        // was persisted, so retain its historical engine explicitly.
        engineType: 'claude',
        chatCard: { title: templateName, paramsSummary: userText },
      });
      const { registerStartedWorkflowChatCard } = await import('@/lib/workflow-chat-card-registration');
      saveWorkflowExecution({
        sessionKey: chatState.currentSessionKey,
        workflowId: created.workflowId,
        runId: run.runId,
        templateId,
        templateName,
        status: 'running',
        createdAt: trackStartMs,
        updatedAt: trackStartMs,
        collectedInputs: values,
        paramsSummary: userText,
        versionId: run.versionId,
      });
      appendWorkflowSessionRecord({
        phase: 'started',
        sessionKey: chatState.currentSessionKey,
        templateId,
        templateName,
        workflowId: created.workflowId,
        runId: run.runId,
        status: 'running',
        paramsSummary: userText,
        collectedInputs: values,
      });
      await registerStartedWorkflowChatCard({
        runId: run.runId,
        sessionKey: chatState.currentSessionKey,
        title: templateName,
        paramsSummary: userText,
      });
      chatState.clearPendingWorkflow(chatState.currentSessionKey);
    } catch (err) {
      const messageErr = err instanceof Error ? err.message : String(err);
      console.error('[parameter-form-recovery] handler error', err);
      toast.error(`工作流启动失败: ${messageErr}`);
    }
  });
}

export function sessionHasWorkflowParameterForm(
  messages: RawMessage[],
  templateId: string,
): boolean {
  return messages.some((m) => {
    if (!Array.isArray(m.content)) return false;
    return (m.content as ContentBlock[]).some(
      (b) =>
        b.type === 'parameter_form'
        && b.formContext?.sourceId === templateId,
    );
  });
}

/** Store schema in pending workflow; form attaches to the model's assistant reply (not a separate bubble). */
export function applyWorkflowSchemaReady(data: WorkflowSchemaReadyData, sessionKey?: string): boolean {
  if (!data.templateId || !data.schema) return false;
  const targetSessionKey = sessionKey ?? useChatStore.getState().currentSessionKey;
  const templateName = data.templateName ?? data.matchedLabel ?? data.templateId;
  console.log(
    '[sto-workflow-tool] get_workflow_schema ok templateId=%s templateName=%s schemaHash=%s fields=%d steps=%d',
    data.templateId,
    templateName,
    data.schemaHash ?? '(none)',
    data.schema?.fields?.length ?? 0,
    data.schema?.steps?.length ?? 0,
  );
  useChatStore.getState().setPendingWorkflow({
    templateId: data.templateId,
    templateName,
    schemaHash: data.schemaHash,
    schema: data.schema,
    collectedInputs: {},
    frontendFormInserted: false,
    modelGuidanceSent: true,
  }, targetSessionKey);
  return true;
}

/** Read workflow_schema_ready from gateway history (tool results are filtered from UI). */
export function absorbWorkflowSchemaFromToolResults(
  rawMessages: RawMessage[],
  sessionKey?: string,
): void {
  const key = sessionKey ?? useChatStore.getState().currentSessionKey;
  const hints = extractWorkflowExecutionsFromHistory(rawMessages);
  if (hints.length > 0) {
    seedWorkflowMemoryFromHistory(hints, key);
  }
  if (shouldSkipWorkflowSchemaAbsorb(rawMessages, key)) {
    const schemaTemplateId = findLatestSchemaReadyTemplateId(rawMessages);
    if (schemaTemplateId) {
      clearPendingWorkflowDraft(key, schemaTemplateId);
    }
    useChatStore.getState().clearPendingWorkflow(key);
    return;
  }

  for (let i = rawMessages.length - 1; i >= 0; i--) {
    const msg = rawMessages[i];
    if (!isToolResultRole(msg.role)) continue;
    const envelope = parseStoToolEnvelope(msg.content);
    if (envelope?.type !== 'workflow_schema_ready' || !envelope.success) continue;
    applyWorkflowSchemaReady((envelope.data ?? {}) as WorkflowSchemaReadyData, key);
    return;
  }
}

/**
 * Attach the parameter form to the latest assistant reply when schema is pending.
 * Never inserts a separate assistant bubble (keeps the model's business summary).
 */
export function ensureWorkflowParameterFormInjected(
  getMessageText: (content: unknown) => string = defaultGetMessageText,
): boolean {
  const state = useChatStore.getState();
  const pending = getPendingWorkflow(state.currentSessionKey);
  if (!pending?.templateId || !pending.schema || !pending.schemaHash) return false;
  const sessionMessages = getSessionDisplayMessages(state.currentSessionKey);

  if (sessionHasWorkflowParameterForm(sessionMessages, pending.templateId)) {
    if (!pending.frontendFormInserted) {
      state.setPendingWorkflow({ ...pending, frontendFormInserted: true }, state.currentSessionKey);
    }
    return true;
  }

  const resolved = sessionMessages.some((message) => (
    resolveParameterFormForAssistantMessage(message, {
      sessionMessages,
      sessionKey: state.currentSessionKey,
      pendingWorkflow: pending,
      getMessageText,
    }) != null
  ));
  if (resolved && !pending.frontendFormInserted) {
    state.setPendingWorkflow({ ...pending, frontendFormInserted: true }, state.currentSessionKey);
  }
  return resolved;
}

function defaultGetMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ContentBlock[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** True when `message` is the latest assistant reply after the last user turn. */
export function isLastAssistantAfterUserTurn(
  message: RawMessage,
  messages: RawMessage[],
): boolean {
  if (message.role !== 'assistant') return false;
  const msgIdx = message.id
    ? messages.findIndex((m) => m.id === message.id)
    : messages.indexOf(message);
  if (msgIdx < 0) return false;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (msgIdx <= lastUserIdx) return false;

  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    if (messages[i].role === 'assistant') {
      return i === msgIdx;
    }
  }
  return false;
}

export function buildWorkflowParameterFormFromPending(
  pending: PendingWorkflow,
): {
  formId: string;
  formConfig: import('@/types/user-form').UserFormConfig;
  formContext: { source: 'workflow' | 'tool' | 'skill'; sourceId: string; schemaHash?: string };
} | null {
  if (!pending.schema || !pending.schemaHash) return null;
  const sessionKey = useChatStore.getState().currentSessionKey;
  if (
    sessionHasWorkflowExecution(sessionKey, pending.templateId)
    && !hasLivePendingWorkflowForTemplate(pending.templateId, { allowLivePending: true })
  ) {
    return null;
  }

  const formId = buildWorkflowFormId(pending.templateId);
  return {
    formId: resolveParameterFormId(formId),
    formConfig: buildWorkflowFormConfig(
      pending.schema,
      '',
      pending.collectedInputs ?? {},
      { templateId: pending.templateId, schemaHash: pending.schemaHash },
    ),
    formContext: {
      source: 'workflow' as const,
      sourceId: pending.templateId,
      schemaHash: pending.schemaHash,
    },
  };
}

/** Resolve inline parameter form from message blocks or live pending workflow state. */
export function resolveParameterFormForAssistantMessage(
  message: RawMessage,
  options: {
    sessionMessages: RawMessage[];
    sessionKey: string;
    pendingWorkflow: PendingWorkflow | null;
    getMessageText: (content: unknown) => string;
  },
): ReturnType<typeof buildWorkflowParameterFormFromPending> {
  const { sessionMessages, sessionKey, pendingWorkflow, getMessageText } = options;

  if (currentUserTurnHasWorkflowSubmission(sessionMessages, getMessageText)) {
    return null;
  }

  const contentBlocks = Array.isArray(message.content)
    ? (message.content as ContentBlock[])
    : [];
  for (const block of contentBlocks) {
    if (
      block.type === 'parameter_form'
      && block.formId
      && block.formConfig
      && block.formContext
    ) {
      const formContext = block.formContext as {
        source: 'workflow' | 'tool' | 'skill';
        sourceId: string;
        schemaHash?: string;
      };
      if (
        formContext.source === 'workflow'
        && formContext.sourceId
        && sessionHasWorkflowExecution(sessionKey, formContext.sourceId)
        && !hasLivePendingWorkflowForTemplate(formContext.sourceId, { allowLivePending: true })
      ) {
        return null;
      }
      return {
        formId: block.formId,
        formConfig: block.formConfig as import('@/types/user-form').UserFormConfig,
        formContext: formContext,
      };
    }
  }

  for (const block of contentBlocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const parsed = parseParameterFormMarker(block.text);
      if (!parsed) continue;
      if (
        sessionHasWorkflowExecution(sessionKey, parsed.templateId)
        && !hasLivePendingWorkflowForTemplate(parsed.templateId, { allowLivePending: true })
      ) {
        return null;
      }
      if (
        !pendingWorkflow
        || pendingWorkflow.templateId !== parsed.templateId
        || !pendingWorkflow.schema
      ) {
        continue;
      }
      return {
        formId: resolveParameterFormId(buildWorkflowFormId(parsed.templateId)),
        formConfig: buildWorkflowFormConfig(
          pendingWorkflow.schema,
          '',
          pendingWorkflow.collectedInputs ?? {},
          { templateId: parsed.templateId, schemaHash: parsed.schemaHash },
        ),
        formContext: {
          source: 'workflow',
          sourceId: parsed.templateId,
          schemaHash: parsed.schemaHash,
        },
      };
    }
  }

  if (!pendingWorkflow?.schema || !pendingWorkflow.schemaHash) return null;
  if (!isLastAssistantAfterUserTurn(message, sessionMessages)) return null;
  if (
    !isWorkflowFormInjectionAllowed(
      pendingWorkflow.templateId,
      sessionMessages,
      getMessageText,
      sessionKey,
      { allowLivePending: true },
    )
  ) {
    return null;
  }

  return buildWorkflowParameterFormFromPending(pendingWorkflow);
}

function findLastAssistantWithMarker(
  messages: RawMessage[],
  getMessageText: (content: unknown) => string,
  sessionKey?: string,
): { index: number; message: RawMessage; templateId: string; schemaHash: string } | null {
  const lastUserIdx = findLastUserMessageIndex(messages);
  if (lastUserIdx < 0) return null;

  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const text = getMessageText(m.content);
    const match = text.match(PARAM_FORM_MARKER_REGEX);
    const hasFormBlock = Array.isArray(m.content)
      ? (m.content as ContentBlock[]).some((b) => b.type === 'parameter_form')
      : false;
    if (match && !hasFormBlock) {
      const templateId = match[1];
      if (sessionKey && sessionHasWorkflowExecution(sessionKey, templateId)) continue;
      return { index: i, message: m, templateId, schemaHash: match[2] };
    }
  }
  return null;
}

async function recoverFormForAssistantMarker(
  marker: { index: number; message: RawMessage; templateId: string; schemaHash: string },
  messages: RawMessage[],
  options: {
    sessionKey: string;
    get: ChatGet;
    getMessageText: (content: unknown) => string;
    collectedInputs?: Record<string, unknown>;
    templateName?: string;
  },
): Promise<RawMessage[]> {
  const { sessionKey, get, collectedInputs = {}, templateName } = options;
  const hasFormBlock = Array.isArray(marker.message.content)
    && (marker.message.content as ContentBlock[]).some((b) => b.type === 'parameter_form');
  if (hasFormBlock) return messages;

  const { getStartupSchema } = await import('@/lib/workflow-api');
  const { getLatestWorkflow, getPendingWorkflowDraft } = await import('@/stores/workflow-memory');
  const startup = await getStartupSchema(marker.templateId);
  const draft = getPendingWorkflowDraft(sessionKey, marker.templateId);
  const latest = getLatestWorkflow(sessionKey);
  const resolvedName =
    templateName
    ?? draft?.templateName
    ?? latest?.templateName
    ?? marker.templateId;
  const inputs = collectedInputs ?? draft?.collectedInputs ?? latest?.collectedInputs ?? {};

  const formId = buildWorkflowFormId(marker.templateId);
  registerWorkflowSubmitHandler(formId, {
    templateId: marker.templateId,
    templateName: resolvedName,
    schemaHash: startup.schemaHash,
    schema: startup.schema,
    get,
  });
  get().setPendingWorkflow({
    templateId: marker.templateId,
    templateName: resolvedName,
    schemaHash: startup.schemaHash,
    schema: startup.schema,
    collectedInputs: inputs,
    frontendFormInserted: true,
    modelGuidanceSent: true,
  }, sessionKey);
  return messages;
}

/** Register submit handler when message only has a ParameterForm text marker. */
export function ensureWorkflowParameterFormHandler(
  formId: string,
  templateId: string,
  schemaHash: string,
  get: ChatGet,
): void {
  if (hasParameterFormHandler(formId)) return;
  void (async () => {
    try {
      const { getStartupSchema } = await import('@/lib/workflow-api');
      const { getLatestWorkflow, getPendingWorkflowDraft } = await import('@/stores/workflow-memory');
      const sessionKey = get().currentSessionKey;
      const startup = await getStartupSchema(templateId);
      const draft = getPendingWorkflowDraft(sessionKey, templateId);
      const latest = getLatestWorkflow(sessionKey);
      registerWorkflowSubmitHandler(formId, {
        templateId,
        templateName: draft?.templateName ?? latest?.templateName ?? templateId,
        schemaHash,
        schema: startup.schema,
        get,
      });
    } catch (err) {
      console.error('[parameter-form-recovery] ensure handler failed:', err);
    }
  })();
}

function recoverHandlerForExistingFormBlock(
  messages: RawMessage[],
  options: ParameterFormRecoveryOptions,
): void {
  const { sessionKey, get } = options;

  void (async () => {
    let target: {
      formId: string;
      formContext: { sourceId: string; schemaHash: string };
    } | null = null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
      for (const block of m.content as ContentBlock[]) {
        if (block.type === 'parameter_form' && block.formId && !hasParameterFormHandler(block.formId)) {
          target = {
            formId: block.formId,
            formContext: block.formContext as { sourceId: string; schemaHash: string },
          };
          break;
        }
      }
      if (target) break;
    }

    if (!target) return;

    try {
      const templateId = target.formContext.sourceId;
      if (sessionHasWorkflowExecution(sessionKey, templateId)) return;

      const { getSessionWorkflows } = await import('@/stores/workflow-memory');
      const { getStartupSchema } = await import('@/lib/workflow-api');
      const sessionWorkflow = getSessionWorkflows(sessionKey).find((w) => w.templateId === templateId);
      const templateName = sessionWorkflow?.templateName ?? templateId;
      const startup = await getStartupSchema(templateId);
      registerWorkflowSubmitHandler(target.formId, {
        templateId,
        templateName,
        schemaHash: target.formContext.schemaHash,
        schema: startup.schema,
        get,
      });
    } catch (err) {
      console.error('[parameter-form-recovery] handler recovery failed:', err);
    }
  })();
}

/**
 * Re-inject parameter_form blocks and re-register submit handlers.
 * Call before set({ messages }) in loadHistory.
 */
export function recoverParameterFormsOnHistoryLoad(
  inputMessages: RawMessage[],
  options: ParameterFormRecoveryOptions,
): ParameterFormRecoveryResult {
  const { sessionKey, get, getMessageText } = options;
  const finalMessages = inputMessages;
  const pendingWorkflow = get().workflowChatUiBySessionKey[sessionKey]?.pendingWorkflow ?? null;

  const lastAssistantWithMarker = findLastAssistantWithMarker(finalMessages, getMessageText, sessionKey);

  if (
    lastAssistantWithMarker
    && (!pendingWorkflow || !pendingWorkflow.schema)
    && !sessionHasWorkflowExecution(sessionKey, lastAssistantWithMarker.templateId)
    && isWorkflowFormInjectionAllowed(
      lastAssistantWithMarker.templateId,
      finalMessages,
      getMessageText,
      sessionKey,
      { targetAssistantIndex: lastAssistantWithMarker.index },
    )
  ) {
    void (async () => {
      try {
        await recoverFormForAssistantMarker(
          lastAssistantWithMarker,
          finalMessages,
          { sessionKey, get, getMessageText },
        );
      } catch (err) {
        console.error('[parameter-form-recovery] async recovery failed:', err);
      }
    })();
  }

  recoverHandlerForExistingFormBlock(finalMessages, options);

  if (
    lastAssistantWithMarker
    && pendingWorkflow
    && pendingWorkflow.schema
    && !sessionHasWorkflowExecution(sessionKey, pendingWorkflow.templateId)
    && isWorkflowFormInjectionAllowed(
      pendingWorkflow.templateId,
      finalMessages,
      getMessageText,
      sessionKey,
      { targetAssistantIndex: lastAssistantWithMarker.index },
    )
  ) {
    const formId = buildWorkflowFormId(pendingWorkflow.templateId);
    registerWorkflowSubmitHandler(formId, {
      templateId: pendingWorkflow.templateId,
      templateName: pendingWorkflow.templateName,
      schemaHash: pendingWorkflow.schemaHash,
      schema: pendingWorkflow.schema,
      get,
    });
  }

  return { messages: finalMessages, deferSet: false };
}
function isCurrentSessionSending(): boolean {
  const sessionKey = useChatStore.getState().currentSessionKey;
  return buildChatSessionRuntimeView(
    useChatRuntimeV2Store.getState().sessionsByKey[sessionKey],
  ).sending;
}

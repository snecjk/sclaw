/**
 * Recover inline parameter forms and their submit handlers after loadHistory,
 * page refresh, or session switch. Handlers live in memory only; this module
 * re-registers them from message content + workflow memory.
 */
import { toast } from 'sonner';
import { registerParameterFormHandler, hasParameterFormHandler } from '@/components/parameter-form/form-handlers';
import { buildWorkflowFormConfig, buildStartupPreset } from '@/lib/workflow-form-utils';
import type { WorkflowSchemaReadyData } from '@/lib/builtin-tool-envelope';
import { parseStoToolEnvelope } from '@/lib/builtin-tool-envelope';
import { isWorkflowCreationIntent } from '@/hooks/use-workflow-intent';
import { PARAM_FORM_MARKER_REGEX, parseParameterFormMarker } from '@/lib/parameter-form-marker';
import { messageHasWorkflowContext } from '@/lib/workflow-context';
import { deriveSessionLabelFromUserText } from '@/lib/workflow-session-hint';
import { saveWorkflowRecord, sessionHasWorkflowExecution } from '@/stores/workflow-memory';
import { useChatStore } from '@/stores/chat';
import { isToolResultRole } from '@/stores/chat/helpers';
import type { WorkflowSchema } from '@/types/workflow';
import type { ContentBlock, RawMessage } from './types';
import type { ChatGet, ChatSet } from './store-api';

export const PARAM_FORM_MARKER_REGEX =
  /<ParameterForm\s+templateId="([^"]+)"\s+schemaHash="([^"]+)"\s*\/>/i;

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
  if (sessionHasWorkflowExecution(sessionKey, templateId)) return false;

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
    const pending = useChatStore.getState().pendingWorkflow;
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

  if (!isWorkflowCreationIntent(userVisible)) return false;

  if (rawMessages.length > 0 && sessionHistoryHasSchemaReady(rawMessages, templateId)) {
    return true;
  }

  if (options?.allowLivePending) {
    const state = useChatStore.getState();
    const pending = state.pendingWorkflow;
    if (
      pending?.templateId === templateId
      && pending.schema
      && (state.sending || pending.modelGuidanceSent)
    ) {
      return true;
    }
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
  const pending = useChatStore.getState().pendingWorkflow;
  if (!pending?.templateId) return;
  if (
    isWorkflowFormInjectionAllowed(
      pending.templateId,
      uiMessages,
      getMessageText,
      sessionKey,
      { rawMessages, allowLivePending: useChatStore.getState().sending },
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
  /** When true, applyLoadedMessages should return early (async recovery already set state). */
  deferSet: boolean;
}

/** Preserve frontend-only parameter_form blocks when Gateway history overwrites messages. */
export function mergeParameterFormBlocksFromCurrent(
  loaded: RawMessage[],
  current: RawMessage[],
  getMessageText: (content: unknown) => string,
): RawMessage[] {
  if (current.length === 0) return loaded;

  const merged = loaded.map((loadedMsg) => {
    if (loadedMsg.role !== 'assistant' || !Array.isArray(loadedMsg.content)) return loadedMsg;

    const loadedHasForm = (loadedMsg.content as ContentBlock[]).some((b) => b.type === 'parameter_form');
    if (loadedHasForm) return loadedMsg;

    const match = loadedMsg.id
      ? current.find((m) => m.id === loadedMsg.id)
      : current.find(
          (m) =>
            m.role === 'assistant'
            && getMessageText(m.content) === getMessageText(loadedMsg.content),
        );

    if (!match || !Array.isArray(match.content)) return loadedMsg;

    const formBlock = (match.content as ContentBlock[]).find((b) => b.type === 'parameter_form');
    if (!formBlock) return loadedMsg;

    const formContext = formBlock.formContext as { source?: string; sourceId?: string } | undefined;
    if (
      formContext?.source === 'workflow'
      && formContext.sourceId
      && sessionHasWorkflowExecution(useChatStore.getState().currentSessionKey, formContext.sourceId)
    ) {
      return loadedMsg;
    }

    const strippedContent = (loadedMsg.content as ContentBlock[]).map((block) =>
      block.type === 'text' && typeof block.text === 'string'
        ? { ...block, text: block.text.replace(PARAM_FORM_MARKER_REGEX, '').trim() }
        : block,
    );
    return { ...loadedMsg, content: [...strippedContent, formBlock] };
  });

  // Keep standalone frontend-injected form messages (not present in Gateway history).
  const orphans: RawMessage[] = [];
  for (const msg of current) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    const formBlock = (msg.content as ContentBlock[]).find((b) => b.type === 'parameter_form');
    if (!formBlock) continue;

    const formContext = formBlock.formContext as { source?: string; sourceId?: string } | undefined;
    if (
      formContext?.source === 'workflow'
      && formContext.sourceId
      && sessionHasWorkflowExecution(useChatStore.getState().currentSessionKey, formContext.sourceId)
    ) {
      continue;
    }

    const templateId = formContext?.sourceId;
    if (templateId && sessionHasWorkflowParameterForm(merged, templateId)) continue;

    const inLoaded = msg.id
      ? loaded.some((m) => m.id === msg.id)
      : loaded.some(
          (m) =>
            m.role === 'assistant'
            && getMessageText(m.content) === getMessageText(msg.content),
        );
    if (inLoaded) continue;

    if (msg.id && orphans.some((o) => o.id === msg.id)) continue;
    orphans.push(msg);
  }

  return orphans.length > 0 ? [...merged, ...orphans] : merged;
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
      const { createWorkflow, startWorkflow, beginWorkflowRunSseTrace } = await import('@/lib/workflow-api');
      const { saveWorkflowExecution } = await import('@/stores/workflow-memory');
      const { invokeIpc } = await import('@/lib/api-client');
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
      const run = await startWorkflow(created.workflowId, {
        inputs: values,
        idempotencyKey: `start-wf-${created.workflowId}-${Date.now()}`,
      });
      const { appendWorkflowStartedLocalTurn, buildWorkflowStartUserText } = await import('@/lib/workflow-local-turn');
      const userText = buildWorkflowStartUserText(schema, values);
      appendWorkflowStartedLocalTurn({
        userText,
        templateName,
        runId: run.runId,
      });
      await invokeIpc('workflow:startTracking', {
        runId: run.runId,
        workflowId: created.workflowId,
        sessionKey: chatState.currentSessionKey,
        agentId: chatState.currentAgentId,
      });
      beginWorkflowRunSseTrace(run.runId);
      saveWorkflowExecution({
        sessionKey: chatState.currentSessionKey,
        workflowId: created.workflowId,
        runId: run.runId,
        templateId,
        templateName,
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        collectedInputs: values,
        paramsSummary: userText,
      });
      chatState.setWorkflowCardState(run.runId, {
        runId: run.runId,
        workflowId: created.workflowId,
        status: 'running',
        progress: 0,
        steps: [],
        startedAt: new Date().toISOString(),
      });
      chatState.clearPendingWorkflow();
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

/** Store schema in pending workflow; injection happens after history sync. */
export function applyWorkflowSchemaReady(data: WorkflowSchemaReadyData): void {
  if (!data.templateId || !data.schema) return;
  const templateName = data.templateName ?? data.matchedLabel ?? data.templateId;
  useChatStore.getState().setPendingWorkflow({
    templateId: data.templateId,
    templateName,
    schemaHash: data.schemaHash,
    schema: data.schema,
    collectedInputs: {},
    frontendFormInserted: false,
    modelGuidanceSent: true,
  });
}

/** Read workflow_schema_ready from gateway history (tool results are filtered from UI). */
export function absorbWorkflowSchemaFromToolResults(rawMessages: RawMessage[]): void {
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    const msg = rawMessages[i];
    if (!isToolResultRole(msg.role)) continue;
    const envelope = parseStoToolEnvelope(msg.content);
    if (envelope?.type !== 'workflow_schema_ready' || !envelope.success) continue;
    applyWorkflowSchemaReady((envelope.data ?? {}) as WorkflowSchemaReadyData);
    return;
  }
}

/**
 * Sync frontendFormInserted when a form is already visible.
 * Does NOT insert a new assistant message — NL flow waits for model output
 * with `<ParameterForm />` marker, then maybeAppend / extractParameterForm render it.
 */
export function ensureWorkflowParameterFormInjected(): boolean {
  const state = useChatStore.getState();
  const pending = state.pendingWorkflow;
  if (!pending?.templateId || !pending.schema || !pending.schemaHash) return false;

  if (sessionHasWorkflowParameterForm(state.messages, pending.templateId)) {
    if (!pending.frontendFormInserted) {
      state.setPendingWorkflow({ ...pending, frontendFormInserted: true });
    }
    return true;
  }

  return false;
}

/**
 * Append parameter_form block to an assistant message when schema is pending.
 * NL tool path: model may not output `<ParameterForm />` marker — inject after final reply.
 */
export function appendWorkflowParameterFormToMessage(
  message: RawMessage,
  getMessageText: (content: unknown) => string,
  options?: { rawMessages?: RawMessage[]; allowLivePending?: boolean },
): RawMessage | null {
  const pending = useChatStore.getState().pendingWorkflow;
  if (!pending?.schema || !pending.schemaHash) return null;
  if (message.role !== 'assistant') return null;
  if (pending.frontendFormInserted) return null;

  const sessionKey = useChatStore.getState().currentSessionKey;
  if (sessionHasWorkflowExecution(sessionKey, pending.templateId)) return null;

  const uiMessages = useChatStore.getState().messages;
  const targetIdx = uiMessages.findIndex((m) => m.id && m.id === message.id);
  if (
    !isWorkflowFormInjectionAllowed(
      pending.templateId,
      targetIdx >= 0 ? uiMessages : [...uiMessages, message],
      getMessageText,
      sessionKey,
      {
        rawMessages: options?.rawMessages,
        targetAssistantIndex: targetIdx >= 0 ? targetIdx : uiMessages.length,
        allowLivePending: options?.allowLivePending,
      },
    )
  ) {
    return null;
  }

  const content = message.content;
  if (Array.isArray(content) && (content as ContentBlock[]).some((b) => b.type === 'parameter_form')) {
    return null;
  }

  const messageText = getMessageText(message.content);
  const marker = parseParameterFormMarker(messageText);
  const strippedText = marker ? messageText.replace(PARAM_FORM_MARKER_REGEX, '').trim() : messageText;
  const strippedContent = marker && Array.isArray(message.content)
    ? (message.content as ContentBlock[]).map((block) =>
        block.type === 'text' && typeof block.text === 'string'
          ? { ...block, text: block.text.replace(PARAM_FORM_MARKER_REGEX, '').trim() }
          : block,
      )
    : message.content;

  const formId = `workflow-form-${pending.templateId}-${Date.now()}`;
  const formConfig = buildWorkflowFormConfig(pending.schema, '', pending.collectedInputs ?? {});
  registerWorkflowSubmitHandler(formId, {
    templateId: pending.templateId,
    templateName: pending.templateName,
    schemaHash: pending.schemaHash,
    schema: pending.schema,
    get: () => useChatStore.getState(),
  });

  const newBlock: ContentBlock = {
    type: 'parameter_form',
    formId,
    formConfig,
    formContext: { source: 'workflow', sourceId: pending.templateId, schemaHash: pending.schemaHash },
  };

  useChatStore.getState().setPendingWorkflow({
    ...pending,
    frontendFormInserted: true,
  });

  if (Array.isArray(message.content)) {
    return { ...message, content: [...(strippedContent as ContentBlock[]), newBlock] };
  }
  if (typeof message.content === 'string' && message.content.trim()) {
    return { ...message, content: [{ type: 'text', text: strippedText }, newBlock] };
  }
  return { ...message, content: [newBlock] };
}

/** Patch the last assistant reply (after last user turn) with workflow parameter form. */
export function patchLastAssistantWithWorkflowForm(
  messages: RawMessage[],
  getMessageText: (content: unknown) => string,
  options?: { rawMessages?: RawMessage[] },
): RawMessage[] {
  if (useChatStore.getState().sending) return messages;

  const pending = useChatStore.getState().pendingWorkflow;
  if (!pending?.templateId || !pending.schema) return messages;

  const sessionKey = useChatStore.getState().currentSessionKey;
  if (
    !isWorkflowFormInjectionAllowed(
      pending.templateId,
      messages,
      getMessageText,
      sessionKey,
      { rawMessages: options?.rawMessages },
    )
  ) {
    return messages;
  }

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const text = getMessageText(m.content).trim();
    if (!text) continue;
    const updated = appendWorkflowParameterFormToMessage(m, getMessageText, {
      rawMessages: options?.rawMessages,
    });
    if (updated) {
      const next = [...messages];
      next[i] = updated;
      return next;
    }
    break;
  }
  return messages;
}

/** Insert inline parameter form after schema is ready; user submit creates & starts workflow. */
export function injectWorkflowParameterForm(params: {
  templateId: string;
  templateName: string;
  schemaHash: string;
  schema: WorkflowSchema;
  introText?: string;
}): boolean {
  const get = () => useChatStore.getState();

  if (sessionHasWorkflowParameterForm(get().messages, params.templateId)) {
    return false;
  }

  const formId = `workflow-form-${params.templateId}-${Date.now()}`;
  const formConfig = buildWorkflowFormConfig(params.schema, '', {});
  registerWorkflowSubmitHandler(formId, {
    templateId: params.templateId,
    templateName: params.templateName,
    schemaHash: params.schemaHash,
    schema: params.schema,
    get,
  });

  const intro =
    params.introText
    ?? `请确认「${params.templateName}」工作流的运行参数（可在表单中逐步填写）：`;

  useChatStore.setState((s) => ({
    messages: [
      ...s.messages,
      {
        role: 'assistant',
        content: [
          { type: 'text', text: intro },
          {
            type: 'parameter_form',
            formId,
            formConfig,
            formContext: {
              source: 'workflow',
              sourceId: params.templateId,
              schemaHash: params.schemaHash,
            },
          },
        ],
        timestamp: Date.now() / 1000,
        id: crypto.randomUUID(),
      } as RawMessage,
    ],
  }));

  get().setPendingWorkflow({
    templateId: params.templateId,
    templateName: params.templateName,
    schemaHash: params.schemaHash,
    schema: params.schema,
    collectedInputs: {},
    frontendFormInserted: true,
    modelGuidanceSent: true,
  });
  return true;
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
  const { sessionKey, get, getMessageText, collectedInputs = {}, templateName } = options;
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

  const formId = `workflow-form-${marker.templateId}-${Date.now()}`;
  const formConfig = buildWorkflowFormConfig(startup.schema, '', inputs);

  registerWorkflowSubmitHandler(formId, {
    templateId: marker.templateId,
    templateName: resolvedName,
    schemaHash: startup.schemaHash,
    schema: startup.schema,
    get,
  });

  const recoveredMessages = [...messages];
  recoveredMessages[marker.index] = {
    ...marker.message,
    content: injectFormBlock(
      marker.message,
      formId,
      formConfig,
      { source: 'workflow', sourceId: marker.templateId, schemaHash: startup.schemaHash },
      getMessageText,
    ),
  };
  return recoveredMessages;
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

function injectFormBlock(
  message: RawMessage,
  formId: string,
  formConfig: ReturnType<typeof buildWorkflowFormConfig>,
  formContext: { source: 'workflow' | 'tool' | 'skill'; sourceId: string; schemaHash?: string },
  getMessageText: (content: unknown) => string,
): ContentBlock[] {
  const strippedText = getMessageText(message.content).replace(PARAM_FORM_MARKER_REGEX, '').trim();
  const formBlock: ContentBlock = {
    type: 'parameter_form',
    formId,
    formConfig,
    formContext,
  };
  return [{ type: 'text', text: strippedText }, formBlock];
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
  const { sessionKey, get, set, getMessageText, thinkingLevel = null } = options;
  let finalMessages = inputMessages;
  const { pendingWorkflow } = get();

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
        const recoveredMessages = await recoverFormForAssistantMarker(
          lastAssistantWithMarker,
          finalMessages,
          { sessionKey, get, getMessageText },
        );
        if (get().currentSessionKey === sessionKey) {
          set({ messages: recoveredMessages, thinkingLevel, loading: false });
        }
      } catch (err) {
        console.error('[parameter-form-recovery] async recovery failed:', err);
        if (get().currentSessionKey === sessionKey) {
          set({ loading: false });
        }
      }
    })();

    recoverHandlerForExistingFormBlock(finalMessages, options);
    return { messages: finalMessages, deferSet: true };
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
    const formId = `workflow-form-${pendingWorkflow.templateId}-${Date.now()}`;
    const formConfig = buildWorkflowFormConfig(
      pendingWorkflow.schema,
      '',
      pendingWorkflow.collectedInputs,
    );
    registerWorkflowSubmitHandler(formId, {
      templateId: pendingWorkflow.templateId,
      templateName: pendingWorkflow.templateName,
      schemaHash: pendingWorkflow.schemaHash,
      schema: pendingWorkflow.schema,
      get,
    });
    finalMessages = [...finalMessages];
    finalMessages[lastAssistantWithMarker.index] = {
      ...lastAssistantWithMarker.message,
      content: injectFormBlock(
        lastAssistantWithMarker.message,
        formId,
        formConfig,
        {
          source: 'workflow',
          sourceId: pendingWorkflow.templateId,
          schemaHash: pendingWorkflow.schemaHash,
        },
        getMessageText,
      ),
    };
  }

  return { messages: finalMessages, deferSet: false };
}

/**
 * Recover inline parameter forms and their submit handlers after loadHistory,
 * page refresh, or session switch. Handlers live in memory only; this module
 * re-registers them from message content + workflow memory.
 */
import { toast } from 'sonner';
import { registerParameterFormHandler, hasParameterFormHandler } from '@/components/parameter-form/form-handlers';
import { buildWorkflowFormConfig, buildStartupPreset, buildWorkflowValuesSummary } from '@/lib/workflow-form-utils';
import type { WorkflowSchema } from '@/types/workflow';
import type { ContentBlock, RawMessage } from './types';
import type { ChatGet, ChatSet } from './store-api';

export const PARAM_FORM_MARKER_REGEX =
  /<ParameterForm\s+templateId="([^"]+)"\s+schemaHash="([^"]+)"\s*\/>/i;

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

  return loaded.map((loadedMsg) => {
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

    const strippedContent = (loadedMsg.content as ContentBlock[]).map((block) =>
      block.type === 'text' && typeof block.text === 'string'
        ? { ...block, text: block.text.replace(PARAM_FORM_MARKER_REGEX, '').trim() }
        : block,
    );
    return { ...loadedMsg, content: [...strippedContent, formBlock] };
  });
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
    const summaryText = buildWorkflowValuesSummary(schema, values);
    try {
      const { createWorkflow, startWorkflow, beginWorkflowRunSseTrace } = await import('@/lib/workflow-api');
      const { saveWorkflowExecution } = await import('@/stores/workflow-memory');
      const { invokeIpc } = await import('@/lib/api-client');
      const created = await createWorkflow({
        templateId,
        startup: buildStartupPreset(values, schemaHash),
        idempotencyKey: `create-wf-${templateId}-${Date.now()}`,
      });
      const run = await startWorkflow(created.workflowId, {
        inputs: values,
        idempotencyKey: `start-wf-${created.workflowId}-${Date.now()}`,
      });
      const { appendWorkflowStartedLocalTurn } = await import('@/lib/workflow-local-turn');
      appendWorkflowStartedLocalTurn({
        userText: `${summaryText}\n\n工作流 ID: ${created.workflowId}`,
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
        workflowId: created.workflowId,
        runId: run.runId,
        templateId,
        templateName,
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        collectedInputs: values,
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

function findLastAssistantWithMarker(
  messages: RawMessage[],
  getMessageText: (content: unknown) => string,
): { index: number; message: RawMessage; templateId: string; schemaHash: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const text = getMessageText(m.content);
    const match = text.match(PARAM_FORM_MARKER_REGEX);
    const hasFormBlock = Array.isArray(m.content)
      ? (m.content as ContentBlock[]).some((b) => b.type === 'parameter_form')
      : false;
    if (match && !hasFormBlock) {
      return { index: i, message: m, templateId: match[1], schemaHash: match[2] };
    }
    break;
  }
  return null;
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
      const { getLatestWorkflow, findWorkflowById } = await import('@/stores/workflow-memory');
      let workflowRecord = findWorkflowById(target.formContext.sourceId);
      if (!workflowRecord) {
        const latest = getLatestWorkflow(sessionKey);
        if (latest) {
          workflowRecord = { sessionKey, record: latest };
        }
      }
      if (!workflowRecord) return;

      const { getStartupSchema } = await import('@/lib/workflow-api');
      const startup = await getStartupSchema(workflowRecord.record.templateId);
      registerWorkflowSubmitHandler(target.formId, {
        templateId: workflowRecord.record.templateId,
        templateName: workflowRecord.record.templateName,
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

  const lastAssistantWithMarker = findLastAssistantWithMarker(finalMessages, getMessageText);

  if (
    lastAssistantWithMarker
    && (!pendingWorkflow || !pendingWorkflow.schema || pendingWorkflow.schema.fields.length === 0)
  ) {
    void (async () => {
      try {
        const { getLatestWorkflow } = await import('@/stores/workflow-memory');
        const latest = getLatestWorkflow(sessionKey);
        if (!latest) return;

        const { getStartupSchema } = await import('@/lib/workflow-api');
        const startup = await getStartupSchema(latest.templateId);
        const formId = `workflow-form-${latest.templateId}-${Date.now()}`;
        const formConfig = buildWorkflowFormConfig(startup.schema, '', latest.collectedInputs || {});

        registerWorkflowSubmitHandler(formId, {
          templateId: latest.templateId,
          templateName: latest.templateName,
          schemaHash: startup.schemaHash,
          schema: startup.schema,
          get,
        });

        const recoveredMessages = [...finalMessages];
        recoveredMessages[lastAssistantWithMarker.index] = {
          ...lastAssistantWithMarker.message,
          content: injectFormBlock(
            lastAssistantWithMarker.message,
            formId,
            formConfig,
            { source: 'workflow', sourceId: latest.templateId, schemaHash: startup.schemaHash },
            getMessageText,
          ),
        };
        if (get().currentSessionKey === sessionKey) {
          set({ messages: recoveredMessages, thinkingLevel, loading: false });
        }
      } catch (err) {
        console.error('[parameter-form-recovery] async recovery failed:', err);
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
    && pendingWorkflow.schema.fields.length > 0
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

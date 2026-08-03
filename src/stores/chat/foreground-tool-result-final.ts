import { parseStoToolEnvelope, type WorkflowSchemaReadyData } from '@/lib/builtin-tool-envelope';
import { dispatchBuiltinToolResult } from '@/lib/builtin-tool-dispatch';
import {
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  getMessageText,
  getToolCallFilePath,
  makeAttachedFile,
  upsertToolStatuses,
} from './helpers';
import {
  applyWorkflowSchemaReady,
  ensureWorkflowParameterFormInjected,
  patchLastAssistantWithWorkflowForm,
} from './parameter-form-recovery';
import { appendStreamingToolResultSnapshot } from './streaming-state';
import { setRuntimePatch } from './runtime-controller';
import { logChatFlow } from './chat-flow-log';
import type { ChatGet, ChatSet } from './store-api';
import type { AttachedFileMeta, RawMessage } from './types';

export function handleForegroundToolResultFinal(input: {
  get: ChatGet;
  set: ChatSet;
  finalMessage: RawMessage;
  updates: ReturnType<typeof upsertToolStatuses> | unknown[];
}): void {
  const { finalMessage, get, set, updates } = input;
  logChatFlow('event.final.tool-result', {
    sessionKey: get().currentSessionKey,
    messageId: finalMessage.id ?? null,
    toolCallId: finalMessage.toolCallId ?? null,
    toolName: finalMessage.toolName ?? null,
  });
  const schemaEnvelope = parseStoToolEnvelope(finalMessage.content);
  if (schemaEnvelope?.type === 'workflow_schema_ready' && schemaEnvelope.success) {
    applyWorkflowSchemaReady((schemaEnvelope.data ?? {}) as WorkflowSchemaReadyData);
  }

  const currentStreamForPath = get().streamingMessage as RawMessage | null;
  const matchedPath = (currentStreamForPath && finalMessage.toolCallId)
    ? getToolCallFilePath(currentStreamForPath, finalMessage.toolCallId)
    : undefined;

  const toolFiles: AttachedFileMeta[] = [
    ...extractImagesAsAttachedFiles(finalMessage.content),
  ];
  if (matchedPath) {
    for (const file of toolFiles) {
      if (!file.filePath) {
        file.filePath = matchedPath;
        file.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
      }
    }
  }

  const text = getMessageText(finalMessage.content);
  if (text) {
    const mediaRefs = extractMediaRefs(text, {
      source: 'tool-result:media-attached',
      messageId: finalMessage.id,
      toolCallId: finalMessage.toolCallId,
    });
    for (const ref of mediaRefs) toolFiles.push(makeAttachedFile(ref));
  }

  setRuntimePatch(set, get().currentSessionKey, (runtime) => ({
    streamingText: '',
    streamingMessage: null,
    streamingToolResults: appendStreamingToolResultSnapshot(runtime.streamingToolResults, finalMessage),
    pendingFinal: true,
    pendingToolImages: toolFiles.length > 0
      ? [...runtime.pendingToolImages, ...toolFiles]
      : runtime.pendingToolImages,
    streamingTools: updates.length > 0 ? upsertToolStatuses(runtime.streamingTools, updates as Parameters<typeof upsertToolStatuses>[1]) : runtime.streamingTools,
  }));

  void (async () => {
    const sessionKey = get().currentSessionKey;
    const agentId = get().currentAgentId;
    await dispatchBuiltinToolResult({
      id: finalMessage.id,
      toolCallId: finalMessage.toolCallId,
      toolName: finalMessage.toolName,
      content: finalMessage.content,
    }, { sessionKey, agentId });

    const nextMessages = get().messages;
    const withForm = patchLastAssistantWithWorkflowForm(nextMessages, getMessageText);
    if (withForm !== nextMessages) {
      set({ messages: withForm });
    }
    ensureWorkflowParameterFormInjected(getMessageText);
    void get().loadHistory(true);
  })();
}

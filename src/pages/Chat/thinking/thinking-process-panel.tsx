import { useMemo } from 'react';
import type { RawMessage } from '@/stores/chat';
import { parseThinkingTurnLayoutCached } from '@/pages/Chat/thinking-turn-segments';
import {
  ThinkingTurnProcess,
  type ThinkingTurnProcessProps,
} from '@/pages/Chat/thinking/thinking-turn-process';
import type { EngineProfileName } from '@/pages/Chat/thinking/engine-profiles';
import type { ConnectingLabelKey, ThinkingStreamingTool } from '@/pages/Chat/thinking/types-ui';

export interface ThinkingProcessPanelProps {
  /** 单条消息路径（ChatMessage）；与 messages 二选一 */
  message?: RawMessage;
  /** 多消息路径（与 AssistantTurnMessage 相同数据源时可传数组） */
  messages?: RawMessage[];
  isStreaming?: boolean;
  isConnecting?: boolean;
  isProcessing?: boolean;
  isStillExecuting?: boolean;
  streamingTools?: ThinkingStreamingTool[];
  /** 气泡侧是否已有正文（或 parse 已抽出 finalReplyText） */
  hasReplyBody?: boolean;
  connectingLabelKey?: ConnectingLabelKey;
  /** 显式指定引擎 profile；默认从 messages 推断 */
  engineProfile?: EngineProfileName;
  className?: string;
}

/**
 * ThinkingProcessPanel - 思考过程 UI 薄封装（Phase 2/4）
 *
 * 统一走 parseThinkingTurnLayout → ThinkingTurnProcess，消灭 flat timeline 双轨。
 * 使用位置：ChatMessage、历史单条 assistant 消息。
 */
export function ThinkingProcessPanel({
  message,
  messages,
  isStreaming = false,
  isConnecting = false,
  isProcessing = false,
  isStillExecuting = false,
  streamingTools = [],
  hasReplyBody = false,
  connectingLabelKey = 'understandingQuestion',
  engineProfile,
  className,
}: ThinkingProcessPanelProps) {
  const sources = useMemo(() => {
    if (messages && messages.length > 0) return messages;
    if (message) return [message];
    return [];
  }, [message, messages]);

  const isLiveStream =
    isStreaming || isConnecting || isProcessing || isStillExecuting;

  /**
   * 用 parseThinkingTurnLayoutCached 缓存解析结果，避免 activeStream 包装对象
   * 每渲染新建导致的 useMemo 失效；cacheKey 缺省时直出。
   */
  const layoutCacheKey =
    sources.length > 0
      ? sources.map((message, index) => message.id ?? `idx:${index}`).join('|')
      : undefined;
  const layout = useMemo(
    () =>
      sources.length > 0
        ? parseThinkingTurnLayoutCached(layoutCacheKey, sources, {
            isLiveStream,
            streamingTools:
              isLiveStream && streamingTools.length > 0 ? streamingTools : undefined,
            engineProfile,
          })
        : { segments: [], finalReplyText: null },
    [sources, isLiveStream, streamingTools, engineProfile, layoutCacheKey],
  );

  const turnStreamingTools = useMemo(
    () => streamingTools.map((tool) => ({ ...tool, updatedAt: 0 })),
    [streamingTools],
  );

  const turnProps: ThinkingTurnProcessProps = {
    segments: layout.segments,
    isStreaming,
    isConnecting,
    isProcessing,
    isStillExecuting,
    streamingTools: turnStreamingTools,
    hasFinalReply: hasReplyBody || layout.finalReplyText !== null,
    connectingLabelKey,
    className,
  };

  return <ThinkingTurnProcess {...turnProps} />;
}

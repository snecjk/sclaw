/**
 * 流式思考当前块尾部窗口（chat-thinking-perf 0.4 定值）。
 *
 * 流式中的当前 thinking 块超过阈值时只渲染尾部窗口，渲染成本与块总长度无关；
 * 完整内容保留在数据层，块完成后恢复完整展示。
 */
export const STREAMING_THINKING_TAIL_WINDOW_CHARS = 3000;

export interface StreamingTailWindow {
  text: string;
  /** 被省略的前缀字符数；未截断时为 0 */
  omittedChars: number;
}

export function sliceStreamingThinkingTail(content: string): StreamingTailWindow {
  if (content.length <= STREAMING_THINKING_TAIL_WINDOW_CHARS) {
    return { text: content, omittedChars: 0 };
  }
  return {
    text: content.slice(-STREAMING_THINKING_TAIL_WINDOW_CHARS),
    omittedChars: content.length - STREAMING_THINKING_TAIL_WINDOW_CHARS,
  };
}

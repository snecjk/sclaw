export interface OpenAiSseReadOptions {
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  onTimeout?: () => void;
  onChunk?: (progress: OpenAiSseChunkProgress) => void;
  onEvent?: (progress: OpenAiSseEventProgress) => void;
}

export interface OpenAiSseChunkProgress {
  chunkIndex: number;
  byteLength: number;
  elapsedMs: number;
  gapMs: number;
}

export interface OpenAiSseEventProgress {
  eventIndex: number;
  contentLength: number;
  assistantTextLength: number;
  done: boolean;
  elapsedMs: number;
}

function extractDeltaContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const choice = choices.find((item) => (
    item && typeof item === 'object' && (item as { index?: unknown }).index === 0
  )) ?? choices[0];
  if (!choice || typeof choice !== 'object') return '';
  const delta = (choice as { delta?: unknown }).delta;
  if (!delta || typeof delta !== 'object') return '';
  const content = (delta as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

function parseSseEvent(event: string): { done: boolean; content: string } {
  const data = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!data) return { done: false, content: '' };
  if (data === '[DONE]') return { done: true, content: '' };
  try {
    return { done: false, content: extractDeltaContent(JSON.parse(data)) };
  } catch {
    throw new Error('模型流式响应包含无效 JSON');
  }
}

function readWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function readOpenAiChatCompletionSse(
  body: ReadableStream<Uint8Array>,
  options: OpenAiSseReadOptions,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let buffer = '';
  let assistantText = '';
  let chunkIndex = 0;
  let eventIndex = 0;
  let lastChunkAt = startedAt;

  try {
    while (true) {
      const remainingMs = options.totalTimeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        options.onTimeout?.();
        throw new Error(`模型流式响应总时长超过 ${Math.round(options.totalTimeoutMs / 1000)} 秒`);
      }
      const waitMs = Math.min(options.idleTimeoutMs, remainingMs);
      const timeoutMessage = waitMs === remainingMs
        ? `模型流式响应总时长超过 ${Math.round(options.totalTimeoutMs / 1000)} 秒`
        : `模型流式响应连续 ${Math.round(options.idleTimeoutMs / 1000)} 秒无数据`;
      const { done, value } = await readWithTimeout(reader.read(), waitMs, timeoutMessage, options.onTimeout);
      if (done) {
        buffer += decoder.decode();
        break;
      }
      const chunkAt = Date.now();
      chunkIndex += 1;
      options.onChunk?.({
        chunkIndex,
        byteLength: value.byteLength,
        elapsedMs: chunkAt - startedAt,
        gapMs: chunkAt - lastChunkAt,
      });
      lastChunkAt = chunkAt;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseEvent(event);
        assistantText += parsed.content;
        eventIndex += 1;
        options.onEvent?.({
          eventIndex,
          contentLength: parsed.content.length,
          assistantTextLength: assistantText.length,
          done: parsed.done,
          elapsedMs: Date.now() - startedAt,
        });
        if (parsed.done) return assistantText;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be aborted by the timeout controller.
    } finally {
      reader.releaseLock();
    }
  }

  throw new Error('模型流式响应提前结束，未收到 [DONE]');
}

/**
 * Claude SDK stream_event → assistant content[] 增量累积。
 * 供 claude-adapter 在 delta 阶段透出 tool_use + input_json_delta。
 */

export type ClaudeStreamContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; inputJson: string };

const DEFAULT_PARTIAL_INPUT_PREVIEW_CHARS = 4_096;

function buildPartialInputPreview(inputJson: string, maxChars: number): string {
  if (inputJson.length <= maxChars) return inputJson;
  const marker = `\n… [partial tool input: ${inputJson.length} chars] …\n`;
  const available = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(available * 0.75);
  const tailLength = available - headLength;
  const tail = tailLength > 0 ? inputJson.slice(-tailLength) : '';
  return `${inputJson.slice(0, headLength)}${marker}${tail}`;
}

export type ClaudeToolResultMessage = {
  role: 'toolresult';
  toolCallId?: string;
  toolName?: string;
  content: string;
  status: 'completed' | 'error';
};

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const record = block as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.content === 'string') return record.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** Hidden Claude user messages are the SDK transport for tool_result blocks. */
export function extractClaudeToolResultMessages(
  message: unknown,
  toolNamesById: ReadonlyMap<string, string> = new Map(),
): ClaudeToolResultMessage[] {
  if (!message || typeof message !== 'object') return [];
  const payload = message as Record<string, unknown>;
  if (!Array.isArray(payload.content)) return [];

  const results: ClaudeToolResultMessage[] = [];
  for (const block of payload.content) {
    if (!block || typeof block !== 'object') continue;
    const source = block as Record<string, unknown>;
    if (source.type !== 'tool_result') continue;
    const toolCallId = typeof source.tool_use_id === 'string' ? source.tool_use_id : undefined;
    results.push({
      role: 'toolresult',
      toolCallId,
      toolName: typeof source.name === 'string'
        ? source.name
        : toolCallId
          ? toolNamesById.get(toolCallId)
          : undefined,
      content: stringifyToolResultContent(source.content),
      status: source.is_error === true ? 'error' : 'completed',
    });
  }
  return results;
}

export class ClaudeStreamContentAccumulator {
  private blocks = new Map<number, ClaudeStreamContentBlock>();

  reset(): void {
    this.blocks.clear();
  }

  handleContentBlockStart(index: number, contentBlock: Record<string, unknown>): void {
    if (contentBlock.type === 'text') {
      this.blocks.set(index, { type: 'text', text: '' });
      return;
    }
    if (contentBlock.type === 'tool_use') {
      this.blocks.set(index, {
        type: 'tool_use',
        id: typeof contentBlock.id === 'string' ? contentBlock.id : '',
        name: typeof contentBlock.name === 'string' ? contentBlock.name : '',
        inputJson: '',
      });
    }
  }

  handleContentBlockDelta(index: number, delta: Record<string, unknown>): void {
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      let block = this.blocks.get(index);
      if (!block || block.type !== 'text') {
        block = { type: 'text', text: '' };
        this.blocks.set(index, block);
      }
      block.text += delta.text;
      return;
    }

    if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      let block = this.blocks.get(index);
      if (!block || block.type !== 'tool_use') {
        return;
      }
      block.inputJson += delta.partial_json;
    }
  }

  buildContentArray(options?: {
    maxPartialInputChars?: number;
  }): Array<Record<string, unknown>> {
    const indices = [...this.blocks.keys()].sort((a, b) => a - b);
    const content: Array<Record<string, unknown>> = [];

    for (const index of indices) {
      const block = this.blocks.get(index);
      if (!block) continue;

      if (block.type === 'text') {
        if (block.text.length > 0) {
          content.push({ type: 'text', text: block.text });
        }
        continue;
      }

      let input: unknown = null;
      const json = block.inputJson.trim();
      if (json.length > 0) {
        try {
          input = JSON.parse(json);
        } catch {
          // Preserve the in-flight fragment so the existing tool-input renderer
          // can show real progress while Claude is still generating JSON. Large
          // Write/Edit payloads are capped here; the accumulator still retains
          // the complete JSON and emits it once parsing succeeds.
          input = buildPartialInputPreview(
            block.inputJson,
            options?.maxPartialInputChars ?? DEFAULT_PARTIAL_INPUT_PREVIEW_CHARS,
          );
        }
      }

      content.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input,
      });
    }

    return content;
  }
}

export function applyClaudeStreamEvent(
  accumulator: ClaudeStreamContentAccumulator,
  event: Record<string, unknown>,
): boolean {
  if (event.type === 'message_start') {
    accumulator.reset();
    return true;
  }

  if (event.type === 'content_block_start') {
    const index = typeof event.index === 'number' ? event.index : 0;
    const contentBlock = event.content_block;
    if (contentBlock && typeof contentBlock === 'object') {
      accumulator.handleContentBlockStart(index, contentBlock as Record<string, unknown>);
      return true;
    }
    return false;
  }

  if (event.type === 'content_block_delta') {
    const index = typeof event.index === 'number' ? event.index : 0;
    const delta = event.delta;
    if (delta && typeof delta === 'object') {
      accumulator.handleContentBlockDelta(index, delta as Record<string, unknown>);
      return true;
    }
    return false;
  }

  return false;
}

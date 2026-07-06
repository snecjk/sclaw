/**
 * Claude SDK stream_event → assistant content[] 增量累积。
 * 供 claude-adapter 在 delta 阶段透出 tool_use + input_json_delta。
 */

export type ClaudeStreamContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; inputJson: string };

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

  buildContentArray(): Array<Record<string, unknown>> {
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
          input = null;
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

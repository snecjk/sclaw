import { describe, expect, it } from 'vitest';

import { formatTurnTokenCount, extractClaudeResultUsage, normalizeTurnUsage } from '../../shared/turn-token';

describe('turn-token', () => {
  it('normalizes prompt/completion usage fields', () => {
    expect(normalizeTurnUsage({
      prompt_tokens: 300,
      completion_tokens: 80,
      total_tokens: 380,
    })).toEqual({
      promptTokens: 300,
      completionTokens: 80,
      totalTokens: 380,
    });
  });

  it('includes cache read/write in total when explicit total is missing', () => {
    expect(normalizeTurnUsage({
      input: 100,
      output: 20,
      cacheRead: 50,
      cacheWrite: 10,
    })).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 180,
    });
  });

  it('formats token counts with locale grouping', () => {
    expect(formatTurnTokenCount(12345)).toBe('12,345');
  });

  it('normalizes Claude cache token field names', () => {
    expect(normalizeTurnUsage({
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 50,
    })).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1750,
    });
  });

  it('normalizes camelCase usage fields from Claude modelUsage entries', () => {
    expect(normalizeTurnUsage({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadInputTokens: 100,
    })).toEqual({
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1600,
    });
  });

  it('extractClaudeResultUsage falls back to modelUsage when usage is empty', () => {
    expect(extractClaudeResultUsage({
      type: 'result',
      subtype: 'success',
      usage: {},
      modelUsage: {
        'claude-sonnet': {
          inputTokens: 800,
          outputTokens: 120,
        },
      },
    })).toEqual({
      promptTokens: 800,
      completionTokens: 120,
      totalTokens: 920,
    });
  });
});

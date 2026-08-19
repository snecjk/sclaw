import { describe, expect, it } from 'vitest';
import {
  extractCanonicalMessageText,
  mergeBridgeAiStreamText,
  measureBridgeAiContextBytes,
  parseBridgeAiResponse,
} from '../../electron/main/services/jsbridge/bridge-ai-message';

describe('bridge-ai-message helpers', () => {
  it('extracts string and block content from canonical payloads', () => {
    expect(extractCanonicalMessageText({ content: 'hello' })).toBe('hello');
    expect(extractCanonicalMessageText({
      content: [{ text: 'a' }, { text: 'b' }],
    })).toBe('ab');
  });

  it('merges cumulative and incremental stream text', () => {
    expect(mergeBridgeAiStreamText('hel', 'hello')).toBe('hello');
    expect(mergeBridgeAiStreamText('hel', 'lo')).toBe('hello');
  });

  it('parses JSON responses and degrades on invalid JSON', () => {
    expect(parseBridgeAiResponse('{"ok":true}', 'json')).toEqual({ parsed: { ok: true } });
    const failed = parseBridgeAiResponse('not-json', 'json');
    expect(failed.parsed).toBeUndefined();
    expect(failed.parseError).toBeTruthy();
    expect(parseBridgeAiResponse('plain text', 'text')).toEqual({});
  });

  it('rejects oversized context measurement', () => {
    const large = { data: 'x'.repeat(200_000) };
    expect(measureBridgeAiContextBytes(large)).toBeGreaterThan(128 * 1024);
  });
});

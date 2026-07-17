import { describe, expect, it } from 'vitest';
import {
  appendArchivedClaudeSessionId,
  isMissingClaudeConversationError,
} from '../../electron/engines/claude-session-recovery';

describe('Claude session recovery', () => {
  it('recognizes a missing resume conversation error', () => {
    expect(isMissingClaudeConversationError(
      new Error('Claude Code returned an error result: No conversation found with session ID: old-id'),
    )).toBe(true);
    expect(isMissingClaudeConversationError(new Error('API Error: 400 invalid model'))).toBe(false);
  });

  it('archives the invalid SDK session id once', () => {
    expect(appendArchivedClaudeSessionId(['older', 'missing'], 'missing')).toEqual([
      'older',
      'missing',
    ]);
  });
});

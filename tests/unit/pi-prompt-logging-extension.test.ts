import { describe, expect, it, vi } from 'vitest';
import { createPiPromptLoggingExtension } from '../../electron/pi-runtime/prompt-logging-extension';

describe('PI prompt logging extension', () => {
  it('logs the final system and user prompt once per turn', async () => {
    const handlers = new Map<string, (event: any) => unknown>();
    const log = vi.fn();
    const extension = createPiPromptLoggingExtension({
      sessionKey: 'pi:main:test',
      getRunId: () => 'run-1',
      log,
    });

    await extension.factory({
      on(event, handler) { handlers.set(event, handler as (event: any) => unknown); },
      getActiveTools() { return ['read', 'bridge_snapshot']; },
    } as never);

    handlers.get('before_agent_start')?.({
      type: 'before_agent_start',
      prompt: '查看当前页面',
      systemPrompt: 'base\n\nbrowser guidance',
      images: [],
      systemPromptOptions: {},
    });

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      'turn.prompt.final',
      {
        sessionKey: 'pi:main:test',
        runId: 'run-1',
        systemPromptChars: 22,
        userPromptChars: 6,
      },
      [
        '===== SYSTEM PROMPT =====',
        'base',
        '',
        'browser guidance',
        '===== USER PROMPT =====',
        '查看当前页面',
        '===== END PROMPT =====',
      ].join('\n'),
    );
  });
});

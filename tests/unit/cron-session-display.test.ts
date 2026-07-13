import { describe, expect, it } from 'vitest';
import { stripCronLabelPrefix, stripCronTriggerTextForDisplay } from '@/lib/cron-session-display';

describe('cron-session-display', () => {
  it('strips Cron: prefix from session labels', () => {
    expect(stripCronLabelPrefix('Cron: 当前模型')).toBe('当前模型');
    expect(stripCronLabelPrefix('cron: drink water')).toBe('drink water');
  });

  it('strips OpenClaw cron trigger prefix from user messages', () => {
    const raw = '[cron:67c52ec7-76f9-49b6-929b-5951b8f4286a 当前模型] 你当前是什么模型';
    expect(stripCronTriggerTextForDisplay(raw)).toBe('你当前是什么模型');
  });

  it('strips standalone Cron: label lines from user messages', () => {
    expect(stripCronTriggerTextForDisplay('Cron: 当前模型')).toBe('当前模型');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendScheduledTaskResultFallback } from '../../electron/scheduled-tasks/scheduled-task-dingtalk-fallback';
import { resetDwsSendDedupForTests } from '../../electron/utils/dws-send-dedup';
import type { ScheduleTask } from '../../electron/db/models/domain/schedule-task';

/**
 * 兜底 dws-send 模块胶水单测：剥反问 + 拼正文/标题 + 免责声明 + 去重跳过。
 * runDws（dws-cli）与免责声明（dingtalk-disclaimer）vi.mock 替身；去重用真实
 * dws-send-dedup（每测 reset）——验证与 send-guard 共享的进程内去重语义。
 */
const runDwsMock = vi.fn();
vi.mock('../../electron/utils/dws-cli', () => ({
  runDws: (...args: unknown[]) => runDwsMock(...args),
}));

vi.mock('../../shared/dingtalk-disclaimer', () => ({
  appendDingTalkAgentSendDisclaimer: (text: string) => `${text}\n[免责]`,
}));

function makeTask(overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: 't1',
    name: 'T1',
    dingtalkRecipients: [{ type: 'user', userId: 'u1', displayName: 'U1' }],
    ...overrides,
  } as unknown as ScheduleTask;
}

describe('sendScheduledTaskResultFallback', () => {
  beforeEach(() => {
    runDwsMock.mockReset();
    runDwsMock.mockResolvedValue({ ok: true });
    resetDwsSendDedupForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends cleaned body + title + disclaimer to each user recipient', async () => {
    await sendScheduledTaskResultFallback({
      task: makeTask(),
      lastAssistantText: '报告完成。',
    });

    expect(runDwsMock).toHaveBeenCalledTimes(1);
    expect(runDwsMock.mock.calls[0][0]).toEqual([
      'chat',
      'message',
      'send',
      '--user',
      'u1',
      '--title',
      '【定时任务】T1',
      '--text',
      '【定时任务】T1\n\n报告完成。\n[免责]',
      '--format',
      'json',
    ]);
  });

  it('sends to group recipient via --group + openConversationId', async () => {
    await sendScheduledTaskResultFallback({
      task: makeTask({
        dingtalkRecipients: [{ type: 'group', openConversationId: 'cid-9', displayName: 'G1' }],
      }),
      lastAssistantText: '报告完成。',
    });

    const args = runDwsMock.mock.calls[0][0] as string[];
    expect(args).toContain('--group');
    expect(args).toContain('cid-9');
    expect(args).toContain('【定时任务】T1\n\n报告完成。\n[免责]');
  });

  it('strips trailing ask-back sentence before send (rule5: 指定即必发)', async () => {
    await sendScheduledTaskResultFallback({
      task: makeTask(),
      lastAssistantText: '报告完成。是否需要我发送给收件人？',
    });

    const text = (runDwsMock.mock.calls[0][0] as string[]).find((a, i, arr) => arr[i - 1] === '--text');
    expect(text).toContain('报告完成。');
    expect(text).not.toContain('是否需要我发送');
  });

  it('skips send when only ask-back remains (no real content)', async () => {
    await sendScheduledTaskResultFallback({
      task: makeTask(),
      lastAssistantText: '是否需要我发送给收件人？',
    });

    expect(runDwsMock).not.toHaveBeenCalled();
  });

  it('dedup: second identical send within TTL is skipped (send-guard 共享去重)', async () => {
    const task = makeTask();
    const params = { task, lastAssistantText: '报告完成。' };

    await sendScheduledTaskResultFallback(params);
    await sendScheduledTaskResultFallback(params); // 同 recipientKey + 同正文 → 命中

    expect(runDwsMock).toHaveBeenCalledTimes(1);
  });

  it('skips when task has no recipients', async () => {
    await sendScheduledTaskResultFallback({
      task: makeTask({ dingtalkRecipients: [] }),
      lastAssistantText: '报告完成。',
    });
    expect(runDwsMock).not.toHaveBeenCalled();
  });

  it('skips when lastAssistantText is empty', async () => {
    await sendScheduledTaskResultFallback({ task: makeTask(), lastAssistantText: '   ' });
    expect(runDwsMock).not.toHaveBeenCalled();
  });

  it('dedupes identical recipients (same userId sent once)', async () => {
    await sendScheduledTaskResultFallback({
      task: makeTask({
        dingtalkRecipients: [
          { type: 'user', userId: 'u1', displayName: 'U1' },
          { type: 'user', userId: 'u1', displayName: 'U1 dup' },
        ],
      }),
      lastAssistantText: '报告完成。',
    });

    expect(runDwsMock).toHaveBeenCalledTimes(1);
  });
});

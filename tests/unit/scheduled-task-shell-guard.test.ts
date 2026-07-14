import { describe, expect, it } from 'vitest';
import { isScheduledTaskShellCommand } from '../../sto-plugin/claude/claude-scheduled-task-tool/hooks';

describe('isScheduledTaskShellCommand', () => {
  it('blocks shell commands that manage Claude scheduled tasks', () => {
    expect(isScheduledTaskShellCommand('claude-scheduled-task create --name x')).toBe(true);
    expect(isScheduledTaskShellCommand('echo \'{"cron":"0 9 * * *"}\' > ~/.claude/scheduled_tasks.json')).toBe(true);
    expect(isScheduledTaskShellCommand('echo "0 9 * * * root cron-job" > /etc/cron.d/nightly')).toBe(true);
  });

  it('allows ordinary shell commands without scheduled-task keywords', () => {
    expect(isScheduledTaskShellCommand('git status')).toBe(false);
    expect(isScheduledTaskShellCommand('npm test')).toBe(false);
  });

  it('does NOT block dws chat message send whose --text mentions 定时任务 (regression)', () => {
    // 线上案例：群聊总结正文里含"姚磊（定时任务）"，被贪婪正则误杀。
    const cmd =
      'dws chat message send --user u1 --title "群聊总结" --text "姚磊（定时任务）、徐化龙（天气/对账）" --format json';
    expect(isScheduledTaskShellCommand(cmd)).toBe(false);
  });

  it('does NOT block dws chat message send whose --text mentions cron / scheduled task', () => {
    expect(
      isScheduledTaskShellCommand(
        'dws chat message send --group g1 --title "消息" --text "关于 cron 与 scheduled task 的说明" --format json',
      ),
    ).toBe(false);
  });

  it('still blocks a real scheduled-task shell command even if it mentions dws', () => {
    // 非 dws 发送命令、确属管理定时任务的 shell 操作仍应被挡。
    expect(isScheduledTaskShellCommand('crontab -l | grep cron')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isOverCollapsed,
  pickBeautifyModel,
  resolveBeautifySystemPrompt,
  resolveBeautifyType,
  scoreBeautifyModel,
} from '../../electron/scheduled-tasks/scheduled-task-instruction-beautifier';

describe('scheduled-task-instruction-beautifier model pick', () => {
  it('prefers turbo over plus models', () => {
    const model = pickBeautifyModel(['qwen3.5-plus', 'qwen-turbo'], 'qwen3.5-plus');
    expect(model).toBe('qwen-turbo');
  });

  it('deprioritizes qwen3.5-plus when lighter models exist', () => {
    expect(scoreBeautifyModel('qwen-turbo')).toBeGreaterThan(scoreBeautifyModel('qwen3.5-plus'));
  });

  it('falls back to preferred model when it is the only candidate', () => {
    expect(pickBeautifyModel(['qwen3.5-plus'], 'qwen3.5-plus')).toBe('qwen3.5-plus');
  });
});

describe('beautify instruction type', () => {
  it('defaults to task', () => {
    expect(resolveBeautifyType(undefined)).toBe('task');
    expect(resolveBeautifyType('task')).toBe('task');
  });

  it('accepts prompt', () => {
    expect(resolveBeautifyType('prompt')).toBe('prompt');
  });

  it('uses different system prompts for task vs prompt', () => {
    const taskPrompt = resolveBeautifySystemPrompt('task');
    const promptPrompt = resolveBeautifySystemPrompt('prompt');
    expect(taskPrompt).toContain('定时任务');
    expect(taskPrompt).toContain('@提及');
    expect(taskPrompt).not.toContain('可在开头');
    expect(promptPrompt).toContain('提示词模版');
    expect(taskPrompt).not.toEqual(promptPrompt);
  });
});

describe('isOverCollapsed', () => {
  it('rejects collapsing a multi-step plan into a one-liner', () => {
    const original = [
      '第一步：加载数据源',
      '第二步：拉取最新数据',
      '第三步：生成报告并发送',
    ].join('\n');
    const optimized = '执行该任务。';
    expect(isOverCollapsed(original, optimized)).toBe(true);
  });

  it('allows modest edits that keep most content', () => {
    const original = '第一步：加载 skill\n第二步：查询数据\n第三步：输出报告';
    const optimized = '第一步：加载所需 skill\n第二步：查询最新数据\n第三步：输出 HTML 报告';
    expect(isOverCollapsed(original, optimized)).toBe(false);
  });
});

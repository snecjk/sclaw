import { describe, expect, it } from 'vitest';
import type { ToolStatus } from '@/stores/chat';
import { deriveAppDevTurnPlan } from '@/lib/app-dev-turn-plan';

function makeTool(partial: Partial<ToolStatus> & { name: string }): ToolStatus {
  return { status: 'completed', updatedAt: 1_000, ...partial };
}

describe('deriveAppDevTurnPlan 待办派生', () => {
  it('无叙述无工具 → 空清单', () => {
    const plan = deriveAppDevTurnPlan({ texts: [], tools: [], sending: true });
    expect(plan.totalCount).toBe(0);
    expect(plan.items).toEqual([]);
    expect(plan.activeTitle).toBeNull();
  });

  it('阶段叙述：生成中最后一项 active、之前 done', () => {
    const plan = deriveAppDevTurnPlan({
      texts: ['先看一下项目结构。\n然后修改首页标题颜色。'],
      tools: [],
      sending: true,
    });
    expect(plan.totalCount).toBe(2);
    expect(plan.items[0]).toMatchObject({ title: '先看一下项目结构。', state: 'done' });
    expect(plan.items[1]).toMatchObject({ title: '然后修改首页标题颜色。', state: 'active' });
    expect(plan.doneCount).toBe(1);
    expect(plan.activeTitle).toBe('然后修改首页标题颜色。');
  });

  it('轮结束（sending=false）全部 done，x/N 收口为 N/N', () => {
    const plan = deriveAppDevTurnPlan({
      texts: ['第一步完成。\n第二步完成。'],
      tools: [],
      sending: false,
    });
    expect(plan.items.every((item) => item.state === 'done')).toBe(true);
    expect(plan.doneCount).toBe(2);
    expect(plan.totalCount).toBe(2);
    expect(plan.activeTitle).toBeNull();
  });

  it('显式编号计划：pending 三态 + 阶段叙述推进当前项', () => {
    const plan = deriveAppDevTurnPlan({
      texts: [
        '我来按三步处理：\n1. 修改标题颜色\n2. 调整字号\n3. 构建验证',
        '正在修改标题颜色为蓝色。',
      ],
      tools: [],
      sending: true,
    });
    expect(plan.totalCount).toBe(3);
    expect(plan.items[0]).toMatchObject({ title: '修改标题颜色', state: 'active' });
    expect(plan.items[1]).toMatchObject({ title: '调整字号', state: 'pending' });
    expect(plan.items[2]).toMatchObject({ title: '构建验证', state: 'pending' });
    expect(plan.doneCount).toBe(0);
  });

  it('编号计划推进：第二条叙述后第一项 done、第二项 active', () => {
    const plan = deriveAppDevTurnPlan({
      texts: [
        '1. 修改标题颜色\n2. 调整字号\n3. 构建验证',
        '正在修改标题颜色为蓝色。',
        '接下来调整字号大小。',
      ],
      tools: [],
      sending: true,
    });
    expect(plan.items.map((item) => item.state)).toEqual(['done', 'active', 'pending']);
    expect(plan.doneCount).toBe(1);
  });

  it('编号计划无后续叙述时按已完成工具数推进', () => {
    const plan = deriveAppDevTurnPlan({
      texts: ['1. 修改标题颜色\n2. 调整字号'],
      tools: [makeTool({ name: 'Edit' })],
      sending: true,
    });
    // 完成 1 个工具 → 进行第 2 项（0 起）
    expect(plan.items.map((item) => item.state)).toEqual(['done', 'active']);
  });

  it('符号清单（- 项）同样识别为计划', () => {
    const plan = deriveAppDevTurnPlan({
      texts: ['- 改颜色\n- 改字号'],
      tools: [],
      sending: true,
    });
    expect(plan.totalCount).toBe(2);
    expect(plan.items[0]).toMatchObject({ state: 'active' });
  });

  it('代码围栏内容不作为待办', () => {
    const plan = deriveAppDevTurnPlan({
      texts: ['修改样式文件。\n```css\n1. not a plan\n2. not a plan\n```'],
      tools: [],
      sending: true,
    });
    expect(plan.totalCount).toBe(1);
    expect(plan.items[0]!.title).toBe('修改样式文件。');
  });

  it('无叙述但有工具调用：以最近工具描述兜底', () => {
    const plan = deriveAppDevTurnPlan({
      texts: [],
      tools: [makeTool({
        name: 'Edit',
        input: { file_path: '/app/home.page.json', old_string: 'a', new_string: 'b' },
      })],
      sending: true,
    });
    expect(plan.totalCount).toBe(1);
    expect(plan.items[0]).toMatchObject({ title: '编辑 home.page.json', state: 'active' });
    expect(plan.activeTitle).toBe('编辑 home.page.json');
  });

  it('重复叙述去重、过长标题截断', () => {
    const longTitle = '这是一段非常非常长的阶段叙述，它的长度明显超过了四十个字符的显示限制，因此需要被截断处理掉尾巴部分。';
    const plan = deriveAppDevTurnPlan({
      texts: [`${longTitle}\n${longTitle}`],
      tools: [],
      sending: false,
    });
    expect(plan.totalCount).toBe(1);
    expect(plan.items[0]!.title.length).toBeLessThanOrEqual(40);
    expect(plan.items[0]!.title.endsWith('…')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  resolveSkillNamesInThinking,
  resolveSkillNamesInThinkingCached,
} from '@/pages/Chat/thinking/thinking-turn-process';

const skills = [
  { id: 'skill-1', slug: 'daily-report', name: 'daily_report', title: '日报' },
  { id: 'skill-2', name: 'web_search', title: '联网搜索' },
];

/** 字符串相等无法区分缓存命中与重算，用 Proxy 统计 skills 属性读取次数来观测是否重跑 */
function probeSkills() {
  let titleReads = 0;
  const skill = new Proxy(
    { id: 's', slug: 'alpha', name: 'alpha', title: 'Alpha' },
    {
      get(target, prop, receiver) {
        if (prop === 'title') titleReads += 1;
        return Reflect.get(target, prop, receiver);
      },
    },
  );
  return { skills: [skill], reads: () => titleReads };
}

describe('resolveSkillNamesInThinkingCached（chat-thinking-perf 2.3）', () => {
  it('与未缓存版输出一致', () => {
    const text = '我先调用 daily_report 生成日报，再用 web_search 补充数据';
    expect(resolveSkillNamesInThinkingCached(text, skills))
      .toBe(resolveSkillNamesInThinking(text, skills));
    expect(resolveSkillNamesInThinkingCached(text, skills)).toContain('日报');
  });

  it('同一内容重复解析命中缓存，不再读取 skills 做正则替换', () => {
    const probe = probeSkills();
    const text = '调用 alpha 一次';
    expect(resolveSkillNamesInThinkingCached(text, probe.skills)).toBe('调用 Alpha 一次');
    const readsAfterMiss = probe.reads();
    expect(readsAfterMiss).toBeGreaterThan(0);
    expect(resolveSkillNamesInThinkingCached(text, probe.skills)).toBe('调用 Alpha 一次');
    expect(probe.reads()).toBe(readsAfterMiss);
  });

  it('正在生长的流式块内容每帧变化：天然 miss，行为与全量解析一致', () => {
    const probe = probeSkills();
    expect(resolveSkillNamesInThinkingCached('调用 alpha', probe.skills)).toBe('调用 Alpha');
    expect(resolveSkillNamesInThinkingCached('调用 alpha 并继续', probe.skills))
      .toBe('调用 Alpha 并继续');
    expect(probe.reads()).toBeGreaterThan(1);
  });

  it('skills 列表引用变化后按新列表重算', () => {
    const text = '调用 daily_report 一次';
    resolveSkillNamesInThinkingCached(text, skills);
    const renamed = [{ ...skills[0]!, title: '新日报' }, skills[1]!];
    expect(resolveSkillNamesInThinkingCached(text, renamed)).toContain('新日报');
  });

  it('空文本 / 空 skills 直接透传', () => {
    expect(resolveSkillNamesInThinkingCached('', skills)).toBe('');
    expect(resolveSkillNamesInThinkingCached('任意文本', [])).toBe('任意文本');
  });

  it('缓存上限 200：超出后淘汰最旧条目，再次解析会重算', () => {
    const probe = probeSkills();
    const firstText = '使用 alpha 第 0 次';
    resolveSkillNamesInThinkingCached(firstText, probe.skills);
    for (let i = 1; i <= 220; i += 1) {
      resolveSkillNamesInThinkingCached(`使用 alpha 第 ${i} 次`, probe.skills);
    }
    const readsBefore = probe.reads();
    expect(resolveSkillNamesInThinkingCached(firstText, probe.skills)).toBe('使用 Alpha 第 0 次');
    expect(probe.reads()).toBeGreaterThan(readsBefore);
  });
});

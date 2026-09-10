import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPlanConfirmPrompt,
  buildPlanFirstPrompt,
  extractSclawPlan,
  extractSclawStepUpdates,
  shouldTriggerPlanGate,
  stripPlanGatePromptForDisplay,
  wrapUserTextForPlanGate,
} from '@/lib/app-dev-plan-gate';
import {
  buildResponsiveFixPrompt,
  formatResponsiveAuditSummary,
} from '@/lib/app-dev-responsive-audit';
import {
  buildFollowUpQuestion,
  getAppDevTurnRating,
  setAppDevTurnRating,
} from '@/lib/app-dev-turn-feedback';
import { deriveAppDevTurnPlan } from '@/lib/app-dev-turn-plan';
import {
  isAppDevStageMode,
  useAppDevWorkbenchStore,
} from '@/stores/app-dev-workbench';

describe('T12 plan gate', () => {
  it('extracts sclaw_plan fence', () => {
    const plan = extractSclawPlan(`ok
\`\`\`sclaw_plan
{"summary":"做登录页","steps":[{"id":"1","title":"搭布局","fileHints":["src/pages/Login.tsx"]}]}
\`\`\`
`);
    expect(plan?.summary).toBe('做登录页');
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0].title).toBe('搭布局');
  });

  it('builds confirm prompt and step updates', () => {
    const prompt = buildPlanConfirmPrompt({
      summary: '官网',
      steps: [{ id: '1', title: '首页' }, { id: '2', title: '关于' }],
    });
    expect(prompt).toContain('已确认方案');
    expect(prompt).toContain('首页');
    expect(extractSclawStepUpdates('```sclaw_step\n{"id":"1","status":"done"}\n```')).toEqual([
      { id: '1', status: 'done' },
    ]);
  });

  it('triggers on complex / first long request, skips tiny edits', () => {
    expect(shouldTriggerPlanGate({ userText: '做一个官网落地页', priorUserMessageCount: 0 })).toBe(true);
    expect(shouldTriggerPlanGate({ userText: '改一下标题错别字', priorUserMessageCount: 3 })).toBe(false);
    expect(shouldTriggerPlanGate({ userText: 'a'.repeat(50), priorUserMessageCount: 0 })).toBe(true);
  });

  it('wraps outbound user text for plan-first sends', () => {
    const wrapped = wrapUserTextForPlanGate({
      userText: '从零做一个完整官网落地页',
      priorUserMessageCount: 0,
    });
    expect(wrapped).toContain('从零做一个完整官网落地页');
    expect(wrapped).toContain('方案闸门');
    expect(wrapUserTextForPlanGate({
      userText: '请按以下已确认方案开始实现',
      priorUserMessageCount: 0,
    })).toBeNull();
  });

  it('strips plan-gate wrapping from bubble display text', () => {
    const original = '从零做一个完整官网落地页';
    const wrapped = buildPlanFirstPrompt(original);
    expect(wrapped).toContain('【系统约束 · 方案闸门】');
    expect(stripPlanGatePromptForDisplay(wrapped)).toBe(original);
    expect(stripPlanGatePromptForDisplay(original)).toBe(original);
  });

  it('deriveAppDevTurnPlan prefers sclaw_plan contract', () => {
    const plan = deriveAppDevTurnPlan({
      texts: [`\`\`\`sclaw_plan\n{"steps":[{"id":"a","title":"第一步"},{"id":"b","title":"第二步"}]}\n\`\`\``],
      tools: [],
      sending: true,
    });
    expect(plan.totalCount).toBe(2);
    expect(plan.items[0].title).toContain('第一步');
    expect(plan.items[0].state).toBe('active');
  });
});

describe('T11 responsive audit helpers', () => {
  it('formats summary and fix prompt', () => {
    const fail = {
      ok: false,
      hasViewport: false,
      docOverflow: true,
      overflowCount: 2,
      topOverflows: [{ selector: 'div.hero', scrollWidth: 500, clientWidth: 390 }],
    };
    expect(formatResponsiveAuditSummary(fail)).toContain('溢出');
    expect(buildResponsiveFixPrompt(fail)).toContain('viewport');
    expect(formatResponsiveAuditSummary({
      ok: true,
      hasViewport: true,
      docOverflow: false,
      overflowCount: 0,
      topOverflows: [],
    })).toContain('通过');
  });
});

describe('T13 turn feedback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists rating and builds follow-up', () => {
    expect(getAppDevTurnRating('ws', 't1')).toBeNull();
    setAppDevTurnRating('ws', 't1', 'up');
    expect(getAppDevTurnRating('ws', 't1')).toBe('up');
    expect(buildFollowUpQuestion('移动端')).toContain('移动端');
    expect(buildFollowUpQuestion(null)).toContain('其他地方');
  });
});

describe('T10/T14 workbench modes', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppDevWorkbenchStore.setState({
      mode: 'preview',
      stageCollapsed: false,
      device: 'desktop',
      tuneMode: 'chat',
      diffRequest: null,
      versionRestoreRequest: null,
      assetRevealPath: null,
    });
  });

  it('accepts more-assets and baseHash on diffRequest', () => {
    expect(isAppDevStageMode('more-assets')).toBe(true);
    useAppDevWorkbenchStore.getState().setMode('more-assets');
    expect(useAppDevWorkbenchStore.getState().mode).toBe('more-assets');
    useAppDevWorkbenchStore.getState().setDiffRequest({ hash: 'aaa', baseHash: 'bbb' });
    expect(useAppDevWorkbenchStore.getState().diffRequest).toEqual({ hash: 'aaa', baseHash: 'bbb' });
    useAppDevWorkbenchStore.getState().setAssetRevealPath('public/logo.png');
    expect(useAppDevWorkbenchStore.getState().assetRevealPath).toBe('public/logo.png');
  });
});

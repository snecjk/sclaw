/**
 * 波次 1 · A2 页内注入脚本行为测试（jsdom 真跑注入脚本）：
 * - buildObservation 上报 navEpoch（location.href + performance.timeOrigin 的 hash）；
 * - noteGeneration/resolveTarget 代际兜底：payload.generation 不匹配 → { staleRef: true }；
 * - act('fill') 统一走 fillWithNativeSetter（原生 setter + input/change 事件）；
 * - act('click') 遮挡检测字段（jsdom 无布局，验证字段面与元素命中路径）；
 * - installDialogHooks/drainDialogs 页内 fallback（auto-dismiss / auto-accept）；
 * - installClickProbe/readClickProbe 投递探针；
 * - resolveTargetForInput 的页内可见性/视口守卫（B7）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildObserveScript } from '../../shared/browser-automation/observe-script';

interface StoBrowserAutomation {
  buildObservation: () => { elements: Array<{ ref: string; editable: boolean; clickable: boolean }>; navEpoch?: string };
  act: (payload: Record<string, unknown>) => { success: boolean; occluded?: boolean; staleRef?: boolean };
  resolveTarget: (payload: Record<string, unknown>) => unknown;
  resolveTargetForInput: (payload: Record<string, unknown>) => {
    found: boolean;
    error?: string;
    pageNotVisible?: boolean;
    staleRef?: boolean;
  };
  noteGeneration: (generation: number) => void;
  installDialogHooks: (policy: string) => boolean;
  drainDialogs: () => Array<{ type: string; message: string; handled: string }>;
  installClickProbe: (payload?: Record<string, unknown>) => boolean;
  readClickProbe: () => { delivered: boolean; targetMatched: boolean } | null;
}

function api(): StoBrowserAutomation {
  return (window as unknown as { __stoBrowserAutomation: StoBrowserAutomation }).__stoBrowserAutomation;
}

function runScript(generation?: number): ReturnType<StoBrowserAutomation['buildObservation']> {
  // eslint-disable-next-line no-eval
  return (0, eval)(buildObserveScript(50, generation)) as ReturnType<StoBrowserAutomation['buildObservation']>;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__stoBrowserAutomation;
  // jsdom 无布局：scrollIntoView 不存在 / getBoundingClientRect 全零，补桩以走通页内路径
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
});

describe('A2 buildObservation 加固', () => {
  it('上报 navEpoch（同文档重复执行稳定一致）', () => {
    document.body.innerHTML = '<button id="b1">OK</button>';
    const first = runScript(1);
    expect(typeof first.navEpoch).toBe('string');
    expect(first.navEpoch!.length).toBeGreaterThan(0);
    expect(first.elements).toHaveLength(1);

    const second = runScript(2);
    // 同文档（href + timeOrigin 未变）→ navEpoch 稳定
    expect(second.navEpoch).toBe(first.navEpoch);
  });

  it('注入脚本导出面包含波次 1 新增函数', () => {
    runScript();
    expect(typeof api().noteGeneration).toBe('function');
    expect(typeof api().installDialogHooks).toBe('function');
    expect(typeof api().drainDialogs).toBe('function');
    expect(typeof api().installClickProbe).toBe('function');
    expect(typeof api().readClickProbe).toBe('function');
  });
});

describe('A2 代际兜底（页内 STALE_REF 双保险）', () => {
  it('payload.generation 与最近一次 observe 颁发不一致 → { staleRef: true }', () => {
    document.body.innerHTML = '<button id="b1">OK</button>';
    runScript(7); // 主进程颁发 generation=7

    const stale = api().resolveTarget({ ref: '@e1', generation: 8 }) as { staleRef?: boolean };
    expect(stale.staleRef).toBe(true);

    const fresh = api().resolveTarget({ ref: '@e1', generation: 7 }) as { staleRef?: boolean; node?: unknown };
    expect(fresh.staleRef).toBeUndefined();
    expect(fresh.node).toBeTruthy();

    // 灰度期：不带 generation 跳过校验
    const gray = api().resolveTarget({ ref: '@e1' }) as { node?: unknown };
    expect(gray.node).toBeTruthy();
  });

  it('脚本重跑注入新 generation 时更新页内基准', () => {
    document.body.innerHTML = '<button id="b1">OK</button>';
    runScript(7);
    runScript(9); // 已安装路径也会 noteGeneration
    const stale = api().resolveTarget({ ref: '@e1', generation: 7 }) as { staleRef?: boolean };
    expect(stale.staleRef).toBe(true);
    const fresh = api().resolveTarget({ ref: '@e1', generation: 9 }) as { node?: unknown };
    expect(fresh.node).toBeTruthy();
  });

  it('act 链路命中 staleRef → success:false + staleRef 标记', () => {
    document.body.innerHTML = '<button id="b1">OK</button>';
    runScript(3);
    const result = api().act({ action: 'click', ref: '@e1', generation: 999 });
    expect(result.success).toBe(false);
    expect(result.staleRef).toBe(true);
  });
});

describe('A2 act fill 统一走 fillWithNativeSetter', () => {
  it('fill 通过原生 setter 写入并派发 input/change 事件', () => {
    document.body.innerHTML = '<input id="t" type="text" />';
    const observation = runScript(1);
    const input = document.getElementById('t') as HTMLInputElement;
    const target = observation.elements.find((el) => el.editable);
    expect(target).toBeTruthy();

    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    const result = api().act({ action: 'fill', ref: target!.ref, value: 'hello', generation: 1 });
    expect(result.success).toBe(true);
    expect(input.value).toBe('hello');
    expect(events).toEqual(['input', 'change']);
  });
});

describe('A2 act click 遮挡检测字段面', () => {
  it('正常点击返回 occluded 字段（jsdom 无 elementFromPoint 布局 → false）', () => {
    document.body.innerHTML = '<button id="b1">OK</button>';
    const observation = runScript(1);
    const button = observation.elements.find((el) => el.clickable);
    let clicked = false;
    document.getElementById('b1')!.addEventListener('click', () => {
      clicked = true;
    });

    const result = api().act({ action: 'click', ref: button!.ref, generation: 1 });
    expect(result.success).toBe(true);
    expect(clicked).toBe(true);
    expect(result.occluded).toBe(false);
  });
});

describe('A2 installDialogHooks 页内 fallback', () => {
  it('auto-dismiss：confirm 返回 false、prompt 返回 null，记录后可 drain', () => {
    runScript();
    expect(api().installDialogHooks('auto-dismiss')).toBe(true);

    expect(window.confirm('sure?')).toBe(false);
    expect(window.prompt('name?', 'dv')).toBeNull();
    expect(window.alert('hi')).toBeUndefined();

    const records = api().drainDialogs();
    expect(records.map((r) => r.type)).toEqual(['confirm', 'prompt', 'alert']);
    expect(records.every((r) => r.handled === 'dismissed')).toBe(true);
    expect(api().drainDialogs()).toEqual([]);
  });

  it('auto-accept：confirm 返回 true、prompt 返回默认值；重复安装可更新策略', () => {
    runScript();
    api().installDialogHooks('auto-dismiss');
    expect(api().installDialogHooks('auto-accept')).toBe(true);

    expect(window.confirm('ok?')).toBe(true);
    expect(window.prompt('v?', 'dv')).toBe('dv');
    const records = api().drainDialogs();
    expect(records.every((r) => r.handled === 'accepted')).toBe(true);
  });
});

describe('A2 点击投递探针', () => {
  it('installClickProbe → 事件命中目标链 → readClickProbe delivered + targetMatched', () => {
    document.body.innerHTML = '<div><button id="b1">OK</button></div>';
    const observation = runScript(1);
    const button = observation.elements.find((el) => el.clickable);

    expect(api().readClickProbe()).toBeNull();
    expect(api().installClickProbe({ ref: button!.ref })).toBe(true);

    document.getElementById('b1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const probe = api().readClickProbe();
    expect(probe?.delivered).toBe(true);
    expect(probe?.targetMatched).toBe(true);
  });

  it('探针对非目标点击 targetMatched=false', () => {
    document.body.innerHTML = '<button id="b1">OK</button><button id="b2">Other</button>';
    const observation = runScript(1);
    const button = observation.elements.find((el) => el.clickable);

    api().installClickProbe({ ref: button!.ref });
    document.getElementById('b2')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const probe = api().readClickProbe();
    expect(probe?.delivered).toBe(true);
    expect(probe?.targetMatched).toBe(false);
  });
});

describe('B7 页内可见性/视口守卫（resolveTargetForInput）', () => {
  it('document.visibilityState=hidden → pageNotVisible', () => {
    document.body.innerHTML = '<input id="t" type="text" />';
    runScript(1);

    const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    try {
      const result = api().resolveTargetForInput({ ref: '@e1' });
      expect(result.found).toBe(false);
      expect(result.pageNotVisible).toBe(true);
      expect(result.error).toContain('visibilityState');
    } finally {
      // visibilityState 定义在 Document.prototype 上：own property 覆盖需删除还原，防跨用例污染
      if (original) Object.defineProperty(document, 'visibilityState', original);
      else delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

  it('目标 rect 尺寸为 0（jsdom 默认）→ Element is not visible；补桩后可解析', () => {
    document.body.innerHTML = '<input id="t" type="text" />';
    runScript(1);

    // jsdom 无布局：rect 全零 → 不可见
    const hidden = api().resolveTargetForInput({ ref: '@e1' });
    expect(hidden.found).toBe(false);

    // 补桩布局后正常解析（中心点在视口内）
    const rect = { x: 10, y: 10, left: 10, top: 10, width: 20, height: 20, right: 30, bottom: 30, toJSON: () => ({}) };
    window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return rect as DOMRect;
    };
    const visibleResult = api().resolveTargetForInput({ ref: '@e1' });
    expect(visibleResult.found).toBe(true);
  });

  it('disabled/readonly 输入框仍 found，并上报前置检查字段', () => {
    const rect = { x: 10, y: 10, left: 10, top: 10, width: 20, height: 20, right: 30, bottom: 30, toJSON: () => ({}) };
    window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return rect as DOMRect;
    };
    document.body.innerHTML = '<input id="t" type="text" disabled readonly />';
    runScript(1);
    const result = api().resolveTargetForInput({ ref: '@e1' }) as {
      found: boolean;
      disabled?: boolean;
      readonly?: boolean;
    };
    expect(result.found).toBe(true);
    expect(result.disabled).toBe(true);
    expect(result.readonly).toBe(true);
  });
});

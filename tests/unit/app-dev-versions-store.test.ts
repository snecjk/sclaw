import { beforeEach, describe, expect, it } from 'vitest';

import { useAppDevVersionsStore } from '@/stores/app-dev-versions';
import {
  buildTurnCheckpointSubject,
  excerptUserText,
  resolveTurnCheckpoint,
} from '@/lib/app-dev-turn-versions';

const STORAGE_KEY = 'stoclaw:app-dev-versions-v1';

function resetStore() {
  useAppDevVersionsStore.setState({
    versionsByWorkspace: {},
    pendingTurnsByWorkspace: {},
  });
}

describe('useAppDevVersionsStore（turnKey ↔ checkpoint 映射）', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('pending 登记 + complete 后落映射（hash/subject/时间戳/摘要齐全）', () => {
    const store = useAppDevVersionsStore.getState();
    store.recordPendingTurn('ws-1', {
      turnKey: 'turn-user-u1',
      userTextExcerpt: '把标题改成蓝色',
      endedAt: 1_000,
    });

    expect(useAppDevVersionsStore.getState().peekPendingTurn('ws-1')).toEqual({
      turnKey: 'turn-user-u1',
      userTextExcerpt: '把标题改成蓝色',
      endedAt: 1_000,
    });

    const record = useAppDevVersionsStore.getState().completePendingTurn('ws-1', {
      hash: 'abc123',
      subject: '对话修改 · 把标题改成蓝色',
      timestamp: 2_000,
    });

    expect(record).toEqual({
      hash: 'abc123',
      subject: '对话修改 · 把标题改成蓝色',
      timestamp: 2_000,
      turnEndedAt: 1_000,
      userTextExcerpt: '把标题改成蓝色',
    });
    const state = useAppDevVersionsStore.getState();
    expect(state.versionsByWorkspace['ws-1']?.['turn-user-u1']).toEqual(record);
    expect(state.pendingTurnsByWorkspace['ws-1']).toEqual([]);
  });

  it('同一会话多轮：FIFO 对齐，hash 与轮次一一对应', () => {
    const store = useAppDevVersionsStore.getState();
    for (let i = 1; i <= 3; i += 1) {
      store.recordPendingTurn('ws-1', {
        turnKey: `turn-user-u${i}`,
        userTextExcerpt: `第${i}轮`,
        endedAt: i * 1_000,
      });
    }
    for (let i = 1; i <= 3; i += 1) {
      const record = useAppDevVersionsStore.getState().completePendingTurn('ws-1', {
        hash: `hash${i}`,
        subject: `对话修改 · 第${i}轮`,
        timestamp: i * 1_000 + 500,
      });
      expect(record?.hash).toBe(`hash${i}`);
    }
    const versions = useAppDevVersionsStore.getState().versionsByWorkspace['ws-1'] ?? {};
    expect(Object.keys(versions)).toHaveLength(3);
    expect(versions['turn-user-u1']?.hash).toBe('hash1');
    expect(versions['turn-user-u2']?.hash).toBe('hash2');
    expect(versions['turn-user-u3']?.hash).toBe('hash3');
  });

  it('中断轮 / clean-head：discard 丢弃队首，后续轮次不错位', () => {
    const store = useAppDevVersionsStore.getState();
    // 第 1 轮中断（无文件改动 → clean-head → discard）
    store.recordPendingTurn('ws-1', { turnKey: 'turn-user-a', userTextExcerpt: '中断轮', endedAt: 100 });
    // 第 2 轮正常落 commit
    store.recordPendingTurn('ws-1', { turnKey: 'turn-user-b', userTextExcerpt: '正常轮', endedAt: 200 });

    useAppDevVersionsStore.getState().discardPendingTurn('ws-1');
    const record = useAppDevVersionsStore.getState().completePendingTurn('ws-1', {
      hash: 'hash-b',
      subject: '对话修改 · 正常轮',
    });

    expect(record?.userTextExcerpt).toBe('正常轮');
    const versions = useAppDevVersionsStore.getState().versionsByWorkspace['ws-1'] ?? {};
    expect(versions['turn-user-a']).toBeUndefined();
    expect(versions['turn-user-b']?.hash).toBe('hash-b');
  });

  it('空队列 complete/discard 安全返回 null，不产生映射', () => {
    const store = useAppDevVersionsStore.getState();
    expect(store.completePendingTurn('ws-x', { hash: 'h', subject: 's' })).toBeNull();
    expect(store.completePendingTurn('', { hash: 'h', subject: 's' })).toBeNull();
    expect(() => store.discardPendingTurn('ws-x')).not.toThrow();
    expect(useAppDevVersionsStore.getState().versionsByWorkspace['ws-x']).toBeUndefined();
  });

  it('turnKey 为 null 的 pending：complete 出队但不写映射', () => {
    const store = useAppDevVersionsStore.getState();
    store.recordPendingTurn('ws-1', { turnKey: null, userTextExcerpt: '', endedAt: 100 });
    const record = useAppDevVersionsStore.getState().completePendingTurn('ws-1', {
      hash: 'hash-1',
      subject: '对话修改',
    });
    expect(record).toBeNull();
    expect(useAppDevVersionsStore.getState().pendingTurnsByWorkspace['ws-1']).toEqual([]);
    expect(useAppDevVersionsStore.getState().versionsByWorkspace['ws-1']).toEqual({});
  });

  it('按 workspace 隔离映射与 pending 队列', () => {
    const store = useAppDevVersionsStore.getState();
    store.recordPendingTurn('ws-1', { turnKey: 'turn-user-1', userTextExcerpt: 'a', endedAt: 1 });
    store.recordPendingTurn('ws-2', { turnKey: 'turn-user-1', userTextExcerpt: 'b', endedAt: 2 });
    store.completePendingTurn('ws-1', { hash: 'h1', subject: 's1' });
    store.completePendingTurn('ws-2', { hash: 'h2', subject: 's2' });

    const state = useAppDevVersionsStore.getState();
    expect(state.versionsByWorkspace['ws-1']?.['turn-user-1']?.hash).toBe('h1');
    expect(state.versionsByWorkspace['ws-2']?.['turn-user-1']?.hash).toBe('h2');
    expect(state.peekPendingTurn('ws-3')).toBeNull();
  });

  it('单 workspace 超过 100 条映射时丢弃最旧', () => {
    const versions: Record<string, { hash: string; subject: string; timestamp: number; turnEndedAt: number; userTextExcerpt: string }> = {};
    for (let i = 0; i < 100; i += 1) {
      versions[`turn-${i}`] = {
        hash: `h${i}`,
        subject: 's',
        timestamp: i,
        turnEndedAt: i,
        userTextExcerpt: '',
      };
    }
    useAppDevVersionsStore.setState({
      versionsByWorkspace: { 'ws-1': versions },
      pendingTurnsByWorkspace: {},
    });

    const store = useAppDevVersionsStore.getState();
    store.recordPendingTurn('ws-1', { turnKey: 'turn-new', userTextExcerpt: '', endedAt: 1_000 });
    store.completePendingTurn('ws-1', { hash: 'h-new', subject: 's', timestamp: 1_000 });

    const next = useAppDevVersionsStore.getState().versionsByWorkspace['ws-1'] ?? {};
    expect(Object.keys(next)).toHaveLength(100);
    expect(next['turn-0']).toBeUndefined();
    expect(next['turn-new']?.hash).toBe('h-new');
  });

  it('pending 队列有上限，不会无限堆积', () => {
    const store = useAppDevVersionsStore.getState();
    for (let i = 0; i < 30; i += 1) {
      store.recordPendingTurn('ws-1', { turnKey: `t-${i}`, userTextExcerpt: '', endedAt: i });
    }
    const queue = useAppDevVersionsStore.getState().pendingTurnsByWorkspace['ws-1'] ?? [];
    expect(queue.length).toBeLessThanOrEqual(20);
    // 保留最新的一批
    expect(queue[queue.length - 1]?.turnKey).toBe('t-29');
  });

  it('持久化只落 versionsByWorkspace，pending 握手数据不落盘', () => {
    const store = useAppDevVersionsStore.getState();
    store.recordPendingTurn('ws-1', { turnKey: 'turn-1', userTextExcerpt: '', endedAt: 1 });
    store.completePendingTurn('ws-1', { hash: 'h1', subject: 's1' });
    store.recordPendingTurn('ws-1', { turnKey: 'turn-2', userTextExcerpt: '', endedAt: 2 });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(persisted.state.versionsByWorkspace).toBeTruthy();
    expect(persisted.state.pendingTurnsByWorkspace).toBeUndefined();
  });

  it('rehydrate 清洗脏数据：非法记录被丢弃', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        versionsByWorkspace: {
          'ws-1': {
            good: { hash: 'h1', subject: 's', timestamp: 1, turnEndedAt: 1, userTextExcerpt: 'x' },
            bad: { nohash: true },
          },
          'ws-2': 'not-an-object',
        },
      },
      version: 1,
    }));
    await useAppDevVersionsStore.persist.rehydrate();

    const state = useAppDevVersionsStore.getState();
    expect(state.versionsByWorkspace['ws-1']?.good?.hash).toBe('h1');
    expect(state.versionsByWorkspace['ws-1']?.bad).toBeUndefined();
    expect(state.versionsByWorkspace['ws-2']).toBeUndefined();
  });
});

describe('excerptUserText / buildTurnCheckpointSubject', () => {
  it('压缩空白并截断', () => {
    expect(excerptUserText('  把标题\n改成  蓝色  ')).toBe('把标题 改成 蓝色');
    expect(excerptUserText('x'.repeat(50))).toHaveLength(40);
  });

  it('subject 带用户消息前 20 字', () => {
    expect(buildTurnCheckpointSubject('把标题改成蓝色')).toBe('对话修改 · 把标题改成蓝色');
    expect(buildTurnCheckpointSubject('一二三四五六七八九十一二三四五六七八九十一二三四五'))
      .toBe('对话修改 · 一二三四五六七八九十一二三四五六七八九十');
  });

  it('无摘要时退化为固定文案', () => {
    expect(buildTurnCheckpointSubject('')).toBe('对话修改');
    expect(buildTurnCheckpointSubject(null)).toBe('对话修改');
    expect(buildTurnCheckpointSubject(undefined)).toBe('对话修改');
  });
});

describe('resolveTurnCheckpoint（映射缺失时最近邻降级）', () => {
  const checkpoints = [
    { hash: 'h1', subject: 's1', timestamp: 10_000 },
    { hash: 'h2', subject: 's2', timestamp: 20_000 },
    { hash: 'h3', subject: 's3', timestamp: 30_000 },
  ];

  it('有映射直接用映射', () => {
    const resolved = resolveTurnCheckpoint({
      mapped: { hash: 'hm', subject: 'sm', timestamp: 1, turnEndedAt: 1, userTextExcerpt: '' },
      checkpoints,
      turnEndedAt: 20_100,
    });
    expect(resolved).toEqual({ hash: 'hm', subject: 'sm' });
  });

  it('无映射按时间戳最近邻对齐', () => {
    expect(resolveTurnCheckpoint({ mapped: null, checkpoints, turnEndedAt: 20_500 })?.hash).toBe('h2');
    expect(resolveTurnCheckpoint({ mapped: null, checkpoints, turnEndedAt: 26_000 })?.hash).toBe('h3');
  });

  it('超出 10 分钟窗口或缺结束时间返回 null', () => {
    expect(resolveTurnCheckpoint({ mapped: null, checkpoints, turnEndedAt: 20_000 + 11 * 60_000 }))
      .toBeNull();
    expect(resolveTurnCheckpoint({ mapped: null, checkpoints, turnEndedAt: null })).toBeNull();
    expect(resolveTurnCheckpoint({ mapped: null, checkpoints: [], turnEndedAt: 1 })).toBeNull();
  });
});

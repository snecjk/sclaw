import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  isAppDevStageMode,
  useAppDevWorkbenchStore,
} from '@/stores/app-dev-workbench';

const STORAGE_KEY = 'stoclaw:app-dev-workbench-v1';

const DEFAULT_STATE = {
  mode: 'preview',
  stageCollapsed: false,
  device: 'desktop',
  tuneMode: 'chat',
  inspectActive: false,
  diffRequest: null,
  versionRestoreRequest: null,
  assetRevealPath: null,
  agentSourceReloadRequest: null,
  codeFollowPausedUntil: 0,
} as const;

describe('useAppDevWorkbenchStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppDevWorkbenchStore.setState({ ...DEFAULT_STATE });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with preview mode and expanded stage', () => {
    const state = useAppDevWorkbenchStore.getState();
    expect(state.mode).toBe('preview');
    expect(state.stageCollapsed).toBe(false);
    expect(state.device).toBe('desktop');
    expect(state.tuneMode).toBe('chat');
    expect(state.inspectActive).toBe(false);
    expect(state.diffRequest).toBeNull();
    expect(state.versionRestoreRequest).toBeNull();
    expect(state.codeFollowPausedUntil).toBe(0);
  });

  it('switches mode from outside the stage component (对话侧驱动工作台)', () => {
    useAppDevWorkbenchStore.getState().setMode('code');
    expect(useAppDevWorkbenchStore.getState().mode).toBe('code');

    useAppDevWorkbenchStore.getState().setMode('versions');
    expect(useAppDevWorkbenchStore.getState().mode).toBe('versions');

    useAppDevWorkbenchStore.getState().setMode('more-git');
    expect(useAppDevWorkbenchStore.getState().mode).toBe('more-git');
  });

  it('ignores invalid mode values', () => {
    useAppDevWorkbenchStore.getState().setMode('code');
    useAppDevWorkbenchStore.getState().setMode('git' as never);
    expect(useAppDevWorkbenchStore.getState().mode).toBe('code');
  });

  it('toggles and sets stageCollapsed', () => {
    useAppDevWorkbenchStore.getState().toggleStageCollapsed();
    expect(useAppDevWorkbenchStore.getState().stageCollapsed).toBe(true);
    useAppDevWorkbenchStore.getState().toggleStageCollapsed();
    expect(useAppDevWorkbenchStore.getState().stageCollapsed).toBe(false);

    useAppDevWorkbenchStore.getState().setStageCollapsed(true);
    expect(useAppDevWorkbenchStore.getState().stageCollapsed).toBe(true);
  });

  it('exposes T03/T04/T06-facing setters', () => {
    const s = useAppDevWorkbenchStore.getState();
    s.setDevice('mobile');
    s.setTuneMode('tune');
    s.setDiffRequest({ hash: 'abc123' });
    s.setVersionRestoreRequest({ hash: 'def456' });

    const next = useAppDevWorkbenchStore.getState();
    expect(next.device).toBe('mobile');
    expect(next.tuneMode).toBe('tune');
    expect(next.diffRequest).toEqual({ hash: 'abc123' });
    expect(next.versionRestoreRequest).toEqual({ hash: 'def456' });

    next.setDiffRequest(null);
    next.setVersionRestoreRequest(null);
    expect(useAppDevWorkbenchStore.getState().diffRequest).toBeNull();
    expect(useAppDevWorkbenchStore.getState().versionRestoreRequest).toBeNull();
    expect(useAppDevWorkbenchStore.getState().codeFollowPausedUntil).toBe(0);
  });

  it('starts inspect without entering 手动微调', () => {
    useAppDevWorkbenchStore.getState().setInspectActive(true);
    const next = useAppDevWorkbenchStore.getState();
    expect(next.inspectActive).toBe(true);
    expect(next.tuneMode).toBe('chat');
  });

  it('keeps inspect and tune exclusive but independently toggleable', () => {
    const store = useAppDevWorkbenchStore.getState();
    store.setInspectActive(true);
    store.setTuneMode('tune');
    expect(useAppDevWorkbenchStore.getState().inspectActive).toBe(false);
    expect(useAppDevWorkbenchStore.getState().tuneMode).toBe('tune');

    useAppDevWorkbenchStore.getState().setInspectActive(true);
    expect(useAppDevWorkbenchStore.getState().tuneMode).toBe('chat');
    expect(useAppDevWorkbenchStore.getState().inspectActive).toBe(true);
  });

  it('pauses code follow for the idle window and then allows follow again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useAppDevWorkbenchStore.getState().pauseCodeFollow(15_000);
    expect(useAppDevWorkbenchStore.getState().codeFollowPausedUntil).toBe(16_000);
    vi.setSystemTime(16_000);
    expect(useAppDevWorkbenchStore.getState().codeFollowPausedUntil).toBeLessThanOrEqual(Date.now());
  });

  it('requestAgentSourceReload bumps token so the same path can reload twice', () => {
    useAppDevWorkbenchStore.getState().requestAgentSourceReload('src/App.tsx');
    expect(useAppDevWorkbenchStore.getState().agentSourceReloadRequest).toEqual({
      path: 'src/App.tsx',
      token: 1,
    });
    useAppDevWorkbenchStore.getState().requestAgentSourceReload('src/App.tsx');
    expect(useAppDevWorkbenchStore.getState().agentSourceReloadRequest).toEqual({
      path: 'src/App.tsx',
      token: 2,
    });
    useAppDevWorkbenchStore.getState().clearAgentSourceReloadRequest();
    expect(useAppDevWorkbenchStore.getState().agentSourceReloadRequest).toBeNull();
  });

  it('does not persist inspectActive', () => {
    useAppDevWorkbenchStore.getState().setMode('code');
    useAppDevWorkbenchStore.getState().setStageCollapsed(true);
    useAppDevWorkbenchStore.getState().setDevice('mobile');
    useAppDevWorkbenchStore.getState().setInspectActive(true);
    useAppDevWorkbenchStore.getState().setDiffRequest({ hash: 'abc' });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(persisted.state).toEqual({ mode: 'code', stageCollapsed: true });
  });

  it('sanitizes corrupted persisted state on rehydrate', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { mode: 'not-a-mode', stageCollapsed: 'yes' },
      version: 1,
    }));
    await useAppDevWorkbenchStore.persist.rehydrate();

    const state = useAppDevWorkbenchStore.getState();
    expect(state.mode).toBe('preview');
    expect(state.stageCollapsed).toBe(false);
  });

  it('restores persisted mode and stageCollapsed on rehydrate', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { mode: 'versions', stageCollapsed: true },
      version: 1,
    }));
    await useAppDevWorkbenchStore.persist.rehydrate();

    const state = useAppDevWorkbenchStore.getState();
    expect(state.mode).toBe('versions');
    expect(state.stageCollapsed).toBe(true);
  });
});

describe('isAppDevStageMode', () => {
  it.each([
    'preview',
    'code',
    'versions',
    'more-git',
    'more-external',
    'more-community',
    'more-assets',
    'more-runtime',
  ] as const)('accepts %s', (mode) => {
    expect(isAppDevStageMode(mode)).toBe(true);
  });

  it.each(['git', 'external-services', 'community', '', 1, null, undefined])(
    'rejects %s',
    (mode) => {
      expect(isAppDevStageMode(mode)).toBe(false);
    },
  );
});

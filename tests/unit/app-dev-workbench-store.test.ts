import { beforeEach, describe, expect, it } from 'vitest';

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
  diffRequest: null,
  versionRestoreRequest: null,
  assetRevealPath: null,
} as const;

describe('useAppDevWorkbenchStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppDevWorkbenchStore.setState({ ...DEFAULT_STATE });
  });

  it('starts with preview mode and expanded stage', () => {
    const state = useAppDevWorkbenchStore.getState();
    expect(state.mode).toBe('preview');
    expect(state.stageCollapsed).toBe(false);
    expect(state.device).toBe('desktop');
    expect(state.tuneMode).toBe('chat');
    expect(state.diffRequest).toBeNull();
    expect(state.versionRestoreRequest).toBeNull();
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
  });

  it('persists only mode and stageCollapsed under the v1 key', () => {
    useAppDevWorkbenchStore.getState().setMode('code');
    useAppDevWorkbenchStore.getState().setStageCollapsed(true);
    useAppDevWorkbenchStore.getState().setDevice('mobile');
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

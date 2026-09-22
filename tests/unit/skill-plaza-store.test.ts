import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the API layer so the store's fetch actions are observable without IPC.
vi.mock('@/lib/skill-plaza-api', () => {
  class SkillPlazaAuthNotReadyError extends Error {
    constructor(message = 'Skill plaza auth not ready') {
      super(message);
      this.name = 'SkillPlazaAuthNotReadyError';
    }
  }
  return {
    fetchSkillPlazaCategories: vi.fn(async () => []),
    fetchSkillPlazaList: vi.fn(async () => ({
      skills: [],
      categoryCounts: {},
      hasMore: false,
      page: 1,
      pageSize: 20,
      total: 0,
    })),
    fetchLocalSkills: vi.fn(async () => ({
      skills: [],
      categoryCounts: {},
      hasMore: false,
      page: 1,
      pageSize: 20,
      total: 0,
    })),
    installPlazaSkill: vi.fn(async () => {}),
    uninstallPlazaSkill: vi.fn(async () => {}),
    recordSkillUse: vi.fn(async () => {}),
    toggleSkillEnabled: vi.fn(async () => {}),
    uploadSkillZip: vi.fn(async () => {}),
    SkillPlazaAuthNotReadyError,
    isSkillPlazaAuthNotReadyError: (err: unknown) => err instanceof SkillPlazaAuthNotReadyError,
  };
});

import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { fetchSkillPlazaList, fetchLocalSkills, SkillPlazaAuthNotReadyError } from '@/lib/skill-plaza-api';

const mockedList = vi.mocked(fetchSkillPlazaList);
const mockedLocal = vi.mocked(fetchLocalSkills);

function makeSkill(slug: string) {
  return {
    slug,
    title: slug,
    description: '',
    category: null,
    categoryCode: null,
    source: 'official' as const,
    installed: false,
    enabled: true,
    installCount: 0,
    useCount: 0,
    points: 8,
    defaultPrompt: slug,
  };
}

describe('skill-plaza store request coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSkillPlazaStore.setState({
      plazaSkills: [],
      mySkills: [],
      loading: false,
      backgroundRefreshing: false,
      awaitingAuth: false,
      error: null,
      searchQuery: '',
      activeCategory: '',
      sortMode: 'hot',
      activeTab: 'all',
      page: 1,
      pageSize: 20,
    });
    mockedList.mockResolvedValue({
      skills: [],
      categoryCounts: {},
      hasMore: false,
      page: 1,
      pageSize: 20,
      total: 0,
    });
  });

  it('collapses concurrent identical plaza fetches into one request', async () => {
    const { fetchPlazaSkills } = useSkillPlazaStore.getState();
    await Promise.all([
      fetchPlazaSkills({ reset: true }),
      fetchPlazaSkills({ reset: true }),
      fetchPlazaSkills({ reset: true }),
    ]);
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('shows the blocking loader only when there is no data yet', async () => {
    let resolveList: (v: unknown) => void = () => {};
    mockedList.mockImplementationOnce(
      () => new Promise((resolve) => { resolveList = resolve as (v: unknown) => void; }) as never,
    );

    const promise = useSkillPlazaStore.getState().fetchPlazaSkills({ reset: true });
    expect(useSkillPlazaStore.getState().loading).toBe(true);
    expect(useSkillPlazaStore.getState().backgroundRefreshing).toBe(false);

    resolveList({ skills: [], categoryCounts: {}, hasMore: false, page: 1, pageSize: 20, total: 0 });
    await promise;
    expect(useSkillPlazaStore.getState().loading).toBe(false);
  });

  it('keeps existing data visible during a background refresh (SWR)', async () => {
    useSkillPlazaStore.setState({ plazaSkills: [makeSkill('a')] });

    let resolveList: (v: unknown) => void = () => {};
    mockedList.mockImplementationOnce(
      () => new Promise((resolve) => { resolveList = resolve as (v: unknown) => void; }) as never,
    );

    const promise = useSkillPlazaStore.getState().fetchPlazaSkills({ reset: true });
    // Data already present: refresh must not flip the blocking loader.
    expect(useSkillPlazaStore.getState().loading).toBe(false);
    expect(useSkillPlazaStore.getState().backgroundRefreshing).toBe(true);
    expect(useSkillPlazaStore.getState().plazaSkills).toHaveLength(1);

    resolveList({
      skills: [makeSkill('a'), makeSkill('b')],
      categoryCounts: {},
      hasMore: false,
      page: 1,
      pageSize: 20,
      total: 2,
    });
    await promise;
    expect(useSkillPlazaStore.getState().backgroundRefreshing).toBe(false);
    expect(useSkillPlazaStore.getState().plazaSkills).toHaveLength(2);
  });

  it('does not refetch on mine-tab search (client-side filtering)', () => {
    useSkillPlazaStore.setState({ activeTab: 'mine' });
    useSkillPlazaStore.getState().setSearchQuery('foo');
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('enters an awaiting-auth loading state (no error) when the token is not ready', async () => {
    vi.useFakeTimers();
    try {
      mockedList.mockRejectedValueOnce(new SkillPlazaAuthNotReadyError());
      await useSkillPlazaStore.getState().fetchPlazaSkills({ reset: true });

      const state = useSkillPlazaStore.getState();
      // With no data yet, the page must stay in a loading state, not show data
      // and not surface an error toast.
      expect(state.awaitingAuth).toBe(true);
      expect(state.loading).toBe(true);
      expect(state.error).toBeNull();
    } finally {
      // The auth-not-ready path schedules a retry timer; drop it so it does not
      // leak into other tests.
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('clears the awaiting-auth state once a fetch succeeds', async () => {
    vi.useFakeTimers();
    try {
      useSkillPlazaStore.setState({ awaitingAuth: true, loading: true });
      mockedList.mockResolvedValueOnce({
        skills: [makeSkill('a')],
        categoryCounts: {},
        hasMore: false,
        page: 1,
        pageSize: 20,
        total: 1,
      });
      await useSkillPlazaStore.getState().fetchPlazaSkills({ reset: true });

      const state = useSkillPlazaStore.getState();
      expect(state.awaitingAuth).toBe(false);
      expect(state.loading).toBe(false);
      expect(state.plazaSkills).toHaveLength(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps local skill titles from the API instead of plaza meta overrides', async () => {
    useSkillPlazaStore.setState({
      plazaSkills: [{
        ...makeSkill('qpath'),
        title: 'QPath 项目分析',
        description: 'plaza desc',
        installCount: 9,
        useCount: 3,
      }],
      plazaSkillMetaMap: {
        qpath: {
          title: 'QPath 项目分析',
          description: 'cached desc',
          icon: undefined,
          category: null,
          categoryCode: null,
          installCount: 9,
          useCount: 3,
        },
      },
    });
    mockedLocal.mockResolvedValueOnce({
      skills: [{
        ...makeSkill('qpath'),
        title: 'Qpath技能',
        description: 'local desc',
        source: 'mine',
        installed: true,
      }],
      categoryCounts: {},
      hasMore: false,
      page: 1,
      pageSize: 1,
      total: 1,
    });

    await useSkillPlazaStore.getState().fetchLocalSkills({ forceRefresh: true });

    const skill = useSkillPlazaStore.getState().mySkills.find((item) => item.slug === 'qpath');
    expect(skill?.title).toBe('Qpath技能');
    expect(skill?.description).toBe('local desc');
    expect(skill?.installCount).toBe(9);
    expect(skill?.useCount).toBe(3);
  });
});

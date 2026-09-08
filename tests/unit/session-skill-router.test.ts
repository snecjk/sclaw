import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getCurrentActiveUserCode: vi.fn(),
  listDesiredPackages: vi.fn(),
  beginSkillTurn: vi.fn(),
  getSessionSkillState: vi.fn(),
  reconcileSessionSkillState: vi.fn(),
  upsertCards: vi.fn(),
  search: vi.fn(),
}));

vi.mock('../../electron/utils/store', () => ({
  getSetting: mocks.getSetting,
}));

vi.mock('../../electron/services/user-skill-workspace', () => ({
  getCurrentActiveUserCode: mocks.getCurrentActiveUserCode,
}));

vi.mock('../../electron/services/skills/canonical-store', () => ({
  listDesiredPackages: mocks.listDesiredPackages,
}));

vi.mock('../../electron/services/skills/session-skill-state-service', () => ({
  beginSkillTurn: mocks.beginSkillTurn,
  getSessionSkillState: mocks.getSessionSkillState,
  reconcileSessionSkillState: mocks.reconcileSessionSkillState,
}));

vi.mock('../../electron/services/skills/skill-routing-remote-service', () => ({
  skillRoutingRemoteService: {
    upsertCards: mocks.upsertCards,
    search: mocks.search,
  },
}));

import { routeSessionSkills } from '../../electron/services/skills/session-skill-router';

describe('session Skill router discovery setting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentActiveUserCode.mockResolvedValue('1200287');
    mocks.getSetting.mockResolvedValue(false);
    mocks.listDesiredPackages.mockResolvedValue([
      {
        slug: 'spreadsheets',
        sourceDir: 'D:/skills/spreadsheets',
        version: '1.0.0',
        enabled: true,
        scope: 'user',
        userCode: '1200287',
        source: 'local',
      },
      {
        slug: 'pdf',
        sourceDir: 'D:/skills/pdf',
        version: '1.0.0',
        enabled: true,
        scope: 'user',
        userCode: '1200287',
        source: 'local',
      },
      {
        slug: 'disabled-skill',
        sourceDir: 'D:/skills/disabled-skill',
        version: '1.0.0',
        enabled: false,
        scope: 'user',
        userCode: '1200287',
        source: 'local',
      },
    ]);
  });

  it('loads every enabled installed Skill without remote routing and opens a lightweight runtime turn when disabled', async () => {
    const onProgress = vi.fn();
    const result = await routeSessionSkills({
      sessionKey: 'pi:main:session-1',
      runId: 'run-1',
      agentId: 'main',
      engine: 'pi',
      mode: 'interactive',
      query: 'create a report',
      onProgress,
    });

    expect(result.selected.map((skill) => skill.slug)).toEqual(['spreadsheets', 'pdf']);
    expect(result.selected.every((skill) => skill.reasons.includes('skill-discovery-disabled'))).toBe(true);
    expect(result.remoteSearched).toBe(false);
    expect(mocks.upsertCards).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.reconcileSessionSkillState).not.toHaveBeenCalled();
    expect(mocks.getSessionSkillState).not.toHaveBeenCalled();
    expect(mocks.beginSkillTurn).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      selected: [],
      remoteSearched: false,
    }));
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('keeps the existing remote routing and lease flow when enabled', async () => {
    mocks.getSetting.mockResolvedValue(true);
    mocks.listDesiredPackages.mockResolvedValue([
      {
        slug: 'sai-cli',
        name: 'SAI CLI',
        sourceDir: 'D:/skills/sai-cli',
        version: '1.0.0',
        enabled: true,
        scope: 'user',
        userCode: '1200287',
        source: 'stoclaw-preinstalled',
      },
      {
        slug: 'spreadsheets',
        sourceDir: 'D:/skills/spreadsheets',
        version: '1.0.0',
        enabled: true,
        scope: 'user',
        userCode: '1200287',
        source: 'local',
      },
    ]);
    mocks.getSessionSkillState.mockResolvedValue({
      sessionKey: 'claude:main:session-2',
      turnNo: 0,
      manifestRevision: '',
      skills: [],
      pendingTurns: {},
    });
    mocks.upsertCards.mockResolvedValue(undefined);
    mocks.search.mockResolvedValue({
      items: [{ slug: 'spreadsheets', score: 0.9, reasons: ['remote-hybrid'] }],
      degraded: false,
    });
    mocks.beginSkillTurn.mockResolvedValue(undefined);

    const onProgress = vi.fn();
    const result = await routeSessionSkills({
      sessionKey: 'claude:main:session-2',
      runId: 'run-2',
      agentId: 'main',
      engine: 'claude',
      mode: 'interactive',
      query: 'create a report',
      onProgress,
    });

    expect(result.selected.map((skill) => skill.slug)).toContain('spreadsheets');
    expect(result.selected.map((skill) => skill.slug)).toContain('sai-cli');
    expect(result.remoteSearched).toBe(true);
    expect(mocks.upsertCards).toHaveBeenCalled();
    expect(mocks.search).toHaveBeenCalled();
    expect(mocks.reconcileSessionSkillState).toHaveBeenCalled();
    expect(mocks.beginSkillTurn).toHaveBeenCalled();
    expect(mocks.beginSkillTurn).toHaveBeenCalledWith(expect.objectContaining({
      selected: expect.arrayContaining([
        expect.objectContaining({ slug: 'sai-cli', state: 'pinned', reasons: ['builtin-pinned'] }),
      ]),
    }));
    expect(onProgress.mock.calls.map(([message]) => message)).toEqual([
      '正在匹配技能…',
      '已匹配技能：SAI CLI、spreadsheets',
    ]);
  });

  it('does not fall back to local matching when remote search succeeds with no results', async () => {
    mocks.getSetting.mockResolvedValue(true);
    mocks.listDesiredPackages.mockResolvedValue([{
      slug: 'custom-report-skill',
      name: 'Custom Report Skill',
      description: 'create custom reports',
      sourceDir: 'D:/skills/custom-report-skill',
      version: '1.0.0',
      enabled: true,
      scope: 'user',
      userCode: '1200287',
      source: 'local',
    }]);
    mocks.getSessionSkillState.mockResolvedValue({
      sessionKey: 'pi:empty-remote:session',
      turnNo: 0,
      manifestRevision: '',
      skills: [],
      pendingTurns: {},
    });
    mocks.upsertCards.mockResolvedValue(undefined);
    mocks.search.mockResolvedValue({ items: [], degraded: false });
    mocks.beginSkillTurn.mockResolvedValue(undefined);
    const onProgress = vi.fn();

    const result = await routeSessionSkills({
      sessionKey: 'pi:empty-remote:session',
      runId: 'run-empty-remote',
      agentId: 'empty-remote',
      engine: 'pi',
      mode: 'interactive',
      query: 'use custom-report-skill to create a report',
      onProgress,
    });

    expect(result.selected).toEqual([]);
    expect(result.remoteSearched).toBe(true);
    expect(result.degraded).toBe(false);
    expect(onProgress.mock.calls.map(([message]) => message)).toEqual([
      '正在匹配技能…',
      '未匹配到相关技能，正在直接处理…',
    ]);
  });

  it('uses local matching only when remote search throws', async () => {
    mocks.getSetting.mockResolvedValue(true);
    mocks.listDesiredPackages.mockResolvedValue([{
      slug: 'custom-report-skill',
      name: 'Custom Report Skill',
      description: 'create custom reports',
      sourceDir: 'D:/skills/custom-report-skill',
      version: '1.0.0',
      enabled: true,
      scope: 'user',
      userCode: '1200287',
      source: 'local',
    }]);
    mocks.getSessionSkillState.mockResolvedValue({
      sessionKey: 'pi:failed-remote:session',
      turnNo: 0,
      manifestRevision: '',
      skills: [],
      pendingTurns: {},
    });
    mocks.upsertCards.mockResolvedValue(undefined);
    mocks.search.mockRejectedValue(new Error('remote unavailable'));
    mocks.beginSkillTurn.mockResolvedValue(undefined);

    const result = await routeSessionSkills({
      sessionKey: 'pi:failed-remote:session',
      runId: 'run-failed-remote',
      agentId: 'failed-remote',
      engine: 'pi',
      mode: 'interactive',
      query: 'use custom-report-skill to create a report',
    });

    expect(result.selected).toEqual([
      expect.objectContaining({
        slug: 'custom-report-skill',
        reasons: ['local-match'],
      }),
    ]);
    expect(result.remoteSearched).toBe(false);
    expect(result.degraded).toBe(true);
  });
});

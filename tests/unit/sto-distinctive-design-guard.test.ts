import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISTINCTIVE_DESIGN_SKILL_SLUG,
  evaluateBeforeHtmlWrite,
  extractSkillSlugsFromValue,
  hasReadDistinctiveDesignSkill,
  isCliReportGeneratorPipeline,
  isHtmlPath,
  noteSkillUsageFromToolPayload,
  resetDistinctiveDesignGuardSessionsForTests,
} from '../../sto-plugin/openclaw/sto-distinctive-design-guard/guard-core.js';
import register from '../../sto-plugin/openclaw/sto-distinctive-design-guard/index.js';

describe('sto-distinctive-design-guard guard-core', () => {
  beforeEach(() => {
    resetDistinctiveDesignGuardSessionsForTests();
  });

  it('detects html paths', () => {
    expect(isHtmlPath('./.claw-output/report.html')).toBe(true);
    expect(isHtmlPath('daily-report.htm')).toBe(true);
    expect(isHtmlPath('./.claw-output/report.md')).toBe(false);
  });

  it('extracts skill slug from read paths', () => {
    const slugs = extractSkillSlugsFromValue({
      path: '~/.stoclaw/openclaw/skills/sto-distinctive-design/SKILL.md',
    });
    expect(slugs.has(DISTINCTIVE_DESIGN_SKILL_SLUG)).toBe(true);
  });

  it('blocks html write before skill is read', () => {
    const decision = evaluateBeforeHtmlWrite({
      toolName: 'write',
      params: { path: './.claw-output/report.html' },
      sessionKey: 's1',
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain('sto-distinctive-design');
    }
  });

  it('allows html write after skill read', () => {
    noteSkillUsageFromToolPayload('s1', 's1', {
      params: { path: '~/.stoclaw/openclaw/skills/sto-distinctive-design/SKILL.md' },
    });
    expect(hasReadDistinctiveDesignSkill('s1')).toBe(true);

    const decision = evaluateBeforeHtmlWrite({
      toolName: 'write',
      params: { path: './.claw-output/report.html' },
      sessionKey: 's1',
    });
    expect(decision).toEqual({ allowed: true });
  });

  it('detects cli-report-generator pipeline commands', () => {
    expect(
      isCliReportGeneratorPipeline('bash', {
        command:
          'uv run python scripts/generate_report.py --config configs/network-report.json',
      }),
    ).toBe(true);
  });

  it('does not block non-html writes', () => {
    const decision = evaluateBeforeHtmlWrite({
      toolName: 'write',
      params: { path: './.claw-output/report.sql' },
      sessionKey: 's3',
    });
    expect(decision).toEqual({ allowed: true });
  });
});

describe('sto-distinctive-design-guard plugin', () => {
  const registeredHooks = new Map<string, (...args: unknown[]) => unknown>();

  function buildApi(pluginConfig: Record<string, unknown> = {}) {
    registeredHooks.clear();

    return {
      pluginConfig,
      config: {},
      id: 'sto-distinctive-design-guard',
      name: 'STO Distinctive Design Guard',
      source: 'test',
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      on: vi.fn((eventName: string, handler: (...args: unknown[]) => unknown) => {
        registeredHooks.set(eventName, handler);
      }),
      registerTool: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetDistinctiveDesignGuardSessionsForTests();
  });

  it('registers before_prompt_build, before_tool_call, and after_tool_call', () => {
    const api = buildApi();
    register.register(api as never);

    expect(registeredHooks.has('before_prompt_build')).toBe(true);
    expect(registeredHooks.has('before_tool_call')).toBe(true);
    expect(registeredHooks.has('after_tool_call')).toBe(true);
  });

  it('injects routing prompt on before_prompt_build', async () => {
    const api = buildApi();
    register.register(api as never);

    const beforePromptBuild = registeredHooks.get('before_prompt_build');
    const result = await beforePromptBuild?.({}, { sessionKey: 's1' });

    expect(result).toMatchObject({
      appendSystemContext: expect.stringContaining('sto-distinctive-design'),
    });
  });

  it('blocks html write before skill read on before_tool_call', () => {
    const api = buildApi();
    register.register(api as never);

    const beforeToolCall = registeredHooks.get('before_tool_call');
    const result = beforeToolCall?.(
      {
        toolName: 'write',
        params: { path: './.claw-output/report.html' },
      },
      { sessionKey: 's-block', sessionId: 's-block' },
    );

    expect(result).toMatchObject({
      block: true,
      blockReason: expect.stringContaining('sto-distinctive-design'),
    });
  });
});

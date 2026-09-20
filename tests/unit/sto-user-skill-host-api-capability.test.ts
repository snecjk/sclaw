import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STO_SKILL_RUNTIME_CAPABILITY,
  StoSkillRuntimePortError,
} from '../../electron/agent-extensions/extensions/sto-skill-runtime/capability';
import { createHostApiSkillRuntimePort } from '../../electron/agent-extensions/extensions/sto-skill-runtime/host-api-capability';

describe('sto-skill-runtime user-skill Host API capability', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('unwraps saved skill data and accepts the schedule acknowledgement', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/skills/save-user')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              ok: true,
              slug: 'demo',
              scope: 'user',
              userCode: 'u-1',
              storePath: 'D:/skills/demo',
              source: 'local',
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ success: true, scheduled: true }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const port = createHostApiSkillRuntimePort();
    await expect(port.save({ skillMd: 'demo' })).resolves.toMatchObject({ slug: 'demo' });
    await expect(port.scheduleOrphanImport('test')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves structured business error codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({
        success: false,
        code: 'PREINSTALL_PROTECTED',
        error: '不能覆盖预装技能',
      }),
    })));

    const port = createHostApiSkillRuntimePort();
    const error = await port.save({ skillMd: 'demo' }).catch((caught) => caught);
    expect(error).toBeInstanceOf(StoSkillRuntimePortError);
    expect(error).toMatchObject({ code: 'PREINSTALL_PROTECTED', message: '不能覆盖预装技能' });
    expect(STO_SKILL_RUNTIME_CAPABILITY.id).toBe('sto.skill-runtime');
  });

  it('posts an exact delete target and unwraps the response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { ok: true, slug: 'demo', scope: 'user', userCode: 'u-1' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createHostApiSkillRuntimePort().delete({ slug: 'demo' }))
      .resolves.toMatchObject({ ok: true, slug: 'demo' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/skills/delete-user'), expect.objectContaining({
      method: 'POST', body: JSON.stringify({ slug: 'demo' }),
    }));
  });
});

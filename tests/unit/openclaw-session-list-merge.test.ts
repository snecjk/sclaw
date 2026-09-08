import { describe, expect, it } from 'vitest';
import { mergeOpenClawListedSessions } from '../../electron/engines/openclaw-adapter';

describe('mergeOpenClawListedSessions', () => {
  it('keeps disk store project sessions when Gateway only returns main', () => {
    const merged = mergeOpenClawListedSessions(
      [
        { key: 'agent:proj-a--main:session-1', label: '项目会话', engineType: 'openclaw', updatedAt: 10 },
        { key: 'agent:main:session-2', engineType: 'openclaw', updatedAt: 5 },
      ],
      [
        { key: 'agent:main:session-2', label: 'Gateway', engineType: 'openclaw', updatedAt: 20 },
      ],
    );
    expect(merged).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'agent:proj-a--main:session-1',
        label: '项目会话',
        updatedAt: 10,
      }),
      expect.objectContaining({
        key: 'agent:main:session-2',
        label: 'Gateway',
        updatedAt: 20,
      }),
    ]));
    expect(merged).toHaveLength(2);
  });

  it('lets Gateway fields fill gaps on overlapping keys', () => {
    const merged = mergeOpenClawListedSessions(
      [{ key: 'agent:main:session-1', spawnedBy: 'local', engineType: 'openclaw' }],
      [{ key: 'agent:main:session-1', label: 'Gateway', engineType: 'openclaw', updatedAt: 9 }],
    );
    expect(merged).toEqual([{
      key: 'agent:main:session-1',
      spawnedBy: 'local',
      label: 'Gateway',
      engineType: 'openclaw',
      updatedAt: 9,
    }]);
  });
});

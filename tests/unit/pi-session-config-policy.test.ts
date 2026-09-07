import { describe, expect, it } from 'vitest';
import type { PiSessionConfig } from '../../shared/pi-runtime-protocol';
import { piSessionConfigurationKey } from '../../electron/pi-runtime/session-config-policy';

const config = (selectedSkills: Array<{ slug: string; path: string; sourceHash: string }>, model = 'qwen'): PiSessionConfig => ({
  sessionKey: 'pi:main:test',
  cwd: 'D:/workspace',
  agentDir: 'D:/pi',
  sessionDir: 'D:/pi/sessions',
  systemPrompt: 'stable context',
  model: { provider: 'openai', model, apiKey: 'secret' },
  selectedSkills,
  skillRoots: selectedSkills.map((skill) => skill.path),
  skillSetHash: selectedSkills.map((skill) => `${skill.slug}@${skill.sourceHash}`).join(','),
});

describe('Pi session configuration identity', () => {
  it('rebuilds native resources when the matched Skill set changes', () => {
    expect(piSessionConfigurationKey(config([{ slug: 'documents', path: 'D:/skills/documents', sourceHash: 'a' }]))).not.toBe(
      piSessionConfigurationKey(config([{ slug: 'spreadsheets', path: 'D:/skills/spreadsheets', sourceHash: 'b' }])),
    );
  });

  it('does not recreate after the active session file is persisted to the registry', () => {
    const before = config([]);
    const after = { ...config([]), sessionFile: 'D:/pi/sessions/current.jsonl' };
    expect(piSessionConfigurationKey(before)).toBe(piSessionConfigurationKey(after));
  });

  it('does recreate a session when the model changes', () => {
    expect(piSessionConfigurationKey(config([], 'qwen'))).not.toBe(
      piSessionConfigurationKey(config([], 'claude')),
    );
  });

  it('keeps scheduled extension semantics in the session identity', () => {
    expect(piSessionConfigurationKey(config([]))).not.toBe(
      piSessionConfigurationKey({ ...config([]), sessionMode: 'scheduled' }),
    );
  });
});

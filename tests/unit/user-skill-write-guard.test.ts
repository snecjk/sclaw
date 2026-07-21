import { describe, expect, it } from 'vitest';
import {
  evaluateUserSkillWriteGuard,
  isSkillPackagePath,
  shouldScheduleOrphanImportAfterTool,
} from '../../shared/user-skill-write-guard';

describe('user-skill-write-guard', () => {
  it('detects openclaw / workspace / skills-store paths', () => {
    expect(isSkillPackagePath('~/.stoclaw/openclaw/skills/music-review/SKILL.md')).toBe(true);
    expect(isSkillPackagePath('/Users/x/.stoclaw/skills-store/users/1/skills/foo/SKILL.md')).toBe(true);
    expect(isSkillPackagePath('workspace/skills/foo/SKILL.md')).toBe(true);
    expect(isSkillPackagePath('./.claw-output/report.html')).toBe(false);
    expect(isSkillPackagePath('/tmp/notes.md')).toBe(false);
  });

  it('blocks write/edit into skill dirs', () => {
    const decision = evaluateUserSkillWriteGuard({
      toolName: 'write',
      params: { path: '~/.stoclaw/openclaw/skills/music-review/SKILL.md', content: 'x' },
    });
    expect(decision.blocked).toBe(true);
    if (decision.blocked) {
      expect(decision.reason).toContain('save_user_skill');
    }
  });

  it('allows save_user_skill itself', () => {
    expect(
      evaluateUserSkillWriteGuard({
        toolName: 'save_user_skill',
        params: { skillMd: '---\nname: a\ndescription: b\n---\n' },
      }).blocked,
    ).toBe(false);
  });

  it('allows normal write outside skill dirs', () => {
    expect(
      evaluateUserSkillWriteGuard({
        toolName: 'Write',
        params: { file_path: '/tmp/hello.md', content: 'hi' },
      }).blocked,
    ).toBe(false);
  });

  it('blocks shell mkdir/cp into skills', () => {
    const decision = evaluateUserSkillWriteGuard({
      toolName: 'Bash',
      params: { command: 'mkdir -p ~/.stoclaw/openclaw/skills/music-review && echo x > ~/.stoclaw/openclaw/skills/music-review/SKILL.md' },
    });
    expect(decision.blocked).toBe(true);
  });

  it('allows listing skill dirs', () => {
    expect(
      evaluateUserSkillWriteGuard({
        toolName: 'exec',
        params: { command: 'ls ~/.stoclaw/openclaw/skills' },
      }).blocked,
    ).toBe(false);
  });

  it('schedules orphan after skill-path write attempts', () => {
    expect(
      shouldScheduleOrphanImportAfterTool({
        toolName: 'write',
        params: { path: '~/.stoclaw/openclaw/skills/foo/SKILL.md' },
      }),
    ).toBe(true);
    expect(
      shouldScheduleOrphanImportAfterTool({
        toolName: 'write',
        params: { path: '/tmp/a.md' },
      }),
    ).toBe(false);
  });
});

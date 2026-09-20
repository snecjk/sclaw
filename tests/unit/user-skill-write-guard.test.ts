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

  it.each([
    'Set-Content -Path "C:\\Users\\demo\\skills\\foo\\SKILL.md" -Value $content -Encoding UTF8',
    '$content | Out-File .\\SKILL.md -Encoding UTF8',
    '[System.IO.File]::WriteAllText("C:\\skills-store\\foo\\SKILL.md", $content)',
    'Add-Content .\\SKILL.md $content',
  ])('blocks PowerShell skill writes: %s', (command) => {
    for (const toolName of ['exec', 'powershell', 'pwsh']) {
      expect(evaluateUserSkillWriteGuard({ toolName, params: { command } }).blocked).toBe(true);
    }
  });

  it.each([
    'Get-Content "C:\\skills\\foo\\SKILL.md"',
    'Set-Content "C:\\reports\\notes.md" -Value $content',
  ])('allows PowerShell reads and unrelated writes: %s', (command) => {
    expect(evaluateUserSkillWriteGuard({ toolName: 'powershell', params: { command } }).blocked).toBe(false);
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

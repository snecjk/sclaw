import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { expandContextIncludes } from '@electron/utils/context-fragment';
import { rmSync } from 'fs';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function makeContextRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'stoclaw-context-'));
  tempDirs.push(root);
  await mkdir(join(root, 'shared'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content, 'utf-8');
  }
  return root;
}

describe('expandContextIncludes', () => {
  it('leaves content unchanged when there is no include', async () => {
    const root = await makeContextRoot({});
    const raw = '## Hello\n\nNo include here.\n';
    await expect(expandContextIncludes(raw, root)).resolves.toBe(raw);
  });

  it('expands a shared include in place', async () => {
    const root = await makeContextRoot({
      'shared/dingtalk-policy.md': 'policy-line-1\npolicy-line-2\n',
    });
    const raw = [
      '### 钉钉 dws（办公自动化）',
      '',
      '<!-- include:shared/dingtalk-policy.md -->',
      '',
      '### Next',
      '',
    ].join('\n');

    const expanded = await expandContextIncludes(raw, root);
    expect(expanded).toBe([
      '### 钉钉 dws（办公自动化）',
      '',
      'policy-line-1',
      'policy-line-2',
      '',
      '',
      '### Next',
      '',
    ].join('\n'));
  });

  it('rejects path traversal outside shared/', async () => {
    const root = await makeContextRoot({
      'shared/dingtalk-policy.md': 'ok\n',
      'secret.md': 'nope\n',
    });
    const raw = '<!-- include:shared/../secret.md -->\n';
    await expect(expandContextIncludes(raw, root)).rejects.toThrow(/escapes shared/);
  });

  it('ignores include markers that are not under shared/', async () => {
    const root = await makeContextRoot({});
    const raw = '<!-- include:other/dingtalk-policy.md -->\n';
    await expect(expandContextIncludes(raw, root)).resolves.toBe(raw);
  });

  it('throws when the include file is missing', async () => {
    const root = await makeContextRoot({});
    const raw = '<!-- include:shared/missing.md -->\n';
    await expect(expandContextIncludes(raw, root)).rejects.toThrow(/failed to read include/);
  });

  it('expands AGENTS-style fixture to match policy body', async () => {
    const policy = [
      '**两条独立路径，互不排斥：**',
      '',
      '1. path A',
      '2. path B',
      '',
    ].join('\n');
    const root = await makeContextRoot({
      'shared/dingtalk-policy.md': policy,
    });
    const agents = [
      '## StoClaw Environment',
      '',
      '### 钉钉 dws（办公自动化）',
      '',
      '<!-- include:shared/dingtalk-policy.md -->',
      '',
    ].join('\n');

    const expanded = await expandContextIncludes(agents, root);
    expect(expanded).toContain(policy.trimEnd());
    expect(expanded).not.toContain('<!-- include:shared/dingtalk-policy.md -->');
  });

  it('expands real resources/context AGENTS and CLAUDE against shared policy', async () => {
    const { readFile } = await import('fs/promises');
    const root = join(process.cwd(), 'resources/context');
    const agents = await readFile(join(root, 'AGENTS.stoclaw.md'), 'utf-8');
    const claude = await readFile(join(root, 'CLAUDE.md'), 'utf-8');
    const tools = await readFile(join(root, 'TOOLS.stoclaw.md'), 'utf-8');

    // DingTalk L1 policy is no longer resident in bootstrap prompts.
    expect(agents).not.toContain('<!-- include:shared/dingtalk-policy.md -->');
    expect(claude).not.toContain('<!-- include:shared/dingtalk-policy.md -->');
    expect(agents).not.toContain('### 钉钉');
    expect(claude).not.toContain('### 钉钉');
    expect(tools).not.toContain('share_to_dingtalk');
    expect(tools).not.toContain('每 20 秒');

    const expandedAgents = await expandContextIncludes(agents, root);
    const expandedClaude = await expandContextIncludes(claude, root);
    expect(expandedAgents).toBe(agents);
    expect(expandedClaude).toBe(claude);
  });
});

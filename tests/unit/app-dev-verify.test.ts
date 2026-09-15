import { describe, expect, it } from 'vitest';
import {
  buildAppDevVerifyRepairPrompt,
  planAppDevVerifyScriptSteps,
  summarizeAppDevVerify,
  truncateAppDevVerifyOutput,
} from '../../shared/app-dev-verify';

describe('planAppDevVerifyScriptSteps', () => {
  it('prefers typecheck over build', () => {
    expect(planAppDevVerifyScriptSteps({
      typecheck: 'tsc -b',
      build: 'vite build',
      test: 'vitest run',
    })).toEqual([
      { name: 'typecheck', script: 'typecheck' },
      { name: 'test', script: 'test' },
    ]);
  });

  it('falls back to tsc then build', () => {
    expect(planAppDevVerifyScriptSteps({ tsc: 'tsc -b' })).toEqual([
      { name: 'typecheck', script: 'tsc' },
    ]);
    expect(planAppDevVerifyScriptSteps({ build: 'vite build', dev: 'vite' })).toEqual([
      { name: 'build', script: 'build' },
    ]);
  });

  it('returns empty when no verify scripts exist', () => {
    expect(planAppDevVerifyScriptSteps({ dev: 'vite', preview: 'vite preview' })).toEqual([]);
    expect(planAppDevVerifyScriptSteps(null)).toEqual([]);
  });
});

describe('summarizeAppDevVerify', () => {
  it('is ok when all steps pass and no preview errors', () => {
    expect(summarizeAppDevVerify({
      steps: [{ name: 'typecheck', ok: true, output: 'ok' }],
    })).toEqual({ ok: true });
  });

  it('builds a repair prompt when scripts fail', () => {
    const result = summarizeAppDevVerify({
      steps: [{ name: 'typecheck', ok: false, output: 'TS2322: bad' }],
    });
    expect(result.ok).toBe(false);
    expect(result.prompt).toContain('失败步骤：typecheck');
    expect(result.prompt).toContain('TS2322');
  });

  it('treats preview errors as failure even when scripts pass', () => {
    const result = summarizeAppDevVerify({
      steps: [{ name: 'build', ok: true }],
      previewErrors: ['TypeError: x is not a function'],
    });
    expect(result.ok).toBe(false);
    expect(result.prompt).toContain('预览/控制台报错');
    expect(result.prompt).toContain('TypeError');
  });
});

describe('buildAppDevVerifyRepairPrompt', () => {
  it('only lists failed steps', () => {
    const prompt = buildAppDevVerifyRepairPrompt({
      steps: [
        { name: 'typecheck', ok: true },
        { name: 'test', ok: false, output: '1 failed' },
      ],
    });
    expect(prompt).toContain('失败步骤：test');
    expect(prompt).not.toContain('失败步骤：typecheck');
  });
});

describe('truncateAppDevVerifyOutput', () => {
  it('keeps short output intact and trims long tails', () => {
    expect(truncateAppDevVerifyOutput('hello')).toBe('hello');
    const long = 'x'.repeat(5_000);
    const truncated = truncateAppDevVerifyOutput(long, 100);
    expect(truncated.length).toBeLessThan(long.length);
    expect(truncated).toContain('截断前部');
    expect(truncated.endsWith('x'.repeat(50)) || truncated.includes('x')).toBe(true);
  });
});

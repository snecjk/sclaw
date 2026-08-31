import { describe, expect, it } from 'vitest';
import {
  isImportedDevApp,
  canUseStoCloudPipeline,
  shouldShowGitCommitAction,
  shouldShowStoCloudActions,
} from '../../src/lib/app-dev-actions';

describe('app-dev-actions', () => {
  it('treats explicit imported source as local import', () => {
    expect(isImportedDevApp({ source: 'imported' })).toBe(true);
    expect(isImportedDevApp({ source: 'created', appCode: 'app-1' })).toBe(false);
  });

  it('falls back to missing appCode for legacy markers', () => {
    expect(isImportedDevApp({ appCode: undefined })).toBe(true);
    expect(isImportedDevApp({ appCode: 'app-1' })).toBe(false);
  });

  it('hides STO cloud actions for imported apps without cloud binding', () => {
    expect(shouldShowStoCloudActions({ source: 'imported' }, null)).toBe(false);
    expect(shouldShowStoCloudActions({ source: 'created', appCode: 'app-1' }, null)).toBe(true);
  });

  it('shows STO cloud actions when workspace is bound even if marker says imported', () => {
    expect(shouldShowStoCloudActions(
      { source: 'imported' },
      { bound: true, appCode: 'app-1' } as never,
    )).toBe(true);
  });

  it('shows git commit only for imported apps with a repo', () => {
    expect(shouldShowGitCommitAction({ source: 'imported', gitRepo: true }, true)).toBe(true);
    expect(shouldShowGitCommitAction({ source: 'imported', gitRepo: false }, true)).toBe(false);
    expect(shouldShowGitCommitAction({ source: 'created', appCode: 'app-1', gitRepo: true }, true)).toBe(false);
    expect(shouldShowGitCommitAction({ source: 'imported', gitRepo: true }, false)).toBe(false);
  });

  it('does not show git commit when STO cloud actions are active', () => {
    expect(shouldShowGitCommitAction(
      { source: 'imported', gitRepo: true },
      true,
      { bound: true, appCode: 'app-1' } as never,
    )).toBe(false);
  });

  it('allows cloud pipeline before first cloud registration', () => {
    expect(canUseStoCloudPipeline(
      { source: 'created' },
      { available: true, bound: false, syncLabel: '待首次提交' } as never,
    )).toBe(true);
    expect(canUseStoCloudPipeline(
      { source: 'imported' },
      { available: true, bound: false } as never,
    )).toBe(false);
    expect(canUseStoCloudPipeline(
      { source: 'created' },
      { available: false, bound: false } as never,
    )).toBe(false);
  });
});

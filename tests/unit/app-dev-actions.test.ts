import { describe, expect, it } from 'vitest';
import {
  isImportedDevApp,
  shouldShowGitCommitAction,
  shouldShowStoCloudActions,
} from '../../src/lib/app-dev-actions';

describe('app-dev-actions', () => {
  it('treats explicit imported source as local import', () => {
    expect(isImportedDevApp({ source: 'imported' })).toBe(true);
    expect(isImportedDevApp({ source: 'created', applicationId: 'app-1' })).toBe(false);
  });

  it('falls back to missing applicationId for legacy markers', () => {
    expect(isImportedDevApp({ applicationId: undefined })).toBe(true);
    expect(isImportedDevApp({ applicationId: 'app-1' })).toBe(false);
  });

  it('hides STO cloud actions for imported apps without cloud binding', () => {
    expect(shouldShowStoCloudActions({ source: 'imported' }, null)).toBe(false);
    expect(shouldShowStoCloudActions({ source: 'created', applicationId: 'app-1' }, null)).toBe(true);
  });

  it('shows STO cloud actions when workspace is bound even if marker says imported', () => {
    expect(shouldShowStoCloudActions(
      { source: 'imported' },
      { bound: true, applicationId: 'app-1' } as never,
    )).toBe(true);
  });

  it('shows git commit only for imported apps with a repo', () => {
    expect(shouldShowGitCommitAction({ source: 'imported', gitRepo: true }, true)).toBe(true);
    expect(shouldShowGitCommitAction({ source: 'imported', gitRepo: false }, true)).toBe(false);
    expect(shouldShowGitCommitAction({ source: 'created', applicationId: 'app-1', gitRepo: true }, true)).toBe(false);
    expect(shouldShowGitCommitAction({ source: 'imported', gitRepo: true }, false)).toBe(false);
  });

  it('does not show git commit when STO cloud actions are active', () => {
    expect(shouldShowGitCommitAction(
      { source: 'imported', gitRepo: true },
      true,
      { bound: true, applicationId: 'app-1' } as never,
    )).toBe(false);
  });
});

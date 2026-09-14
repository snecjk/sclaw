import { describe, expect, it } from 'vitest';
import {
  classifyFileMerge,
  hasConflictMarkers,
  mergeTextThreeWay,
  pullToastMessage,
} from '../../shared/site-app-source-merge';

describe('site-app source merge', () => {
  it('auto-merges non-overlapping text edits', () => {
    const base = 'line1\nline2\nline3\n';
    const ours = 'line1\nline2-local\nline3\n';
    const theirs = 'line1\nline2\nline3-remote\n';
    const merged = mergeTextThreeWay(base, ours, theirs);
    expect(merged.conflicted).toBe(false);
    expect(merged.text).toContain('line2-local');
    expect(merged.text).toContain('line3-remote');
  });

  it('marks overlapping edits as conflict text', () => {
    const base = 'alpha\nbeta\n';
    const ours = 'alpha\nbeta-local\n';
    const theirs = 'alpha\nbeta-remote\n';
    const merged = mergeTextThreeWay(base, ours, theirs);
    expect(merged.conflicted).toBe(true);
    expect(hasConflictMarkers(merged.text)).toBe(true);
    expect(merged.text).toContain('beta-local');
    expect(merged.text).toContain('beta-remote');
  });

  it('classifies one-sided file changes', () => {
    expect(classifyFileMerge({
      path: 'src/a.ts',
      base: Buffer.from('base'),
      ours: Buffer.from('local'),
      theirs: Buffer.from('base'),
    }).action).toBe('keep-ours');

    expect(classifyFileMerge({
      path: 'src/b.ts',
      base: Buffer.from('base'),
      ours: Buffer.from('base'),
      theirs: Buffer.from('remote'),
    }).action).toBe('take-theirs');
  });

  it('maps pull actions to user-facing toast text', () => {
    expect(pullToastMessage('merged').text).toContain('合并');
    expect(pullToastMessage('conflicts', 2).kind).toBe('message');
  });
});

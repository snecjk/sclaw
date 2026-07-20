import { describe, expect, it } from 'vitest';
import {
  appendGroupExpanded,
  areAllExpandableGroupsExpanded,
  collapseAllGroups,
  expandAllGroups,
  toggleGroupExpanded,
} from '@/lib/sidebar-section-group-expand';

describe('sidebar-section-group-expand', () => {
  it('expands all groups', () => {
    expect(expandAllGroups(['a', 'b'])).toEqual({ a: true, b: true });
  });

  it('collapses all groups', () => {
    expect(collapseAllGroups(['a', 'b'])).toEqual({ a: false, b: false });
  });

  it('detects all expandable groups expanded', () => {
    expect(areAllExpandableGroupsExpanded({ a: true, b: true }, ['a', 'b'])).toBe(true);
  });

  it('detects all collapsed as not all expanded', () => {
    expect(areAllExpandableGroupsExpanded({ a: false, b: false }, ['a', 'b'])).toBe(false);
    expect(areAllExpandableGroupsExpanded({}, ['a', 'b'])).toBe(false);
  });

  it('detects partial expansion as not all expanded', () => {
    expect(areAllExpandableGroupsExpanded({ a: true, b: false }, ['a', 'b'])).toBe(false);
    expect(areAllExpandableGroupsExpanded({ a: true }, ['a', 'b'])).toBe(false);
  });

  it('returns false for empty expandable id list', () => {
    expect(areAllExpandableGroupsExpanded({ a: true }, [])).toBe(false);
  });

  it('toggles one group without closing others', () => {
    let map = { a: true, b: true };
    map = toggleGroupExpanded(map, 'a');
    expect(map).toEqual({ a: false, b: true });
    map = toggleGroupExpanded(map, 'c');
    expect(map).toEqual({ a: false, b: true, c: true });
  });

  it('appends auto-focus group without replacing others', () => {
    expect(appendGroupExpanded({ a: true }, 'b')).toEqual({ a: true, b: true });
    expect(appendGroupExpanded({ a: true }, 'a')).toEqual({ a: true });
  });
});

import { describe, expect, it } from 'vitest';
import { isEmptyFormValue } from '@/lib/workflow-form-utils';

describe('isEmptyFormValue', () => {
  it('treats undefined, null, and blank strings as empty', () => {
    expect(isEmptyFormValue(undefined)).toBe(true);
    expect(isEmptyFormValue(null)).toBe(true);
    expect(isEmptyFormValue('')).toBe(true);
    expect(isEmptyFormValue('   ')).toBe(true);
  });

  it('treats empty arrays and JSON stringified empty arrays as empty', () => {
    expect(isEmptyFormValue([])).toBe(true);
    expect(isEmptyFormValue('[]')).toBe(true);
    expect(isEmptyFormValue(' [] ')).toBe(true);
  });

  it('treats empty objects and JSON stringified empty objects as empty', () => {
    expect(isEmptyFormValue({})).toBe(true);
    expect(isEmptyFormValue('{}')).toBe(true);
    expect(isEmptyFormValue(' {} ')).toBe(true);
  });

  it('does not treat meaningful values as empty', () => {
    expect(isEmptyFormValue(['a'])).toBe(false);
    expect(isEmptyFormValue('["a"]')).toBe(false);
    expect(isEmptyFormValue({ key: 'value' })).toBe(false);
    expect(isEmptyFormValue('{"key":"value"}')).toBe(false);
    expect(isEmptyFormValue(0)).toBe(false);
    expect(isEmptyFormValue(false)).toBe(false);
    expect(isEmptyFormValue('option-a')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseFlowCardProgressSteps,
  parseFlowCardValidationOutcome,
  resolveGatedProgressStatuses,
} from '@/lib/flow-card-progress';

describe('flow-card-progress', () => {
  it('parses progressSteps from card data', () => {
    const steps = parseFlowCardProgressSteps({
      progressSteps: [
        { id: 'objects', title: '识别报价对象', detail: '从报价表匹配客户等对象' },
        { title: '流向重量段识别' },
      ],
    });
    expect(steps).toHaveLength(2);
    expect(steps[0]?.id).toBe('objects');
    expect(steps[1]?.id).toBe('step-2');
  });

  it('holds on first step before outcome', () => {
    expect(resolveGatedProgressStatuses(3, null, null)).toEqual([
      'active',
      'pending',
      'pending',
    ]);
  });

  it('finishes all steps after pass outcome', () => {
    expect(resolveGatedProgressStatuses(3, 'pass', null)).toEqual([
      'done',
      'done',
      'done',
    ]);
  });

  it('marks last step error after fail outcome', () => {
    expect(resolveGatedProgressStatuses(3, 'fail', null)).toEqual([
      'done',
      'done',
      'error',
    ]);
    expect(parseFlowCardValidationOutcome({ validationOutcome: 'fail' })).toBe('fail');
  });
});

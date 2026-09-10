import { describe, expect, it } from 'vitest';
import { isAppDevFullstackCreateEnabled } from '../../src/lib/app-dev-fullstack-create';

describe('app-dev fullstack create', () => {
  it('is closed in every environment, including development', () => {
    expect(isAppDevFullstackCreateEnabled()).toBe(false);
  });
});

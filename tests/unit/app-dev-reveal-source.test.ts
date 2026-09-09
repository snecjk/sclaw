import { describe, expect, it } from 'vitest';
import { toAppDevSourceRelativePath } from '@/lib/app-dev-reveal-source';

describe('toAppDevSourceRelativePath', () => {
  it('keeps workspace-relative paths', () => {
    expect(toAppDevSourceRelativePath('src/components/ProductCard.tsx')).toBe(
      'src/components/ProductCard.tsx',
    );
    expect(toAppDevSourceRelativePath('./frontend/src/App.tsx')).toBe('frontend/src/App.tsx');
  });

  it('strips sandbox roots and keeps source folders', () => {
    expect(toAppDevSourceRelativePath('/app/src/components/ProductCard.tsx')).toBe(
      'src/components/ProductCard.tsx',
    );
    expect(toAppDevSourceRelativePath('/app/new.ts')).toBe('new.ts');
    expect(toAppDevSourceRelativePath('/tmp/frontend/src/App.tsx')).toBe('frontend/src/App.tsx');
  });
});

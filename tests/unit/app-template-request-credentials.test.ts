import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEMPLATE_NAMES = ['site-minimal', 'site-fullstack', 'assets-minimal'];

describe('app template request credentials', () => {
  it.each(TEMPLATE_NAMES)('%s 在 withCredentials=false 时完全不发送 Cookie', (templateName) => {
    const source = readFileSync(
      resolve(`resources/app-templates/${templateName}/src/lib/request.ts`),
      'utf8',
    );

    expect(source).toContain("credentials: withCredentials ? 'include' : 'omit'");
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('assets iframe analysis template', () => {
  it('does not require applicationId for the iframe identity bridge', () => {
    const bridge = readFileSync(join(
      process.cwd(),
      'resources/app-templates/assets-iframe-analysis/src/sclaw/iframe-token-bridge.ts',
    ), 'utf8');

    expect(bridge).not.toContain('applicationId');
    expect(bridge).not.toContain('getIframeApplicationId');
  });

  it('ships an install config that hoists UI-library transitive dependencies', () => {
    const npmrc = readFileSync(join(
      process.cwd(),
      'resources/app-templates/assets-iframe-analysis/.npmrc',
    ), 'utf8');

    expect(npmrc).toContain('shamefully-hoist=true');
  });
});

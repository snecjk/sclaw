import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppDevSetupProgress } from '@/components/app-dev/AppDevSetupProgress';

const INSTALL_LOG = [
  'npm warn Unknown env config "verify-deps-before-run". This will stop working in the next major version of npm.',
  'npm warn EBADENGINE Unsupported engine {',
  "npm warn EBADENGINE   package: 'rollup-linux-arm-gnueabihf@4.62.2',",
  "(Use 'node --trace-deprecation ...' to show where the warning was created)",
].join('\n');

describe('AppDevSetupProgress step log', () => {
  it('nests a 5-line command log under the active step', () => {
    const { container } = render(
      <AppDevSetupProgress
        phase="installing"
        progress={42}
        detail="正在执行 snpm install"
        log={INSTALL_LOG}
      />,
    );

    expect(screen.getByText('执行依赖')).toBeInTheDocument();
    const log = container.querySelector('ol pre');
    expect(log?.textContent).toContain('npm warn EBADENGINE Unsupported engine {');
    expect(log?.className).toContain('max-h-[6.25rem]');
    expect(screen.queryByRole('button', { name: '展开日志' })).not.toBeInTheDocument();
  });

  it('does not keep a separate log well below the steps', () => {
    const { container } = render(
      <AppDevSetupProgress
        phase="installing"
        progress={42}
        log={INSTALL_LOG}
      />,
    );
    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(container.querySelector('ol pre')).toBeTruthy();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeployResourceList } from '@/components/app-dev/DeployResourceList';

describe('DeployResourceList', () => {
  it('groups entry page first and exposes accessible actions', () => {
    const onCopy = vi.fn();
    const onOpen = vi.fn();
    render(<DeployResourceList
      pages={[
        { url: 'https://a.test/main.js', fileName: 'main.js', entry: false, available: true },
        { url: 'https://a.test/index.html', fileName: 'index.html', entry: true, available: true },
      ]}
      onCopy={onCopy}
      onOpen={onOpen}
    />);
    expect(screen.getAllByTestId('deploy-resource-row').map((node) => node.textContent)).toEqual([
      expect.stringContaining('index.html'),
      expect.stringContaining('main.js'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '复制 index.html' }));
    fireEvent.click(screen.getByRole('button', { name: '打开 index.html' }));
    expect(onCopy).toHaveBeenCalledWith('https://a.test/index.html');
    expect(onOpen).toHaveBeenCalledWith('https://a.test/index.html');
  });

  it('shows pending and empty states', () => {
    const { rerender } = render(<DeployResourceList
      pages={[{ url: 'https://a.test/index.html', fileName: 'index.html', entry: true, available: false }]}
      onCopy={vi.fn()}
      onOpen={vi.fn()}
    />);
    expect(screen.getByText('生成中')).toBeInTheDocument();
    rerender(<DeployResourceList pages={[]} onCopy={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('暂未生成产物')).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDevElementIntentBar } from '@/components/app-dev/AppDevElementIntentBar';
import { AppDevElementIntentCard } from '@/components/app-dev/AppDevElementIntentCard';

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

const ELEMENTS = [
  { selector: 'h1.hero', tag: 'h1', text: '山丘咖啡' },
  { selector: 'button.cta', tag: 'button', text: '探索产品' },
];

describe('AppDevElementIntentBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits on Enter without requiring a click on 发送', () => {
    const onSubmit = vi.fn();
    render(
      <div style={{ position: 'relative', width: 800, height: 400 }}>
        <AppDevElementIntentBar
          elements={ELEMENTS}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      </div>,
    );

    const input = screen.getByLabelText('选中区域修改意图');
    fireEvent.change(input, { target: { value: '字体颜色改成红色' } });
    fireEvent.submit(input.closest('form')!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe('字体颜色改成红色');
    expect(onSubmit.mock.calls[0][1]).toEqual(ELEMENTS);
  });

  it('does not submit an empty intent', () => {
    const onSubmit = vi.fn();
    render(
      <AppDevElementIntentBar
        elements={ELEMENTS}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.submit(screen.getByLabelText('选中区域修改意图').closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('AppDevElementIntentCard', () => {
  it('renders a collapsed page-element summary', () => {
    render(<AppDevElementIntentCard elements={ELEMENTS} />);
    expect(screen.getByTestId('app-dev-element-intent-card')).toHaveTextContent('包含 2 个页面元素');
    expect(screen.queryByText('h1 · “山丘咖啡”')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /包含 2 个页面元素/ }));
    expect(screen.getByText('h1 · “山丘咖啡”')).toBeInTheDocument();
    expect(screen.getByText('h1.hero')).toBeInTheDocument();
  });
});

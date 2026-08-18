/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SidebarTimerIcon } from '@/components/layout/sidebar-timer-icon';

describe('SidebarTimerIcon', () => {
  it('inlines the timer svg instead of a css mask box', () => {
    const { container } = render(<SidebarTimerIcon />);
    const root = container.firstElementChild;
    const svg = container.querySelector('svg');
    const maskBox = container.querySelector('[class*="mask-image"]');

    expect(svg).not.toBeNull();
    expect(maskBox).toBeNull();
    expect(svg?.innerHTML).toContain('currentColor');
    expect(svg?.innerHTML).not.toContain('#393E47');
    // 不跟 NavLink 正文色；由父级 [&_svg]:text-* 注入 icon token
    expect(root?.className).not.toContain('text-current');
    expect(root?.className).toContain('[&_svg_path]:stroke-none');
  });
});

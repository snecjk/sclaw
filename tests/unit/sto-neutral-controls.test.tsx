import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  StoIconSurface,
  StoOutlineButton,
  StoSearchField,
  StoSegmentTabs,
} from '@/components/ui/sto-neutral-controls';
import { NewTaskDropdownButton } from '@/pages/MyTask/components/NewTaskDropdownButton';
import { SectionTabs } from '@/pages/MyTask/components/SectionTabs';
import { SkillIcon } from '@/components/skill-plaza/SkillIcon';

describe('neutral presentational controls', () => {
  it('reports controlled search changes to its owner', () => {
    const onValueChange = vi.fn();

    render(
      <StoSearchField
        value=""
        onValueChange={onValueChange}
        placeholder="搜索技能"
      />,
    );

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pdf' } });
    expect(onValueChange).toHaveBeenCalledWith('pdf');
  });

  it('reports tab changes to its owner with accessible tab semantics', () => {
    const onValueChange = vi.fn();

    render(
      <StoSegmentTabs
        value="skills"
        ariaLabel="分区"
        items={[
          { value: 'skills', label: '技能' },
          { value: 'connectors', label: '连接器' },
        ]}
        onValueChange={onValueChange}
      />,
    );

    expect(screen.getByRole('tablist', { name: '分区' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '技能' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: '连接器' }));
    expect(onValueChange).toHaveBeenCalledWith('connectors');
  });

  it('maps outline controls through the shared neutral surface', () => {
    render(<StoOutlineButton>上传技能</StoOutlineButton>);

    const button = screen.getByRole('button', { name: '上传技能' });
    expect(button.className).toContain('h-9');
    expect(button).toHaveClass('sto-control', 'sto-control--outline');
    expect(button.className).not.toContain('dark:bg-');
  });

  it('forwards standard button props and permits page-owned size overrides', () => {
    const onClick = vi.fn();

    render(
      <StoOutlineButton
        aria-label="新建定时任务"
        className="h-[34px]"
        disabled
        onClick={onClick}
      />,
    );

    const button = screen.getByRole('button', { name: '新建定时任务' });
    expect(button).toBeDisabled();
    expect(button.className).toContain('h-[34px]');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders an overridable neutral icon surface without owning behavior', () => {
    render(
      <StoIconSurface className="h-10 w-10" data-testid="icon-surface">
        icon
      </StoIconSurface>,
    );

    const surface = screen.getByTestId('icon-surface');
    expect(surface).toHaveTextContent('icon');
    expect(surface.className).toContain('h-10');
    expect(surface).toHaveClass('sto-control', 'sto-control--outline');
    expect(surface.className).not.toContain('dark:bg-');
  });

  it('keeps My Tasks controls at 34px while consuming the shared defaults', () => {
    render(
      <NewTaskDropdownButton onSelfCreate={vi.fn()} onTemplateCreate={vi.fn()} />,
    );

    const button = screen.getByRole('button');
    expect(button.className).toContain('h-[34px]');
    expect(button.className).not.toContain('h-9');
  });

  it('places My Tasks tab semantics on the shared neutral track', () => {
    render(<SectionTabs activeSection="tasks" onSectionChange={vi.fn()} />);

    const tablist = screen.getByRole('tablist');
    expect(tablist).toHaveClass('sto-segment-track');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('sto-segment-item');
    }
  });

  it('uses the shared neutral surface for the Skill Plaza fallback icon', () => {
    const { container } = render(<SkillIcon />);

    const fallback = container.querySelector('img');
    if (!fallback) throw new Error('Expected fallback icon');
    expect(fallback.parentElement).toHaveClass('sto-control', 'sto-control--outline');
    expect(fallback.parentElement?.className).not.toContain('dark:bg-');
    expect(fallback.className).toContain('dark:invert');
  });
});

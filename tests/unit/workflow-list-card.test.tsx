import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowOfficialListCard } from '@/pages/Workflow/components/workflow-list-card';
import type { OfficialWorkflowCard } from '@/pages/Workflow/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'card.createFromTemplate') return '依此模板创建';
      if (key === 'card.install') return '安装';
      if (key === 'card.goCreate') return '安装';
      return key;
    },
  }),
}));

const officialCard: OfficialWorkflowCard = {
  id: 'tpl-settlement',
  name: '结算对账流程',
  category: '通用',
  schedule: '',
  scheduleIcon: 'clock',
  description: '制作一份结算对账报表',
  flow: [],
  coverKey: 'cover-1',
};

describe('WorkflowOfficialListCard', () => {
  it('hides create-from-template action in official recommendations', () => {
    render(
      <WorkflowOfficialListCard
        card={officialCard}
        onInstall={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '依此模板创建' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安装' })).toBeInTheDocument();
  });

  it('opens from a keyboard-safe sibling overlay action', () => {
    const onCardClick = vi.fn();
    render(
      <WorkflowOfficialListCard
        card={officialCard}
        onCardClick={onCardClick}
        onInstall={vi.fn()}
      />,
    );

    const action = screen.getByRole('button', { name: '打开结算对账流程' });
    action.focus();
    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.keyUp(action, { key: 'Enter' });
    fireEvent.click(action);

    expect(onCardClick).toHaveBeenCalledOnce();
  });

  it('keeps the install control isolated from the card action', () => {
    const onCardClick = vi.fn();
    const onInstall = vi.fn();
    render(
      <WorkflowOfficialListCard
        card={officialCard}
        onCardClick={onCardClick}
        onInstall={onInstall}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '安装' }));

    expect(onInstall).toHaveBeenCalledOnce();
    expect(onCardClick).not.toHaveBeenCalled();
  });
});

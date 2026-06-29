import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowOfficialListCard } from '@/pages/Workflow/components/workflow-list-card';
import type { OfficialWorkflowCard } from '@/pages/Workflow/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'card.createFromTemplate') return '依此模板创建';
      if (key === 'card.install') return '安装';
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
});

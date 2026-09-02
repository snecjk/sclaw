import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FlowCard } from '@/components/flow-card/FlowCard';
import { createFlowCardBlock } from '../../shared/flow-card-protocol';

describe('FlowCard dark appearance', () => {
  it('uses the neutral dark surface and readable text for the quote upload card', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-upload',
      domain: 'quote',
      phase: 'awaiting_upload',
      title: '好的，开始**新建报价**。',
      body: '请点击下方按钮上传报价表。',
      hint: '选择文件后将直接发送并开始解析',
      actions: [
        {
          id: 'open-history',
          label: '历史报价',
          variant: 'secondary',
          kind: 'chat.sendMessage',
        },
        {
          id: 'upload',
          label: '上传报价表',
          kind: 'composer.openFilePicker',
        },
      ],
    });

    const { container } = render(<FlowCard card={card} />);
    const root = container.querySelector('[data-flow-card-id="quote-upload"]');

    expect(root).toHaveClass(
      'dark:border-[var(--sto-border-default)]',
      'dark:bg-[var(--sto-surface-secondary)]',
      'dark:text-[var(--sto-text-primary)]',
    );
    expect(screen.getByText('请点击下方按钮上传报价表。').closest('p')).toHaveClass(
      'dark:text-[var(--sto-text-primary)]',
    );
    expect(screen.getByText('选择文件后将直接发送并开始解析').closest('p')).toHaveClass(
      'dark:text-[var(--sto-text-tertiary)]',
    );
    expect(screen.getByText('新建报价')).toHaveClass('dark:text-[var(--sto-text-primary)]');
    expect(screen.getByRole('button', { name: '历史报价' })).toHaveClass(
      'dark:border-[var(--sto-border-default)]',
      'dark:bg-[var(--sto-control-bg)]',
      'dark:text-[var(--sto-text-primary)]',
    );
    expect(screen.getByRole('button', { name: '上传报价表' })).toHaveClass(
      'dark:border-[var(--sto-dialog-action-background)]',
      'dark:bg-[var(--sto-dialog-action-background)]',
      'dark:text-[var(--sto-dialog-action-foreground)]',
      'dark:shadow-none',
    );
  });

  it('uses a translucent error overlay that lets the dark surface show through', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-errors',
      phase: 'errors',
      title: '报价表校验未通过',
      body: '请修正后重新上传。',
      data: { errorCount: 2 },
    });

    const { container } = render(<FlowCard card={card} />);
    const root = container.querySelector('[data-flow-card-id="quote-errors"]');

    expect(root).toHaveClass(
      'dark:border-[var(--sto-toast-error-border)]',
      'dark:bg-destructive/5',
    );
    expect(screen.getByText(/2\s+处待修正/)).toHaveClass(
      'dark:text-[var(--sto-toast-error-icon)]',
    );
  });

  it('uses readable semantic text for validation progress in dark appearance', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-validating',
      phase: 'validating',
      title: '正在解析报价表',
      data: {
        progressSteps: [
          { id: 'objects', title: '识别报价对象', detail: '匹配报价对象' },
          { id: 'routes', title: '识别流向', detail: '等待前一步完成' },
        ],
      },
    });

    render(<FlowCard card={card} />);

    expect(screen.getByText('正在解析报价表…').closest('div')).toHaveClass(
      'dark:text-[var(--sto-text-primary)]',
    );
    expect(screen.getByText('识别流向')).toHaveClass('dark:text-[var(--sto-text-tertiary)]');
    expect(screen.getByText('等待前一步完成')).toHaveClass('dark:text-[var(--sto-text-tertiary)]');
  });
});

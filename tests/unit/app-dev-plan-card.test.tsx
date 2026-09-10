import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppDevPlanCard } from '@/components/app-dev/AppDevPlanCard';
import type { AppDevPlanDocument } from '@/lib/app-dev-plan-gate';

const PLAN: AppDevPlanDocument = {
  summary: '在现有 Site 中新增客户出港损益报告页。',
  overview: '很长的实现细节、色值和模板版本不应该铺满确认卡。',
  audience: '网点经营者',
  scenarios: '按期间查看损益',
  steps: [
    { id: '1', title: '注册路由与菜单项' },
    { id: '2', title: '定义数据契约与类型' },
    { id: '3', title: '数据加载层与内置样例数据' },
    { id: '4', title: '页面骨架' },
    { id: '5', title: '矩阵表格' },
    { id: '6', title: '导出明细' },
    { id: '7', title: '缺数提示' },
  ],
};

describe('AppDevPlanCard', () => {
  it('shows a single confirm screen instead of a 3-step wizard', () => {
    render(<AppDevPlanCard plan={PLAN} onConfirm={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByTestId('app-dev-plan-card')).toBeInTheDocument();
    expect(screen.getByText('方案待确认')).toBeInTheDocument();
    expect(screen.getByText('在现有 Site 中新增客户出港损益报告页。')).toBeInTheDocument();
    expect(screen.getByText('注册路由与菜单项')).toBeInTheDocument();
    expect(screen.getByText('还有 1 步，确认后按完整方案执行')).toBeInTheDocument();

    expect(screen.queryByText('1/3')).not.toBeInTheDocument();
    expect(screen.queryByText('确认需求方案')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一步' })).not.toBeInTheDocument();
    expect(screen.queryByText('应用概述')).not.toBeInTheDocument();
    expect(screen.queryByText('目标用户')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/很长的实现细节/)).not.toBeInTheDocument();
  });

  it('confirms the original plan with the selected style', () => {
    const onConfirm = vi.fn();
    render(<AppDevPlanCard plan={PLAN} onConfirm={onConfirm} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '深色高级' }));
    fireEvent.click(screen.getByRole('button', { name: /确认开始/ }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [nextPlan, style] = onConfirm.mock.calls[0];
    expect(nextPlan).toBe(PLAN);
    expect(style).toMatchObject({ id: 'dark-premium', name: '深色高级' });
  });

  it('dismisses without confirming', () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(<AppDevPlanCard plan={PLAN} onConfirm={onConfirm} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: '忽略方案' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

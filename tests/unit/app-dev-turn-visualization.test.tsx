import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolStatus } from '@/stores/chat';
import { AppDevToolRollupLine } from '@/components/app-dev/AppDevToolRollupLine';
import { AppDevTodoCapsule } from '@/components/app-dev/AppDevTodoCapsule';
import { AppDevTurnSummaryCard } from '@/components/app-dev/AppDevTurnSummaryCard';
import { rollupAppDevTools } from '@/lib/app-dev-tool-rollup';
import { deriveAppDevTurnPlan } from '@/lib/app-dev-turn-plan';
import type { ChatDisplayItem } from '@/pages/Chat/chat-display';

vi.mock('@/pages/Chat/AssistantTurnMessage', () => ({
  AssistantTurnMessage: () => <div data-testid="assistant-turn-message" />,
}));
vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: () => <div data-testid="chat-message" />,
}));
// react-virtual 在测试环境会解析到第二个 React 副本（pnpm 虚拟目录），直接 mock 掉
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

function makeTool(partial: Partial<ToolStatus> & { name: string }): ToolStatus {
  return { status: 'completed', updatedAt: 1_000, ...partial };
}

describe('AppDevToolRollupLine 流式摘要行', () => {
  it('渲染编辑/创建/执行行，增删红绿着色', () => {
    const rollup = rollupAppDevTools([
      makeTool({
        name: 'Edit',
        input: { file_path: '/app/src/pages/home.page.json', old_string: 'a\nb', new_string: 'a\nx\ny' },
      }),
      makeTool({ name: 'Write', input: { file_path: '/app/new.ts', content: '1\n2' } }),
      makeTool({ name: 'Bash', input: { command: 'pnpm run build' } }),
    ]);
    render(<AppDevToolRollupLine rollup={rollup} />);

    const root = screen.getByTestId('app-dev-tool-rollup');
    expect(root).toHaveTextContent('编辑');
    expect(root).toHaveTextContent('home.page.json');
    expect(root).toHaveTextContent('创建');
    expect(root).toHaveTextContent('new.ts');
    expect(root).toHaveTextContent('执行');
    expect(root).toHaveTextContent('pnpm run build');

    const added = screen.getAllByText('+2');
    expect(added.length).toBe(2);
    expect(added[0]).toHaveClass('text-[var(--sto-success-primary)]');
    const removed = screen.getByText('−1');
    expect(removed).toHaveClass('text-[var(--sto-danger-primary)]');
  });

  it('空聚合不渲染', () => {
    const { container } = render(<AppDevToolRollupLine rollup={rollupAppDevTools([])} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AppDevTodoCapsule 待办胶囊', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const plan = deriveAppDevTurnPlan({
    texts: ['1. 修改标题颜色\n2. 调整字号\n3. 构建验证', '接下来调整字号大小。', '正在修改标题颜色。'],
    tools: [],
    sending: true,
  });

  it('显示当前任务与 x/N，点击展开三态清单', () => {
    render(<AppDevTodoCapsule plan={plan} sending />);
    const capsule = screen.getByTestId('app-dev-todo-capsule');
    // 两条叙述 → 第 2 项 active、第 1 项 done、第 3 项 pending
    expect(capsule).toHaveTextContent('1/3');
    expect(capsule).toHaveTextContent('调整字号');

    fireEvent.click(screen.getByRole('button'));
    const list = screen.getByTestId('app-dev-todo-capsule-list');
    expect(list).toHaveTextContent('修改标题颜色');
    expect(list).toHaveTextContent('调整字号');
    expect(list).toHaveTextContent('构建验证');
  });

  it('轮结束 600ms 后淡出', () => {
    const donePlan = deriveAppDevTurnPlan({ texts: ['完成任务。'], tools: [], sending: false });
    render(<AppDevTodoCapsule plan={donePlan} sending={false} />);
    expect(screen.getByTestId('app-dev-todo-capsule')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.queryByTestId('app-dev-todo-capsule')).not.toBeInTheDocument();
  });

  it('空计划不渲染', () => {
    const { container } = render(
      <AppDevTodoCapsule plan={deriveAppDevTurnPlan({ texts: [], tools: [], sending: true })} sending />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AppDevTurnSummaryCard 轮次汇总卡', () => {
  const tools: ToolStatus[] = [
    makeTool({
      name: 'Edit',
      toolCallId: 't1',
      durationMs: 3_000,
      input: { file_path: '/app/home.page.json', old_string: 'a\nb', new_string: 'a\nx\ny' },
    }),
    makeTool({ name: 'Bash', toolCallId: 't2', durationMs: 21_000, input: { command: 'pnpm run build' } }),
  ];

  it('显示「已处理 N 个任务 · 耗时 Xs」，展开逐任务明细', () => {
    render(<AppDevTurnSummaryCard tools={tools} durationMs={24_000} />);
    const card = screen.getByTestId('app-dev-turn-summary');
    expect(card).toHaveTextContent('已处理 2 个任务');
    expect(card).toHaveTextContent('耗时 24s');

    fireEvent.click(screen.getByRole('button', { name: '展开明细' }));
    const details = screen.getByTestId('app-dev-turn-summary-details');
    expect(details).toHaveTextContent('编辑 home.page.json');
    expect(details).toHaveTextContent('+2');
    expect(details).toHaveTextContent('−1');
    expect(details).toHaveTextContent('执行 pnpm run build');
    expect(details).toHaveTextContent('21s');
  });

  it('中断时显示「已中断 · 已完成 N 个任务」', () => {
    render(<AppDevTurnSummaryCard tools={tools.slice(0, 1)} durationMs={null} interrupted />);
    expect(screen.getByTestId('app-dev-turn-summary')).toHaveTextContent('已中断 · 已完成 1 个任务');
  });

  it('T04 挂载点：actions 渲染在卡片头部', () => {
    render(
      <AppDevTurnSummaryCard
        tools={tools}
        durationMs={null}
        actions={<button type="button">恢复版本</button>}
      />,
    );
    expect(screen.getByRole('button', { name: '恢复版本' })).toBeInTheDocument();
  });

  it('无 completed 工具且未中断时不渲染', () => {
    const { container } = render(<AppDevTurnSummaryCard tools={[]} durationMs={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ChatStaticItemsList renderTurnFooter 注入点', () => {
  it('assistant-turn 之后渲染 footer，缺省不渲染', async () => {
    const { ChatStaticItemsList } = await import('@/components/chat/ChatStaticItemsList');
    const userMessage = { id: 'u1', role: 'user', content: '改个颜色' } as never;
    const items: ChatDisplayItem[] = [
      { type: 'single', message: userMessage, key: 'u1' },
      {
        type: 'assistant-turn',
        messages: [
          { id: 'a1', role: 'assistant', content: '好的' } as never,
          { id: 'a2', role: 'assistant', content: '已完成' } as never,
        ],
        toolResults: [],
        precedingUserMessage: userMessage,
        key: 'turn-user-u1',
      },
    ];
    const scrollRef = createRef<HTMLDivElement>();
    const renderTurnFooter = vi.fn((item: ChatDisplayItem) =>
      item.type === 'assistant-turn' ? <div data-testid="turn-footer">{item.key}</div> : null);

    const { rerender } = render(
      <ChatStaticItemsList
        items={items}
        messages={[userMessage]}
        showThinking={false}
        scrollRef={scrollRef}
        variant="home"
        renderTurnFooter={renderTurnFooter}
      />,
    );
    expect(screen.getByTestId('turn-footer')).toHaveTextContent('turn-user-u1');
    expect(renderTurnFooter).toHaveBeenCalledTimes(1);

    rerender(
      <ChatStaticItemsList
        items={items}
        messages={[userMessage]}
        showThinking={false}
        scrollRef={scrollRef}
        variant="home"
      />,
    );
    expect(screen.queryByTestId('turn-footer')).not.toBeInTheDocument();
  });
});

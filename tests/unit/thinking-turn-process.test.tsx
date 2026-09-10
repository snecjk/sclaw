import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThinkingTurnSegment } from '@/pages/Chat/thinking-turn-segments';

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'streaming.collapsedSummaryThoughtsOnly') return `思考 ${opts?.thoughtCount} 次`;
      if (key === 'streaming.collapsedSummaryToolsOnly') return `使用 ${opts?.toolCount} 个工具`;
      if (key === 'streaming.collapsedSummary') {
        return `思考 ${opts?.thoughtCount} 次，使用 ${opts?.toolCount} 个工具`;
      }
      if (key === 'streaming.deepThinkingLabel') return '深度思考';
      if (key === 'streaming.omittedEarlierThinkingChars') return `已省略前 ${opts?.count} 字`;
      if (key === 'streaming.invokeToolLabel') return `调用工具-${opts?.toolName}`;
      if (key === 'streaming.liveCurrentThinking') return '正在思考';
      if (key === 'streaming.liveCallingTool') return '正在调用工具';
      if (key === 'streaming.thinkingBadge') return 'AI 正在思考';
      if (key === 'streaming.toolNoParams') return '无参数';
      if (key === 'streaming.interrupted') return '已中断';
      return key;
    },
  }),
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: (selector: (state: { skills: [] }) => unknown) => selector({ skills: [] }),
}));

import { ThinkingTurnProcess } from '@/pages/Chat/thinking/thinking-turn-process';

// jsdom 未实现 scrollIntoView（useProcessBlockCollapse 展开时调用）
Element.prototype.scrollIntoView = vi.fn();

function completedThinkingGroup(content: string): ThinkingTurnSegment[] {
  return [{
    kind: 'tool-group',
    key: 'group-done-1',
    timeline: [{ type: 'thinking', content }],
    state: 'completed',
  }];
}

describe('ThinkingTurnProcess 完成态卸载（chat-thinking-perf 2.1）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('完成态思考组默认只渲染摘要行，正文不挂载', () => {
    render(<ThinkingTurnProcess segments={completedThinkingGroup('思考正文内容ABC')} />);

    expect(screen.getByRole('button', { name: /思考 1 次/ })).toBeInTheDocument();
    expect(screen.queryByText(/思考正文内容ABC/)).not.toBeInTheDocument();
  });

  it('展开时挂载正文，收起动画结束后正文卸载', () => {
    render(<ThinkingTurnProcess segments={completedThinkingGroup('思考正文内容ABC')} />);
    const summary = screen.getByRole('button', { name: /思考 1 次/ });

    fireEvent.click(summary);
    expect(screen.getByText(/思考正文内容ABC/)).toBeInTheDocument();

    fireEvent.click(summary);
    // 收起动画（300ms）期间正文仍挂载
    expect(screen.getByText(/思考正文内容ABC/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.queryByText(/思考正文内容ABC/)).not.toBeInTheDocument();

    // 再次展开可重新挂载
    fireEvent.click(summary);
    expect(screen.getByText(/思考正文内容ABC/)).toBeInTheDocument();
  });
});

describe('ThinkingTurnProcess 流式当前块纯文本与全文展开', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('流式中的当前块保持纯文本（markdown 不解析），展开后可见全文而不是截尾', () => {
    const tailMarker = '**加粗标记**';
    const headMarker = 'HEAD_KEEP';
    const longContent = `${headMarker}${'a'.repeat(3000)}${tailMarker}`;
    const segments: ThinkingTurnSegment[] = [{
      kind: 'tool-group',
      key: 'group-live-1',
      timeline: [{ type: 'thinking', content: longContent }],
      state: 'active',
    }];

    const { container } = render(<ThinkingTurnProcess segments={segments} isStreaming />);

    expect(screen.getByRole('button', { name: /AI 正在思考/ })).toBeInTheDocument();
    expect(screen.getByText(/加粗标记/)).toBeInTheDocument();
    expect(screen.queryByText('已省略前 8 字')).not.toBeInTheDocument();
    expect(container.querySelector('p[aria-busy="true"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /AI 正在思考/ }));

    expect(screen.queryByText('已省略前 8 字')).not.toBeInTheDocument();
    // 纯文本：markdown 标记原样展示（未解析为 <strong>）
    expect(container.textContent).toContain(tailMarker);
    expect(container.querySelector('strong')).toBeNull();
    const body = container.querySelector('p[aria-busy="true"]');
    expect(body?.textContent).toContain(headMarker);
    expect(body?.textContent).toContain(longContent);
    expect(
      [...container.querySelectorAll('div')].some((el) => el.className.includes('max-h-[200px]')),
    ).toBe(true);
  });

  it('块完成后恢复完整内容并转 ReactMarkdown（完成态边界）', () => {
    const tailMarker = '**加粗标记**';
    const longContent = `HEAD_KEEP${'a'.repeat(3000)}${tailMarker}`;
    const liveSegments: ThinkingTurnSegment[] = [{
      kind: 'tool-group',
      key: 'group-live-1',
      timeline: [{ type: 'thinking', content: longContent }],
      state: 'active',
    }];

    const { container, rerender } = render(
      <ThinkingTurnProcess segments={liveSegments} isStreaming />,
    );
    expect(screen.getByText('AI 正在思考')).toBeInTheDocument();
    expect(screen.queryByText('已省略前 8 字')).not.toBeInTheDocument();

    const doneSegments: ThinkingTurnSegment[] = [{
      kind: 'tool-group',
      key: 'group-live-1',
      timeline: [{ type: 'thinking', content: longContent }],
      state: 'completed',
    }];
    rerender(<ThinkingTurnProcess segments={doneSegments} />);

    // 完成态：收成摘要行，正文卸载
    expect(screen.queryByText('已省略前 8 字')).not.toBeInTheDocument();
    expect(container.querySelector('strong')).toBeNull();

    // 展开后完整内容（含被省略的头部）走 ReactMarkdown
    fireEvent.click(screen.getByRole('button', { name: /思考 1 次/ }));
    expect(screen.queryByText(/已省略前/)).not.toBeInTheDocument();
    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('加粗标记');
    expect(container.textContent).toContain('a'.repeat(100));
  });

  it('流式默认收起，第二行展示最后一句而非整段正文', () => {
    const segments: ThinkingTurnSegment[] = [{
      kind: 'tool-group',
      key: 'group-live-preview',
      timeline: [{ type: 'thinking', content: '先看结构。正在核对首页搜索框的字段名。' }],
      state: 'active',
    }];

    render(<ThinkingTurnProcess segments={segments} isStreaming />);

    expect(screen.getByRole('button', { name: /AI 正在思考/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('正在核对首页搜索框的字段名。')).toBeInTheDocument();
    expect(screen.queryByText('先看结构。正在核对首页搜索框的字段名。')).not.toBeInTheDocument();
  });
});

describe('ThinkingTurnProcess 展开后展示全部工具', () => {
  it('does not keep only the last 10 tool cards after expanding the summary', () => {
    const timeline = Array.from({ length: 12 }, (_, index) => ({
      type: 'tool' as const,
      index,
      id: `tool-${index}`,
      name: `tool_${index}`,
      input: {},
    }));
    const segments: ThinkingTurnSegment[] = [{
      kind: 'tool-group',
      key: 'group-tools-1',
      timeline,
      state: 'completed',
    }];

    render(<ThinkingTurnProcess segments={segments} />);
    fireEvent.click(screen.getByRole('button', { name: /使用 12 个工具/ }));

    expect(screen.getByText('调用工具-tool_0')).toBeInTheDocument();
    expect(screen.getByText('调用工具-tool_11')).toBeInTheDocument();
  });
});

describe('ThinkingTurnProcess 摘要手风琴', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同一轮只展开一组详情，点另一组会收起上一组', () => {
    render(
      <ThinkingTurnProcess
        segments={[
          {
            kind: 'tool-group',
            key: 'group-a',
            timeline: [{ type: 'thinking', content: '甲组正文' }],
            state: 'completed',
          },
          {
            kind: 'tool-group',
            key: 'group-b',
            timeline: [{ type: 'thinking', content: '乙组正文' }],
            state: 'completed',
          },
        ]}
      />,
    );

    const [first, second] = screen.getAllByRole('button', { name: /思考 1 次/ });
    fireEvent.click(first);
    expect(screen.getByText('甲组正文')).toBeInTheDocument();
    expect(screen.queryByText('乙组正文')).not.toBeInTheDocument();

    fireEvent.click(second);
    expect(screen.getByText('乙组正文')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.queryByText('甲组正文')).not.toBeInTheDocument();
  });
});

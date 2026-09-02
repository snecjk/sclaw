/**
 * 工具栏 Agent 选择器（按需挂载；Chat 生产默认可隐藏）。
 * 合并原 ChatAgentPickerItem + ChatAgentToolbarPicker。
 *
 * ## Types
 * - `InputComposerAgentPickerProps` — layout、open、agents 列表、选中 id、回调文案
 * - `ChatAgentToolbarPickerProps` — deprecated 别名，等同上者
 */
import type { RefObject } from 'react';
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { inputComposerHomeToolbarIconBtn } from './input-composer-toolbar-styles';
import type { AgentSummary } from '@/types/agent';

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  /** Agent 摘要 */
  agent: AgentSummary;
  /** 是否当前选中 */
  selected: boolean;
  /** 点击选中 */
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-[var(--sto-control-agent-hover-background)]',
      )}
    >
      <span className="text-[14px] font-medium text-foreground">{agent.name}</span>
      <span className="text-[11px] text-muted-foreground">
        {agent.modelDisplay}
      </span>
    </button>
  );
}

/** Agent 工具栏按钮 + 上浮面板的 props */
export interface InputComposerAgentPickerProps {
  /** 视觉布局：首页 / 对话页 */
  layout?: 'home' | 'default';
  /** 面板是否打开 */
  open: boolean;
  /** 打开态变化 */
  onOpenChange: (open: boolean) => void;
  /** 可选 Agent 列表 */
  agents: AgentSummary[];
  /** 当前选中 Agent id；null 表示未选 */
  selectedAgentId: string | null;
  /** 选中某 Agent */
  onSelect: (agentId: string) => void;
  /** 禁用按钮 */
  disabled?: boolean;
  /** 面板根 ref（点击外部关闭等） */
  pickerRef?: RefObject<HTMLDivElement | null>;
  /** 工具栏按钮 title */
  title: string;
  /** 面板标题文案 */
  panelTitle: string;
}

export function InputComposerAgentPicker({
  layout = 'home',
  open,
  onOpenChange,
  agents,
  selectedAgentId,
  onSelect,
  disabled = false,
  pickerRef,
  title,
  panelTitle,
}: InputComposerAgentPickerProps) {
  const isHome = layout === 'home';
  const selected = agents.find((a) => a.id === selectedAgentId) ?? null;

  return (
    <div ref={pickerRef} className="relative shrink-0">
      <Button
        variant="ghost"
        type="button"
        className={cn(
          isHome
            ? cn(
                inputComposerHomeToolbarIconBtn,
                (open || selected) && 'bg-[var(--sto-control-picker-hover-background)] hover:bg-[var(--sto-control-picker-hover-background)]',
              )
            : cn(
                'h-8 w-8 rounded-full p-0 text-muted-foreground/75 hover:bg-[var(--sto-control-icon-subtle-hover-background)] hover:text-foreground',
                (open || selected) && 'bg-primary/10 text-primary hover:bg-primary/12',
              ),
        )}
        onClick={() => onOpenChange(!open)}
        disabled={disabled}
        title={title}
      >
        <Bot className={cn(isHome ? 'h-4 w-4' : 'h-3.5 w-3.5')} aria-hidden />
      </Button>
      {open ? (
        <div className="sto-overlay sto-overlay--glass sto-overlay--glass-border absolute left-0 bottom-full z-50 mb-2 w-72 overflow-hidden rounded-2xl border glass p-1.5">
          <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground/80">
            {panelTitle}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {agents.map((agent) => (
              <AgentPickerItem
                key={agent.id}
                agent={agent}
                selected={agent.id === selectedAgentId}
                onSelect={() => onSelect(agent.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated 使用 InputComposerAgentPickerProps */
export type ChatAgentToolbarPickerProps = InputComposerAgentPickerProps;
/** @deprecated 使用 InputComposerAgentPicker */
export const ChatAgentToolbarPicker = InputComposerAgentPicker;

/**
 * 可组合输入壳：仅槽位与布局，不内建 Editor / 提及 / 语音实现。
 * 装配层把 Editor、Panels、Toolbar 插进对应槽。
 *
 * ## Types
 * - `InputComposerShellLayout` — `'home'` | `'default'`（圆角/阴影样式分叉）
 * - `InputComposerShellProps` — 槽位（topAccessory/mentionPopover/chips/aboveEditor/
 *   editorOrOverlay/toolbarLeft/toolbarRight）+ DnD + hasChips/overlayOpen
 */
import { forwardRef, type DragEventHandler, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';
import {
  chatComposerHomeShellClass,
  chatComposerHomeShellDragOverClass,
  chatComposerHomeShellIdleClass,
} from '@/lib/surfaces';

/** 壳视觉布局：首页大圆角 vs 对话页默认 */
export type InputComposerShellLayout = 'home' | 'default';

/** 壳 props：全部内容经 ReactNode 槽位注入 */
export interface InputComposerShellProps {
  /** 视觉布局：首页 / 对话页 */
  layout?: InputComposerShellLayout;
  /** 拖拽悬停高亮 */
  dragOver?: boolean;
  /** 外层 className */
  className?: string;
  /** 壳顶可选（如 VoiceTopCrawlWave） */
  topAccessory?: ReactNode;
  /** 钉钉 @ 浮层 */
  mentionPopover?: ReactNode;
  /** 附件 chips 区 */
  chips?: ReactNode;
  /** chips 与编辑区之间（如 Agent 目标 chip） */
  aboveEditor?: ReactNode;
  /** 编辑器或语音 overlay（必填） */
  editorOrOverlay: ReactNode;
  /** 左侧工具栏槽 */
  toolbarLeft?: ReactNode;
  /** 右侧工具栏槽（mic/send 等） */
  toolbarRight?: ReactNode;
  /** 是否有附件等，用于编辑区顶距 */
  hasChips?: boolean;
  /** 语音 overlay 打开时调整编辑区顶距 */
  overlayOpen?: boolean;
  /** 拖入文件：over */
  onDragOver?: DragEventHandler<HTMLDivElement>;
  /** 拖入文件：leave */
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  /** 拖入文件：drop */
  onDrop?: DragEventHandler<HTMLDivElement>;
}

const defaultShellClass = cn(
  'sto-control sto-control--composer relative overflow-visible rounded-2xl border',
  'transition-[box-shadow,border-color] duration-200',
);

export const InputComposerShell = forwardRef<HTMLDivElement, InputComposerShellProps>(
  function InputComposerShell(
    {
      layout = 'home',
      dragOver = false,
      className,
      topAccessory,
      mentionPopover,
      chips,
      aboveEditor,
      editorOrOverlay,
      toolbarLeft,
      toolbarRight,
      hasChips = false,
      overlayOpen = false,
      onDragOver,
      onDragLeave,
      onDrop,
    },
    ref: Ref<HTMLDivElement>,
  ) {
    const isHome = layout === 'home';

    return (
      <div
        ref={ref}
        data-sto-state={!isHome && dragOver ? 'drag-over' : undefined}
        className={cn(
          isHome
            ? cn(
                chatComposerHomeShellClass,
                dragOver ? chatComposerHomeShellDragOverClass : chatComposerHomeShellIdleClass,
              )
            : cn(
                defaultShellClass,
              ),
          className,
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {topAccessory}
        {mentionPopover}
        {chips}
        {aboveEditor}
        <div
          className={cn(
            'px-4',
            isHome
              ? cn(
                  'flex min-h-0 flex-1 flex-col',
                  hasChips || overlayOpen ? 'pt-1' : 'pt-3',
                )
              : cn(
                  'flex min-h-0 flex-1 flex-col',
                  hasChips || overlayOpen ? 'pt-1.5' : 'pt-2.5',
                ),
          )}
        >
          {editorOrOverlay}
        </div>
        <div
          className={cn(
            isHome
              ? 'relative flex shrink-0 items-center justify-between gap-2 px-4 pb-3 pt-1'
              : 'flex shrink-0 items-center justify-between gap-3 px-4 pb-1.5 pt-0.5',
          )}
        >
          <div className={cn(isHome ? 'flex shrink-0 items-center gap-2' : 'flex items-center gap-1')}>
            {toolbarLeft}
          </div>
          <div className={cn(isHome ? 'flex min-w-0 items-center gap-2' : 'flex items-center gap-1.5')}>
            {toolbarRight}
          </div>
        </div>
      </div>
    );
  },
);

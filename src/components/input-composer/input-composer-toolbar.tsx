/**
 * 能力工具栏：附件 / 技能 / 工作流 / 快捷输入（不含 mic / send / 引擎选择器）。
 * 经 Shell `toolbarLeft` 注入；`show*` / `extra` 支持插拔。
 *
 * ## Types
 * - `InputComposerToolbarProps` — layout、labels、回调、active 态、button refs、show*、extra 槽
 */
import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AttachFileIcon,
  QuickInputIcon,
  SkillToolIcon,
  WorkflowNodesIcon,
} from '@/components/icons/composer-toolbar-icons';
import { InputComposerToolbarIconTooltip } from './input-composer-toolbar-icon-tooltip';
import type { InputComposerShellLayout } from './input-composer-shell';

/** 工具栏按钮组 props；`labels` 为 i18n 文案，`extra` 可插 Agent picker 等 */
export interface InputComposerToolbarProps {
  /** 视觉布局：首页 / 对话页 */
  layout?: InputComposerShellLayout;
  /** 禁用全部按钮 */
  disabled?: boolean;
  /** 各按钮 hover/title 文案 */
  labels: {
    /** 附件 */
    attach: string;
    /** 技能 */
    skill: string;
    /** 工作流 */
    workflow: string;
    /** 快捷输入 */
    quickInput: string;
  };
  /** 点附件 */
  onAttach: () => void;
  /** 点技能 */
  onSkill: () => void;
  /** 点工作流 */
  onWorkflow: () => void;
  /** 点快捷输入 */
  onQuickInput: () => void;
  /** 技能 / 工作流打开前保存光标 */
  onSaveCaret?: () => void;
  /** 技能按钮高亮（面板打开） */
  skillActive?: boolean;
  /** 工作流按钮高亮 */
  workflowActive?: boolean;
  /** 快捷输入按钮高亮 */
  quickInputActive?: boolean;
  /** 技能按钮 ref（定位 / 点击外部） */
  skillButtonRef?: RefObject<HTMLButtonElement | null>;
  /** 工作流按钮 ref */
  workflowButtonRef?: RefObject<HTMLButtonElement | null>;
  /** 快捷输入按钮 ref（FlyTo 目标等） */
  quickInputButtonRef?: RefObject<HTMLButtonElement | null>;
  /** 是否显示附件按钮；默认 true */
  showAttach?: boolean;
  /** 是否显示技能按钮；默认 true */
  showSkill?: boolean;
  /** 是否显示工作流按钮；默认 true */
  showWorkflow?: boolean;
  /** 是否显示快捷输入按钮；默认 true */
  showQuickInput?: boolean;
  /** Agent picker 等装配层额外按钮 */
  extra?: React.ReactNode;
}

const homeIconBtn = cn(
  'inline-flex h-[30px] w-[30px] flex-col items-center justify-center rounded-lg px-[1.62px] py-[2.08px]',
  'text-[#000] hover:bg-[#F0F2F5] dark:text-foreground dark:hover:bg-muted',
);

const homeIconActive = 'bg-[#F0F2F5] hover:bg-[#F0F2F5] dark:bg-muted dark:hover:bg-muted';

const defaultIconBtn =
  'h-8 w-8 rounded-full p-0 text-muted-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]';

const defaultIconActive =
  'bg-black/5 text-foreground hover:bg-black/5 dark:bg-white/[0.06] dark:hover:bg-white/[0.06]';

export function InputComposerToolbar({
  layout = 'home',
  disabled = false,
  labels,
  onAttach,
  onSkill,
  onWorkflow,
  onQuickInput,
  onSaveCaret,
  skillActive = false,
  workflowActive = false,
  quickInputActive = false,
  skillButtonRef,
  workflowButtonRef,
  quickInputButtonRef,
  showAttach = true,
  showSkill = true,
  showWorkflow = true,
  showQuickInput = true,
  extra,
}: InputComposerToolbarProps) {
  const isHome = layout === 'home';

  if (isHome) {
    return (
      <>
        {showAttach ? (
          <InputComposerToolbarIconTooltip label={labels.attach}>
            <Button
              variant="ghost"
              type="button"
              className={homeIconBtn}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onAttach}
              disabled={disabled}
            >
              <AttachFileIcon />
            </Button>
          </InputComposerToolbarIconTooltip>
        ) : null}

        {showSkill ? (
          <InputComposerToolbarIconTooltip label={labels.skill}>
            <Button
              ref={skillButtonRef}
              variant="ghost"
              type="button"
              className={cn(homeIconBtn, skillActive && homeIconActive)}
              onMouseDown={() => onSaveCaret?.()}
              onClick={onSkill}
              disabled={disabled}
            >
              <SkillToolIcon />
            </Button>
          </InputComposerToolbarIconTooltip>
        ) : null}

        {extra}

        {showWorkflow ? (
          <div className="relative shrink-0">
            <InputComposerToolbarIconTooltip label={labels.workflow}>
              <Button
                ref={workflowButtonRef}
                variant="ghost"
                type="button"
                className={cn(homeIconBtn, workflowActive && homeIconActive)}
                onMouseDown={() => onSaveCaret?.()}
                onClick={onWorkflow}
                disabled={disabled}
              >
                <WorkflowNodesIcon />
              </Button>
            </InputComposerToolbarIconTooltip>
          </div>
        ) : null}

        {showQuickInput ? (
          <div className="relative shrink-0">
            <InputComposerToolbarIconTooltip label={labels.quickInput}>
              <Button
                ref={quickInputButtonRef}
                variant="ghost"
                type="button"
                className={cn(homeIconBtn, quickInputActive && homeIconActive)}
                onClick={onQuickInput}
                disabled={disabled}
              >
                <QuickInputIcon />
              </Button>
            </InputComposerToolbarIconTooltip>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {showAttach ? (
        <Button
          variant="ghost"
          type="button"
          className={defaultIconBtn}
          onClick={onAttach}
          disabled={disabled}
          title={labels.attach}
        >
          <AttachFileIcon />
        </Button>
      ) : null}

      {extra}

      {showSkill ? (
        <Button
          ref={skillButtonRef}
          variant="ghost"
          type="button"
          className={cn(defaultIconBtn, skillActive && defaultIconActive)}
          onMouseDown={() => onSaveCaret?.()}
          onClick={onSkill}
          disabled={disabled}
          title={labels.skill}
        >
          <SkillToolIcon />
        </Button>
      ) : null}

      {showWorkflow ? (
        <div className="relative shrink-0">
          <Button
            ref={workflowButtonRef}
            variant="ghost"
            type="button"
            className={cn(defaultIconBtn, workflowActive && defaultIconActive)}
            onMouseDown={() => onSaveCaret?.()}
            onClick={onWorkflow}
            disabled={disabled}
            title={labels.workflow}
          >
            <WorkflowNodesIcon />
          </Button>
        </div>
      ) : null}

      {showQuickInput ? (
        <div className="relative shrink-0">
          <Button
            ref={quickInputButtonRef}
            variant="ghost"
            type="button"
            className={cn(defaultIconBtn, quickInputActive && defaultIconActive)}
            onClick={onQuickInput}
            disabled={disabled}
            title={labels.quickInput}
          >
            <QuickInputIcon />
          </Button>
        </div>
      ) : null}
    </>
  );
}

export { homeIconBtn as inputComposerHomeToolbarIconBtn };

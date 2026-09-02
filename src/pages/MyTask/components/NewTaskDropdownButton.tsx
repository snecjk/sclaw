/**
 * NewTaskDropdownButton 组件
 * 「新建定时任务」按钮：点击直接打开创建弹窗
 * 页面头部与空状态共用，行为完全一致
 *
 * 临时：官方推荐下拉已注释。恢复时：
 * 1. 取消 ChevronDown / DropdownMenu 相关 import 注释
 * 2. 改回下方「原下拉实现」
 */

import { useTranslation } from 'react-i18next';
import { StoOutlineButton } from '@/components/ui/sto-neutral-controls';
// import { ChevronDown } from 'lucide-react';
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuTrigger,
// } from '@/components/ui/dropdown-menu';
import { myTaskCreateButtonClass } from '@/lib/surfaces';

interface NewTaskDropdownButtonProps {
  /** 自己创建回调：打开 TaskCreateModal */
  onSelfCreate: () => void;
  /** 工作流创建回调：打开 TemplateSelectModal（官方推荐，临时禁用） */
  onTemplateCreate: () => void;
}

export function NewTaskDropdownButton({
  onSelfCreate,
  // onTemplateCreate,
}: NewTaskDropdownButtonProps) {
  const { t } = useTranslation('tasks');

  // 临时：点击直接打开创建弹窗；ChevronDown icon 一并注释
  return (
    <StoOutlineButton className={myTaskCreateButtonClass} onClick={onSelfCreate}>
      {t('myTask.newTask')}
      {/* <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> */}
    </StoOutlineButton>
  );

  // 原下拉实现（直接创建 + 官方推荐）：
  // return (
  //   <DropdownMenu>
  //     <DropdownMenuTrigger asChild>
  //       <button type="button" className={myTaskCreateButtonClass}>
  //         {t('myTask.newTask')}
  //         <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
  //       </button>
  //     </DropdownMenuTrigger>
  //     <DropdownMenuContent align="end">
  //       <DropdownMenuItem onClick={onSelfCreate}>
  //         {t('myTask.newTaskDropdown.selfCreate')}
  //       </DropdownMenuItem>
  //       <DropdownMenuItem onClick={onTemplateCreate}>
  //         {t('myTask.newTaskDropdown.templateCreate')}
  //       </DropdownMenuItem>
  //     </DropdownMenuContent>
  //   </DropdownMenu>
  // );
}

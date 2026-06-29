/**
 * NewTaskDropdownButton 组件
 * 「新建定时任务」下拉按钮：自己创建 → 打开创建弹窗，模版创建 → 打开模版选择弹窗
 * 页面头部与空状态共用，行为完全一致
 */

import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { myTaskCreateButtonClass } from '@/lib/surfaces';

interface NewTaskDropdownButtonProps {
  /** 自己创建回调：打开 TaskCreateModal */
  onSelfCreate: () => void;
  /** 模版创建回调：打开 TemplateSelectModal */
  onTemplateCreate: () => void;
}

export function NewTaskDropdownButton({ onSelfCreate, onTemplateCreate }: NewTaskDropdownButtonProps) {
  const { t } = useTranslation('tasks');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={myTaskCreateButtonClass}>
          {t('myTask.newTask')}
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onSelfCreate}>
          {t('myTask.newTaskDropdown.selfCreate')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onTemplateCreate}>
          {t('myTask.newTaskDropdown.templateCreate')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

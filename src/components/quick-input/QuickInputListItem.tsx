/**
 * 快捷输入列表单行：图标 + 截断标题，hover 右侧展示完整内容 tooltip。
 */
import { cn } from '@/lib/utils';
import { QuickInputIcon } from '@/components/icons/composer-toolbar-icons';
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { QuickInputItem } from './types';

const itemTooltipClass =
  'max-w-[300px] overflow-visible rounded-[6px] border-none bg-black/90 px-2.5 py-1.5 text-xs font-normal leading-4 text-white shadow-none';

export interface QuickInputListItemProps {
  item: QuickInputItem;
  onSelect: (item: QuickInputItem) => void;
}

export function QuickInputListItem({ item, onSelect }: QuickInputListItemProps) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(item)}
          className={cn(
            'flex h-8 w-full items-center gap-1.5 self-stretch rounded-lg p-2 text-left transition-colors',
            'hover:bg-[#F0F2F5] dark:hover:bg-muted',
          )}
        >
          <QuickInputIcon className="h-[14px] w-[14px] shrink-0 text-[#111827] dark:text-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-normal leading-4 text-[#111827] dark:text-foreground">
            {item.title}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className={itemTooltipClass}>
        <p className="whitespace-pre-wrap text-left">{item.content}</p>
        <TooltipArrow className="fill-black/90" width={10} height={5} />
      </TooltipContent>
    </Tooltip>
  );
}

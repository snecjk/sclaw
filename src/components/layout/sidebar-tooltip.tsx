import type { ReactElement, ReactNode } from 'react';
import type * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  sidebarTooltipArrowClass,
  sidebarTooltipContentClass,
} from '@/lib/surfaces';

type SidebarTooltipProps = {
  children: ReactElement;
  label: ReactNode;
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
  align?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['align'];
  sideOffset?: number;
  collisionPadding?: number;
  delayDuration?: number;
  contentClassName?: string;
};

/** 侧边栏统一气泡，与“新建项目”按钮保持同一视觉和交互。 */
export function SidebarTooltip({
  children,
  label,
  side = 'right',
  align = 'center',
  sideOffset = 4,
  collisionPadding = 12,
  delayDuration = 300,
  contentClassName,
}: SidebarTooltipProps) {
  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(sidebarTooltipContentClass, contentClassName)}
      >
        {label}
        <TooltipArrow className={sidebarTooltipArrowClass} />
      </TooltipContent>
    </Tooltip>
  );
}

import { cn } from '@/lib/utils';
import type { WorkflowCoverKey } from '@/pages/Workflow/types';
import { WORKFLOW_CARD_COVER_BY_KEY } from '@/pages/Workflow/workflow-card-covers';

interface WorkflowCardCoverProps {
  coverKey: WorkflowCoverKey;
  className?: string;
}

/**
 * 工作流卡片头图：宽度随卡片，高度按切图比例（270:90）自适应。
 */
export function WorkflowCardCover({ coverKey, className }: WorkflowCardCoverProps) {
  const cover = WORKFLOW_CARD_COVER_BY_KEY[coverKey];

  return (
    <div className={cn('relative aspect-[270/90] w-full overflow-hidden', className)} aria-hidden>
      <img
        src={cover.src}
        alt=""
        width={cover.width}
        height={cover.height}
        className="block h-full w-full object-cover object-center"
      />
    </div>
  );
}

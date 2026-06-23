/** 工作流卡片头图资源定义 */
import type { WorkflowCoverKey } from '@/pages/Workflow/types';
import workflowCardCover1 from '@/assets/workflow-card-cover-1.png';
import workflowCardCover2 from '@/assets/workflow-card-cover-2.png';
import workflowCardCover3 from '@/assets/workflow-card-cover-3.png';
import workflowCardCover4 from '@/assets/workflow-card-cover-4.png';
import workflowCardCover5 from '@/assets/workflow-card-cover-5.png';

export interface WorkflowCardCoverAsset {
  key: WorkflowCoverKey;
  src: string;
  width: number;
  height: number;
}

/** 工作流卡片头图资源（270×90，比例 3:1） */
export const WORKFLOW_CARD_COVERS: WorkflowCardCoverAsset[] = [
  { key: 'cover-1', src: workflowCardCover1, width: 270, height: 90 },
  { key: 'cover-2', src: workflowCardCover2, width: 270, height: 90 },
  { key: 'cover-3', src: workflowCardCover3, width: 270, height: 90 },
  { key: 'cover-4', src: workflowCardCover4, width: 270, height: 90 },
  { key: 'cover-5', src: workflowCardCover5, width: 270, height: 90 },
];

/** 按 key 查找头图资源的 Record，供 WorkflowCardCover 组件使用 */
export const WORKFLOW_CARD_COVER_BY_KEY: Record<WorkflowCoverKey, WorkflowCardCoverAsset> =
  Object.fromEntries(WORKFLOW_CARD_COVERS.map((c) => [c.key, c])) as Record<
    WorkflowCoverKey,
    WorkflowCardCoverAsset
  >;


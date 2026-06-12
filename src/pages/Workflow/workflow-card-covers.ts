import type { WorkflowCardItem, WorkflowCoverKey } from '@/pages/Workflow/types';
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

export const WORKFLOW_CARD_COVER_BY_KEY: Record<WorkflowCoverKey, WorkflowCardCoverAsset> =
  Object.fromEntries(WORKFLOW_CARD_COVERS.map((c) => [c.key, c])) as Record<
    WorkflowCoverKey,
    WorkflowCardCoverAsset
  >;

export function pickRandomWorkflowCoverKey(): WorkflowCoverKey {
  const index = Math.floor(Math.random() * WORKFLOW_CARD_COVERS.length);
  return WORKFLOW_CARD_COVERS[index].key;
}

/** @mock: 待接入 POST /agent/v1/workflows 创建成功后的列表项拼装 */
export function createWorkflowCardItem(
  name: string,
  listKind: 'published' | 'draft',
): WorkflowCardItem {
  return {
    id: `wf_${crypto.randomUUID()}`,
    name,
    listKind,
    category: '经营管理',
    schedule: listKind === 'draft' ? '还未设置排期' : '待配置自动运行',
    scheduleIcon: 'clock',
    enabled: listKind === 'published',
    isCustom: true,
    description: '在编辑器中创建的工作流。',
    flow: ['待配置节点'],
    lastRun: listKind === 'draft' ? '还没运行过' : '还没运行过',
    coverKey: pickRandomWorkflowCoverKey(),
    neverRun: true,
    ...(listKind === 'draft' ? { scheduleMuted: true, showPausedLabel: false } : {}),
  };
}

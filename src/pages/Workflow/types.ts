/** 工作流列表页 & 详情弹窗的 UI 数据模型 */

/** 页面视图：dashboard = 列表页，builder = 编辑器 */
export type WorkflowView = 'dashboard' | 'builder';

/** 卡片头图标识，对应 workflow-card-covers.ts 中的 5 张资源 */
export type WorkflowCoverKey = 'cover-1' | 'cover-2' | 'cover-3' | 'cover-4' | 'cover-5';

/** 卡片运行状态（用于列表 meta 行绿点 / 已暂停标记） */
export type WorkflowCardStatus = 'running' | 'paused' | 'draft';

/** 我的工作流列表二级筛选：已发布 / 草稿箱 */
export type WorkflowMineListKind = 'published' | 'draft';

/** 我的工作流 / 官方推荐 卡片列表项（映射自 API 或本地创建） */
export interface WorkflowCardItem {
  id: string;
  name: string;
  /** 列表二级筛选归属：published / draft，由 API lifecycleStatus 推导 */
  listKind: WorkflowMineListKind;
  enabled: boolean;
  description: string;
  coverKey: WorkflowCoverKey;
  flow: string[];
  /** 来自 API 的模板 ID（可选，仅作数据透传，不再用于区分「系统 / 自建」） */
  templateId?: string | null;
  /** 从未运行过（meta 无绿点） */
  neverRun?: boolean;
}

/** 官方推荐卡片（scope=system 的模板） */
export interface OfficialWorkflowCard {
  id: string;
  name: string;
  category: string;
  description: string;
  flow: string[];
  coverKey: WorkflowCoverKey;
}

/** 详情弹窗中的步骤行（对应「它会怎么做」时间轴） */
export interface WorkflowDetailStep {
  title: string;
  description: string;
  skills?: string[];
}

/** 详情弹窗的额外数据（API 返回后填充，null 时 UI 用占位文案） */
export interface WorkflowDetailData {
  produces: string;
  /** 预计执行时长文案，如「预计 2 分钟执行完成」 */
  estimatedDuration?: string;
  /** 本月执行次数，用于「运行情况」行 */
  monthRunCount?: number;
  steps: WorkflowDetailStep[];
}

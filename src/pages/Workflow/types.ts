export type WorkflowView = 'dashboard' | 'builder';

export type BuilderEntryMode = 'generate' | 'blank' | 'edit';

export type WorkflowBuilderBackResult = {
  action: 'published' | 'draft';
  name: string;
};

export type WorkflowNodeKind = 'db' | 'proc' | 'cond' | 'task' | 'notify' | 'end' | 'ai';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multi'
  | 'freqtime'
  | 'dsgroup';

export interface WorkflowField {
  key: string;
  label: string;
  type: FieldType;
  value?: string;
  freq?: string;
  options?: string[];
  dataSource?: DataSourceValue;
}

export interface DataSourceValue {
  localFiles?: string[];
  sys?: string[];
  online?: string[];
}

export interface NodeSummaryRow {
  key: string;
  value: string;
  ai?: boolean;
  pick?: boolean;
}

export interface WorkflowNodeData {
  id: string;
  kind: WorkflowNodeKind;
  icon: string;
  label: string;
  title: string;
  description: string;
  ai?: boolean;
  tryRun?: boolean;
  resultSummary?: string;
  fields: WorkflowField[];
  summary?: NodeSummaryRow[];
  x: number;
  y: number;
}

export interface WorkflowLink {
  from: string;
  to: string;
}

export type NodeRunState = 'running' | 'done' | 'skip' | 'fail' | null;

export type WorkflowCoverKey = 'cover-1' | 'cover-2' | 'cover-3' | 'cover-4' | 'cover-5';

export type WorkflowCardStatus = 'running' | 'paused' | 'draft';

/** 我的工作流列表二级筛选：已发布 / 已安装 / 草稿箱 */
export type WorkflowMineListKind = 'published' | 'installed' | 'draft';

export interface WorkflowCardItem {
  id: string;
  name: string;
  /** 列表二级筛选归属（对齐工作流列表设计稿） */
  listKind: WorkflowMineListKind;
  category: string;
  schedule: string;
  scheduleIcon: 'clock' | 'zap' | 'pause';
  enabled: boolean;
  description: string;
  flow: string[];
  lastRun: string;
  coverKey: WorkflowCoverKey;
  isCustom?: boolean;
  /** 排期行显示「已暂停」警告 */
  showPausedLabel?: boolean;
  /** 排期文案弱化（已暂停态） */
  scheduleMuted?: boolean;
  /** 从未运行过（meta 无绿点） */
  neverRun?: boolean;
  /** meta 显示成功绿点 */
  runSuccess?: boolean;
}

export interface OfficialWorkflowCard {
  id: string;
  name: string;
  category: string;
  schedule: string;
  scheduleIcon: 'clock' | 'zap';
  description: string;
  flow: string[];
  coverKey: WorkflowCoverKey;
}

export interface WorkflowDetailStep {
  title: string;
  description: string;
  skills?: string[];
}

export interface WorkflowDetailData {
  produces: string;
  /** 预计执行时长文案，如「预计 2 分钟执行完成」 */
  estimatedDuration?: string;
  /** 本月执行次数，用于「运行情况」行 */
  monthRunCount?: number;
  steps: WorkflowDetailStep[];
}

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'step' | 'plan';
  content?: string;
  stepText?: string;
  stepDone?: boolean;
  planSteps?: Array<{ title: string; description: string }>;
}

export interface VersionItem {
  time: string;
  type: string;
  current?: boolean;
  published?: boolean;
  ai?: boolean;
  description: string;
}

export type RunDrawerMode = 'loading' | 'report' | 'node-report' | 'closed';

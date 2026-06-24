/** 工作流编辑器的数据模型：节点、连线、字段、AI 聊天、版本、运行状态 */

/** 编辑器入口模式：generate = AI 生成，blank = 手动创建，edit = 编辑已有 */
export type BuilderEntryMode = 'generate' | 'blank' | 'edit';

/** 编辑器返回结果：告知列表页本次操作类型（发布/保存草稿）和工作流名 */
export type WorkflowBuilderBackResult = {
  action: 'published' | 'draft';
  name: string;
};

/** 节点类型：db=数据获取，proc=数据处理，cond=条件判定，task=结果输出，notify=发送通知，end=结束，ai=AI 生成 */
export type WorkflowNodeKind = 'db' | 'proc' | 'cond' | 'task' | 'notify' | 'end' | 'ai';

/** 字段类型：text/textarea/select/multi/freqtime（频次+时间）/dsgroup（数据源组合） */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multi'
  | 'freqtime'
  | 'dsgroup';

/** 节点字段定义 */
export interface WorkflowField {
  key: string;
  label: string;
  type: FieldType;
  value?: string;
  freq?: string;
  options?: string[];
  dataSource?: DataSourceValue;
}

/** 数据源值：三种来源的已选项列表 */
export interface DataSourceValue {
  localFiles?: string[];
  sys?: string[];
  online?: string[];
}

/** 节点摘要行（卡片底部的 key-value 展示，pick 表示可选择技能） */
export interface NodeSummaryRow {
  key: string;
  value: string;
  ai?: boolean;
  pick?: boolean;
}

/** 画布上的节点完整数据（含位置坐标 x/y、字段、摘要等） */
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

/** 节点连线：from → to 的有向边 */
export interface WorkflowLink {
  from: string;
  to: string;
}

/** 试运行时的节点状态 */
export type NodeRunState = 'running' | 'done' | 'skip' | 'fail' | null;

/** AI 聊天消息：assistant=助手回复，user=用户输入，step=步骤进度，plan=生成方案 */
export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'step' | 'plan';
  content?: string;
  stepText?: string;
  stepDone?: boolean;
  planSteps?: Array<{ title: string; description: string }>;
}

/** 版本记录条目（用于版本历史抽屉） */
export interface VersionItem {
  time: string;
  type: string;
  current?: boolean;
  published?: boolean;
  ai?: boolean;
  description: string;
}

/** 运行抽屉的显示模式 */
export type RunDrawerMode = 'loading' | 'report' | 'node-report' | 'closed';

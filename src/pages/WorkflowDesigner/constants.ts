/** Node library — aligned with memory-center-web nodeTemplates */

import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  Database,
  FilePenLine,
  GitBranch,
  Save,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from 'lucide-react';

export const NODE_W = 220;
export const NODE_H = 88;

export type NodeTemplateAccent =
  | 'trigger'
  | 'data'
  | 'transform'
  | 'agent'
  | 'condition'
  | 'approval'
  | 'action'
  | 'output';

export type NodeTemplate = {
  type: string;
  label: string;
  icon: LucideIcon;
  accent: NodeTemplateAccent;
  summary?: string;
};

export const NODE_TEMPLATES: NodeTemplate[] = [
  { type: 'trigger', label: '开始方式', icon: Upload, accent: 'trigger', summary: '定义流程从什么事件开始。' },
  { type: 'startup_config', label: '启动配置', icon: SlidersHorizontal, accent: 'data', summary: '汇总流程启动前需要用户确认的参数。' },
  { type: 'user_input', label: '人工输入', icon: FilePenLine, accent: 'data', summary: '流程运行到这里暂停，等待人工补充内容。' },
  { type: 'transform', label: '整理数据', icon: ArrowRightLeft, accent: 'transform', summary: '把已有资料整理成后续步骤更容易使用的形式。' },
  { type: 'agent_task', label: '智能处理', icon: Sparkles, accent: 'agent', summary: '让系统自动分析、总结、判断或生成结果。' },
  { type: 'agent_data_fetch', label: '智能数据获取', icon: Database, accent: 'agent', summary: '让云端 Agent 理解取数目标并组织可用数据。' },
  { type: 'agent_data_process', label: '智能数据处理', icon: Sparkles, accent: 'agent', summary: '让云端 Agent 执行分析、汇总或结构化整理。' },
  { type: 'agent_condition', label: '智能条件判定', icon: GitBranch, accent: 'agent', summary: '让云端 Agent 在分支集合中选择唯一路径。' },
  { type: 'agent_output', label: '智能结果输出', icon: Save, accent: 'agent', summary: '让云端 Agent 生成最终结果、摘要或报告产物。' },
  { type: 'condition', label: '按结果分流', icon: GitBranch, accent: 'condition', summary: '根据上一步结果决定接下来往哪一步走。' },
  { type: 'human_approval', label: '人工审核', icon: ShieldCheck, accent: 'approval', summary: '在关键步骤暂停，等待人工确认后继续。' },
  { type: 'action', label: '执行动作', icon: Send, accent: 'action', summary: '对外部系统执行一个确定性动作。' },
  { type: 'output', label: '保存结果', icon: Save, accent: 'output', summary: '把流程结果保存、导出或归档。' },
];

export const BASIC_NODE_TEMPLATES = NODE_TEMPLATES.filter((t) =>
  ['trigger', 'startup_config', 'user_input', 'transform', 'condition', 'human_approval', 'action', 'output'].includes(t.type),
);

export const SMART_NODE_TEMPLATES = NODE_TEMPLATES.filter((t) => t.type.startsWith('agent_'));

export const AGENT_OUTPUT_TEMPLATES = [
  { id: 'generic_data_result', label: '通用数据结果' },
  { id: 'structured_data_extract_result', label: '结构化抽取结果' },
  { id: 'readable_summary', label: '可读摘要' },
] as const;
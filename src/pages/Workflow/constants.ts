import type { WorkflowNodeKind } from '@/pages/Workflow/types';

/** PRD §5 / 交互说明 §7.3 — 节点类型标识色（业务专用，非通用 UI token） */
export const NODE_KIND_ICON_CLASS: Record<WorkflowNodeKind, string> = {
  db: 'bg-success text-success-foreground',
  proc: 'bg-[#4C8DF6] text-primary-foreground',
  cond: 'bg-warning text-warning-foreground',
  task: 'bg-[#8B6CE8] text-primary-foreground',
  notify: 'bg-[#2BA39A] text-primary-foreground',
  end: 'bg-[#5C6573] text-primary-foreground',
  ai: 'bg-[#C45BE0] text-primary-foreground',
};

export const NODE_W = 380;
export const COL_GAP = 110;
export const TOP_Y = 60;
export const LEFT_X = 430;
export const OVERLAY_W = 420;
export const BRANCH_PARENT: Record<string, string> = { n6: 'n4' };

export const LIBRARY_NODE_NAMES = [
  '数据获取',
  '数据处理',
  '条件判定',
  '结果输出',
  '发送通知',
  '结束',
] as const;

export const EXAMPLE_CHIPS = [
  'weeklyReconciliation',
  'abnormalCustomer',
  'dailyRevenue',
] as const;

export const FREQ_OPTIONS = ['每天', '每周', '每月', '不重复'] as const;
export const TIME_OPTIONS = ['09:00', '12:00', '18:00', '21:00'] as const;

export const NOTIFY_CHANNEL_OPTIONS = ['STO Claw', '钉钉', '邮件', '企业微信'] as const;

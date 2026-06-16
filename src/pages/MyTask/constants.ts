/**
 * MyTask 页面常量
 * 排序选项、状态配置、推荐任务等
 */

import type { RecommendTask, RecordStatus } from './types';

/** 排序选项 */
export const SORT_OPTIONS = [
  { value: 'created-desc', label: '按创建时间倒序' },
  { value: 'created-asc', label: '按创建时间正序' },
  { value: 'name-asc', label: '按名称 A-Z' },
  { value: 'name-desc', label: '按名称 Z-A' },
] as const;

/** 执行记录状态 Tab 配置 */
export const RECORD_STATUS_TABS: { value: RecordStatus; label: string }[] = [
  { value: 'running', label: '执行中' },
  { value: 'success', label: '执行成功' },
  { value: 'failed', label: '执行失败' },
];

/** 推荐任务（与 HTML 原型一致） */
export const RECOMMEND_TASKS: RecommendTask[] = [
  {
    title: '客户成本分析',
    desc: '每月 1 日 8:00 拉取出港单票成本与客户成本异常，生成报表链接触达出港成本小组，指标与首页「本月出港成本报表」一致，支撑成本稽核。',
    schedule: '每月 1 日 08:00',
  },
  {
    title: '每日总部对账结果',
    desc: '每日 8:00 汇总未闭环异常客诉与风险客户动态，同步至首页「昨日总部对账结果」卡片，与客户服务 pill 口径一致，便于片区与客户跟踪小组跟进。',
    schedule: '每天 08:00',
  },
  {
    title: '每日异常客户监控',
    desc: '每工作日 9:00 从总部资金系统拉取上一日对账与利息到账数据，写入首页并与「昨日异常客户跟踪」卡片口径对齐，异常项自动标红便于结算小组处理。',
    schedule: '每天 09:00',
  },
];

/** 执行记录状态文字映射 */
export const STATUS_LABEL: Record<RecordStatus, string> = {
  running: '执行中',
  success: '执行成功',
  failed: '执行失败',
};

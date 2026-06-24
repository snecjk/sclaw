/**
 * MyTask 页面常量
 * 排序选项、状态配置等
 */

import type { RecordStatus } from './types';

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

/** 执行记录状态文字映射 */
export const STATUS_LABEL: Record<RecordStatus, string> = {
  running: '执行中',
  success: '执行成功',
  failed: '执行失败',
};

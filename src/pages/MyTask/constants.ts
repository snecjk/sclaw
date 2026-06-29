/**
 * MyTask 页面常量
 * 排序选项、状态配置等
 * 文案通过 i18n (tasks:myTask.*) 管理，此处仅保留 value 与 i18n key 映射
 */

import type { RecordStatus } from './types';

/** 排序选项（label 通过 i18n key 渲染） */
export const SORT_OPTIONS = [
  { value: 'created-desc', i18nKey: 'myTask.sort.createdDesc' },
  { value: 'created-asc', i18nKey: 'myTask.sort.createdAsc' },
  { value: 'name-asc', i18nKey: 'myTask.sort.nameAsc' },
  { value: 'name-desc', i18nKey: 'myTask.sort.nameDesc' },
] as const;

/** 执行记录状态 Tab 配置（label 通过 i18n key 渲染） */
export const RECORD_STATUS_TABS: { value: RecordStatus; i18nKey: string }[] = [
  { value: 'running', i18nKey: 'myTask.recordStatus.running' },
  { value: 'success', i18nKey: 'myTask.recordStatus.success' },
  { value: 'failed', i18nKey: 'myTask.recordStatus.failed' },
];

/** 执行记录状态 i18n key 映射 */
export const STATUS_I18N_KEY: Record<RecordStatus, string> = {
  running: 'myTask.recordStatus.running',
  success: 'myTask.recordStatus.success',
  failed: 'myTask.recordStatus.failed',
};

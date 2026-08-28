/**
 * 工作流 Panel：薄包装现有 `WorkflowPicker`，`pickerRef` 只绑根节点（避免双绑）。
 *
 * ## Types
 * - `WorkflowPickerPanelProps` — 等同 `ComponentProps<typeof WorkflowPicker>`（controller 的 `panelProps`）
 * - 组件另需 `pickerRef`（不进 panelProps，由装配层传入）
 */
import { WorkflowPicker } from '@/components/workflow/WorkflowPicker';
import type { ComponentProps, RefObject } from 'react';

/** 透传给 WorkflowPicker 的 props（不含根 ref） */
export type WorkflowPickerPanelProps = ComponentProps<typeof WorkflowPicker>;

export function WorkflowPickerPanel({
  pickerRef,
  ...props
}: WorkflowPickerPanelProps & {
  /** 面板根 ref（点击外部关闭；只绑此根，避免双绑） */
  pickerRef: RefObject<HTMLDivElement | null>;
}) {
  return <WorkflowPicker ref={pickerRef} {...props} />;
}

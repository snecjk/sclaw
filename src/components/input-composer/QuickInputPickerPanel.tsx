/**
 * 快捷输入 Panel：薄包装现有 `QuickInputPicker`，`pickerRef` 只绑根节点。
 *
 * ## Types
 * - `QuickInputPickerPanelProps` — 等同 `ComponentProps<typeof QuickInputPicker>`（controller 的 `panelProps`）
 * - 组件另需 `pickerRef`（不进 panelProps，由装配层传入）
 */
import { QuickInputPicker } from '@/components/quick-input/QuickInputPicker';
import type { ComponentProps, RefObject } from 'react';

/** 透传给 QuickInputPicker 的 props（不含根 ref） */
export type QuickInputPickerPanelProps = ComponentProps<typeof QuickInputPicker>;

export function QuickInputPickerPanel({
  pickerRef,
  ...props
}: QuickInputPickerPanelProps & {
  /** 面板根 ref（点击外部关闭；只绑此根） */
  pickerRef: RefObject<HTMLDivElement | null>;
}) {
  return <QuickInputPicker ref={pickerRef} {...props} />;
}

/**
 * 技能 Panel：薄包装现有 `SkillPicker`，`pickerRef` 只绑根节点。
 *
 * ## Types
 * - `SkillPickerPanelProps` — 等同 `SkillPickerProps`（controller 的 `panelProps`）
 * - 组件另需 `pickerRef`（不进 panelProps，由装配层传入）
 */
import { SkillPicker, type SkillPickerProps } from '@/components/skill-plaza/SkillPicker';
import type { RefObject } from 'react';

/** 透传给 SkillPicker 的 props（不含根 ref） */
export type SkillPickerPanelProps = SkillPickerProps;

export function SkillPickerPanel({
  pickerRef,
  ...props
}: SkillPickerPanelProps & {
  /** 面板根 ref（点击外部关闭；只绑此根） */
  pickerRef: RefObject<HTMLDivElement | null>;
}) {
  return <SkillPicker ref={pickerRef} {...props} />;
}

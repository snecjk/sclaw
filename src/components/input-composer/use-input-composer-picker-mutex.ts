/**
 * Picker 互斥：skill / workflow / quickInput 的唯一 open 状态源。
 * controller 禁止再声明独立 open state；开关经 toggle* / set* / closeAll。
 *
 * ## Types
 * - `InputComposerPickerMutex` — hook 返回值（open flags、mode、slashOpenRef、toggles）
 */
import { useCallback, useRef, useState } from 'react';

export function useInputComposerPickerMutex() {
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillPickerMode, setSkillPickerMode] = useState<'inline' | 'toolbar'>('inline');
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false);
  const workflowPickerSlashOpenRef = useRef(false);
  const [quickInputPickerOpen, setQuickInputPickerOpen] = useState(false);

  const closeAll = useCallback(() => {
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen(false);
    setQuickInputPickerOpen(false);
    setSkillPickerOpen(false);
  }, []);

  const toggleSkillToolbar = useCallback(() => {
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen(false);
    setQuickInputPickerOpen(false);
    setSkillPickerOpen((open) => {
      if (!open) {
        setSkillPickerMode('toolbar');
      }
      return !open;
    });
  }, []);

  const toggleWorkflowToolbar = useCallback(() => {
    setSkillPickerOpen(false);
    setQuickInputPickerOpen(false);
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen((open) => !open);
  }, []);

  const toggleQuickInput = useCallback(() => {
    setSkillPickerOpen(false);
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen(false);
    setQuickInputPickerOpen((open) => !open);
  }, []);

  return {
    skillPickerOpen,
    setSkillPickerOpen,
    skillPickerMode,
    setSkillPickerMode,
    workflowPickerOpen,
    setWorkflowPickerOpen,
    workflowPickerSlashOpenRef,
    quickInputPickerOpen,
    setQuickInputPickerOpen,
    toggleSkillToolbar,
    toggleWorkflowToolbar,
    toggleQuickInput,
    closeAll,
  };
}

/** mutex 返回值：三 picker 的 open/mode 与互斥 toggle */
export type InputComposerPickerMutex = ReturnType<typeof useInputComposerPickerMutex>;

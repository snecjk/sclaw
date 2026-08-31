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

  const openSkillToolbar = useCallback(() => {
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen(false);
    setQuickInputPickerOpen(false);
    setSkillPickerMode('toolbar');
    setSkillPickerOpen(true);
  }, []);

  const toggleWorkflowToolbar = useCallback(() => {
    setSkillPickerOpen(false);
    setQuickInputPickerOpen(false);
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen((open) => !open);
  }, []);

  const openWorkflowToolbar = useCallback(() => {
    setSkillPickerOpen(false);
    setQuickInputPickerOpen(false);
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen(true);
  }, []);

  const toggleQuickInput = useCallback(() => {
    setSkillPickerOpen(false);
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen(false);
    setQuickInputPickerOpen((open) => !open);
  }, []);

  const openQuickInput = useCallback(() => {
    setSkillPickerOpen(false);
    workflowPickerSlashOpenRef.current = false;
    setWorkflowPickerOpen(false);
    setQuickInputPickerOpen(true);
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
    openSkillToolbar,
    toggleWorkflowToolbar,
    openWorkflowToolbar,
    toggleQuickInput,
    openQuickInput,
    closeAll,
  };
}

/** mutex 返回值：三 picker 的 open/mode 与互斥 toggle */
export type InputComposerPickerMutex = ReturnType<typeof useInputComposerPickerMutex>;

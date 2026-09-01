/**
 * input-composer 能力库入口：按需导出 hooks / 壳 / 工具栏 / Panel。
 * Chat / Task 等场景自行组装，不强制全量使用。
 *
 * ## Types（再导出）
 * - `InputComposerPickerMutex` — mutex 返回值
 * - `InputComposerPickers` / `UseInputComposerPickersOptions` — 三 picker 聚合
 * - `ComposerDingTalkMention` / `UseComposerDingTalkMentionOptions` — 钉钉 @
 * - `SkillPickerMode` / `UseSkillPickerControllerOptions` — 技能 picker
 * - `UseWorkflowPickerControllerOptions` / `UseQuickInputPickerControllerOptions`
 * - `*PickerPanelProps` — Panel 透传 props
 * - `InputComposerShellLayout` / `InputComposerShellProps` — 壳布局与槽位
 * - `InputComposerToolbarProps` / `InputComposerSendButtonProps`
 * - `InputComposerAgentPickerProps`（及 deprecated `ChatAgentToolbarPicker*`）
 * - `InputComposerCore` / `InputComposerSubmitMode` / `UseInputComposerCoreOptions`
 * - `InputComposerVoice` / `UseInputComposerVoiceOptions`
 * - `ChatDraftWorkflowMeta` / `ChatEditDraftEventDetail` / `UseInputComposerEditDraftOptions`
 */
export { useInputComposerPickerMutex } from './use-input-composer-picker-mutex';
export type { InputComposerPickerMutex } from './use-input-composer-picker-mutex';

export { useInputComposerPickers } from './use-input-composer-pickers';
export type {
  InputComposerPickers,
  UseInputComposerPickersOptions,
} from './use-input-composer-pickers';

export { useComposerDingTalkMention } from './use-composer-dingtalk-mention';
export type {
  ComposerDingTalkMention,
  UseComposerDingTalkMentionOptions,
} from './use-composer-dingtalk-mention';

export { useSkillPickerController } from './use-skill-picker-controller';
export type {
  SkillPickerMode,
  UseSkillPickerControllerOptions,
} from './use-skill-picker-controller';

export { useWorkflowPickerController } from './use-workflow-picker-controller';
export type { UseWorkflowPickerControllerOptions } from './use-workflow-picker-controller';

export { useQuickInputPickerController } from './use-quick-input-picker-controller';
export type { UseQuickInputPickerControllerOptions } from './use-quick-input-picker-controller';

export { SkillPickerPanel } from './SkillPickerPanel';
export type { SkillPickerPanelProps } from './SkillPickerPanel';

export { WorkflowPickerPanel } from './WorkflowPickerPanel';
export type { WorkflowPickerPanelProps } from './WorkflowPickerPanel';

export { QuickInputPickerPanel } from './QuickInputPickerPanel';
export type { QuickInputPickerPanelProps } from './QuickInputPickerPanel';

export { InputComposerShell } from './input-composer-shell';
export type {
  InputComposerShellLayout,
  InputComposerShellProps,
} from './input-composer-shell';

export { InputComposerToolbar } from './input-composer-toolbar';
export type { InputComposerToolbarProps } from './input-composer-toolbar';
export { inputComposerHomeToolbarIconBtn } from './input-composer-toolbar-styles';

export { InputComposerToolbarIconTooltip } from './input-composer-toolbar-icon-tooltip';

export { InputComposerSendButton } from './input-composer-send-button';
export type { InputComposerSendButtonProps } from './input-composer-send-button';

export { InputComposerAgentPicker } from './input-composer-agent-picker';
export type { InputComposerAgentPickerProps } from './input-composer-agent-picker';
/** @deprecated 兼容旧名 */
export { ChatAgentToolbarPicker } from './input-composer-agent-picker';
export type { ChatAgentToolbarPickerProps } from './input-composer-agent-picker';

export { useInputComposerCore } from './use-input-composer-core';
export type {
  InputComposerCore,
  InputComposerSubmitMode,
  UseInputComposerCoreOptions,
} from './use-input-composer-core';

export { useInputComposerVoice } from './use-input-composer-voice';
export type {
  InputComposerVoice,
  UseInputComposerVoiceOptions,
} from './use-input-composer-voice';

export {
  useInputComposerEditDraft,
  CHAT_EDIT_DRAFT_EVENT,
  persistedSegmentsToComposer,
  sanitizePersistedTextSegmentForEdit,
} from './use-input-composer-edit-draft';
export type {
  ChatDraftWorkflowMeta,
  ChatEditDraftEventDetail,
  UseInputComposerEditDraftOptions,
} from './use-input-composer-edit-draft';

/** 用户气泡 segments 渲染（乐观 / history / 编辑同源） */
export {
  UserComposerSegmentsContent,
  UserComposerFileChip,
  UserWorkflowMessageTag,
  synthesizeComposerSegments,
  hydrateComposerSegmentsOnMessages,
  prepareGatewayTextForComposerSynth,
  serializePersistedComposerSegmentsToActionText,
  parseWorkflowRunDisplayText,
} from './user-composer-segments';
export type { WorkflowRunDisplayMeta } from './user-composer-segments';

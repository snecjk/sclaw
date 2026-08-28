/** Structured in-chat flow card — domain-agnostic block for multi-step copilot flows. */

export type FlowCardActionVariant = 'primary' | 'secondary';

/** Platform-known action kinds; skill supplies params. */
export type FlowCardActionKind =
  | 'composer.openFilePicker'
  | 'nav.openPreviewTab'
  | 'nav.refreshPreview'
  | 'nav.openExternal'
  | 'chat.sendMessage'
  | 'composer.setPhaseHint';

export interface FlowCardAction {
  id: string;
  label: string;
  variant?: FlowCardActionVariant;
  disabled?: boolean;
  kind: FlowCardActionKind;
  params?: Record<string, unknown>;
}

export interface FlowCardPayload {
  cardId: string;
  /** Business domain hint, e.g. `quote`. Skill-defined. */
  domain?: string;
  /** Skill-defined phase id, e.g. `awaiting_upload`. */
  phase: string;
  title?: string;
  body?: string;
  hint?: string;
  /** Skill-defined structured fields (quoteId, detailUrl, errorCount, …). */
  data?: Record<string, unknown>;
  actions?: FlowCardAction[];
}

export interface FlowCardContentBlock extends FlowCardPayload {
  type: 'flow_card';
}

export function isFlowCardContentBlock(value: unknown): value is FlowCardContentBlock {
  if (!value || typeof value !== 'object') return false;
  const block = value as FlowCardContentBlock;
  return block.type === 'flow_card' && typeof block.cardId === 'string' && typeof block.phase === 'string';
}

export function createFlowCardBlock(payload: FlowCardPayload): FlowCardContentBlock {
  return { type: 'flow_card', ...payload };
}

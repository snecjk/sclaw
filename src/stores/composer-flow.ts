import { create } from 'zustand';
import type { EmbedComposerAction } from '../../shared/embed-composer-actions';

export interface ComposerFilePickerRequest {
  requestId: string;
  accept?: string;
  multiple?: boolean;
  /** After files are staged, immediately send them (flow_card upload). */
  autoSend?: boolean;
  /** Optional message text when autoSend is true. */
  sendText?: string;
}

interface ComposerFlowState {
  activeScenarioId: string | null;
  phaseHint: string | null;
  filePickerRequest: ComposerFilePickerRequest | null;
  embedComposerActions: EmbedComposerAction[] | null;

  setActiveScenario: (id: string | null) => void;
  setPhaseHint: (hint: string | null) => void;
  requestFilePicker: (input?: {
    accept?: string;
    multiple?: boolean;
    autoSend?: boolean;
    sendText?: string;
  }) => string;
  consumeFilePickerRequest: (requestId: string) => ComposerFilePickerRequest | null;
  setEmbedComposerActions: (actions: EmbedComposerAction[] | null) => void;
}

export const useComposerFlowStore = create<ComposerFlowState>((set, get) => ({
  activeScenarioId: null,
  phaseHint: null,
  filePickerRequest: null,
  embedComposerActions: null,

  setActiveScenario: (id) => set({ activeScenarioId: id }),

  setPhaseHint: (hint) => set({ phaseHint: hint }),

  requestFilePicker: (input) => {
    const requestId = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set({
      filePickerRequest: {
        requestId,
        accept: input?.accept,
        multiple: input?.multiple ?? true,
        autoSend: input?.autoSend === true,
        sendText: typeof input?.sendText === 'string' ? input.sendText : undefined,
      },
    });
    return requestId;
  },

  consumeFilePickerRequest: (requestId) => {
    const current = get().filePickerRequest;
    if (!current || current.requestId !== requestId) return null;
    set({ filePickerRequest: null });
    return current;
  },

  setEmbedComposerActions: (actions) => set({ embedComposerActions: actions }),
}));

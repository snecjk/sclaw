import { create } from 'zustand';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';

export interface JsBridgeDialogState {
  kind: 'alert' | 'confirm';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (value: boolean) => void;
}

export interface ComposerSeedEntry {
  text: string;
  token: string;
  send: boolean;
  segments?: PersistedComposerSegment[];
}

interface ComposerSeedInput {
  text: string;
  segments?: PersistedComposerSegment[];
  send?: boolean;
}

interface JsBridgeHostState {
  dialog: JsBridgeDialogState | null;
  embedComposerSeedByRuntimeId: Record<string, ComposerSeedEntry>;
  mainComposerSeed: ComposerSeedEntry | null;

  showAlert: (input: Omit<JsBridgeDialogState, 'kind' | 'resolve' | 'cancelLabel' | 'destructive'>) => Promise<void>;
  showConfirm: (input: Omit<JsBridgeDialogState, 'kind' | 'resolve'>) => Promise<boolean>;
  closeDialog: (confirmed: boolean) => void;

  setEmbedComposerSeed: (runtimeId: string, input: ComposerSeedInput) => string;
  consumeEmbedComposerSeed: (runtimeId: string, token: string) => ComposerSeedEntry | null;

  setMainComposerSeed: (input: ComposerSeedInput) => string;
  consumeMainComposerSeed: (token: string) => ComposerSeedEntry | null;
  peekMainComposerSeed: () => ComposerSeedEntry | null;
}

function makeSeed(input: ComposerSeedInput): ComposerSeedEntry {
  return {
    text: input.text,
    segments: input.segments,
    token: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    send: input.send === true,
  };
}

export const useJsBridgeHostStore = create<JsBridgeHostState>((set, get) => ({
  dialog: null,
  embedComposerSeedByRuntimeId: {},
  mainComposerSeed: null,

  showAlert: (input) => new Promise((resolve) => {
    set({
      dialog: {
        kind: 'alert',
        title: input.title,
        message: input.message,
        confirmLabel: input.confirmLabel,
        resolve: () => resolve(),
      },
    });
  }),

  showConfirm: (input) => new Promise((resolve) => {
    set({
      dialog: {
        kind: 'confirm',
        title: input.title,
        message: input.message,
        confirmLabel: input.confirmLabel,
        cancelLabel: input.cancelLabel,
        destructive: input.destructive,
        resolve,
      },
    });
  }),

  closeDialog: (confirmed) => {
    const dialog = get().dialog;
    if (!dialog) return;
    set({ dialog: null });
    dialog.resolve(confirmed);
  },

  setEmbedComposerSeed: (runtimeId, input) => {
    const entry = makeSeed(input);
    set((state) => ({
      embedComposerSeedByRuntimeId: {
        ...state.embedComposerSeedByRuntimeId,
        [runtimeId]: entry,
      },
    }));
    return entry.token;
  },

  consumeEmbedComposerSeed: (runtimeId, token) => {
    const entry = get().embedComposerSeedByRuntimeId[runtimeId];
    if (!entry || entry.token !== token) return null;
    set((state) => {
      const next = { ...state.embedComposerSeedByRuntimeId };
      delete next[runtimeId];
      return { embedComposerSeedByRuntimeId: next };
    });
    return entry;
  },

  setMainComposerSeed: (input) => {
    const entry = makeSeed(input);
    set({ mainComposerSeed: entry });
    return entry.token;
  },

  consumeMainComposerSeed: (token) => {
    const entry = get().mainComposerSeed;
    if (!entry || entry.token !== token) return null;
    set({ mainComposerSeed: null });
    return entry;
  },

  peekMainComposerSeed: () => get().mainComposerSeed,
}));

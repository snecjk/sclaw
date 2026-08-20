import { create } from 'zustand';

export interface JsBridgeDialogState {
  kind: 'alert' | 'confirm';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (value: boolean) => void;
}

interface ComposerSeedEntry {
  text: string;
  token: string;
  send: boolean;
}

interface JsBridgeHostState {
  dialog: JsBridgeDialogState | null;
  embedComposerSeedByRuntimeId: Record<string, ComposerSeedEntry>;
  mainComposerSeed: ComposerSeedEntry | null;

  showAlert: (input: Omit<JsBridgeDialogState, 'kind' | 'resolve' | 'cancelLabel' | 'destructive'>) => Promise<void>;
  showConfirm: (input: Omit<JsBridgeDialogState, 'kind' | 'resolve'>) => Promise<boolean>;
  closeDialog: (confirmed: boolean) => void;

  setEmbedComposerSeed: (runtimeId: string, text: string, send?: boolean) => string;
  consumeEmbedComposerSeed: (runtimeId: string, token: string) => ComposerSeedEntry | null;

  setMainComposerSeed: (text: string, send?: boolean) => string;
  consumeMainComposerSeed: (token: string) => ComposerSeedEntry | null;
  peekMainComposerSeed: () => ComposerSeedEntry | null;
}

function makeSeed(text: string, send = false): ComposerSeedEntry {
  return {
    text,
    token: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    send,
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

  setEmbedComposerSeed: (runtimeId, text, send = false) => {
    const entry = makeSeed(text, send);
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

  setMainComposerSeed: (text, send = false) => {
    const entry = makeSeed(text, send);
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

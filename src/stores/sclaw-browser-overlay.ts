/**
 * Global SClaw in-app browser drawer state.
 * Keeps underlying page mounted so tab/scroll state is preserved on close.
 */
import { create } from 'zustand';

export interface SclawBrowserOverlaySession {
  url: string;
  title: string;
}

interface SclawBrowserOverlayState {
  session: SclawBrowserOverlaySession | null;
  open: (session: SclawBrowserOverlaySession) => void;
  close: () => void;
}

export const useSclawBrowserOverlayStore = create<SclawBrowserOverlayState>((set) => ({
  session: null,
  open: (session) => set({ session }),
  close: () => set({ session: null }),
}));

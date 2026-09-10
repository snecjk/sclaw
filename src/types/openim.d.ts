interface OpenIMRenderApi {
  subscribe: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  imMethodsInvoke: (method: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    openIMRenderApi?: OpenIMRenderApi;
  }
}

export {};

# Template: New Electron Main-Process Capability

Use this template when adding a new capability that requires Electron main-process functionality.

---

## 1. Main-Process Handler

Implement the core logic in the main process.

```ts
// electron/services/new-capability.ts
import { ipcMain } from 'electron';

export class NewCapabilityService {
  constructor() {
    this.registerIpcHandlers();
  }

  private registerIpcHandlers() {
    ipcMain.handle('new-capability:perform', async (_event, params) => {
      // Main-process implementation
      // This runs in the main process, NOT the renderer
      const result = await this.performAction(params);
      return result;
    });
  }

  private async performAction(params: unknown) {
    // Implementation
    return { success: true, data: params };
  }
}
```

## 2. IPC Channel Definition

Define the IPC channel contract in shared types.

```ts
// electron/shared/ipc-channels.ts
export interface IpcChannels {
  // ... existing channels
  'new-capability:perform': {
    request: { param1: string; param2: number };
    response: { success: boolean; data: unknown };
  };
}
```

## 3. Preload API Exposure

Expose the IPC channel to the renderer via preload script.

```ts
// electron/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  // ... existing APIs

  // NEVER expose raw ipcRenderer to renderer
  // Instead, expose typed methods:
  newCapabilityPerform: (params: unknown) =>
    ipcRenderer.invoke('new-capability:perform', params),
});
```

> **⚠️ CRITICAL**: Do NOT expose `ipcRenderer` directly to the renderer process.
> Always use `contextBridge.exposeInMainWorld` with typed method wrappers.

## 4. Renderer Host-API Wrapper

Create a typed wrapper in the host-api layer. This is the ONLY way renderer code should interact with main-process APIs.

```ts
// src/lib/host-api.ts
export const hostApi = {
  // ... existing APIs

  async newCapabilityPerform(params: { param1: string; param2: number }) {
    return window.electron.newCapabilityPerform(params);
  },
};
```

> **⚠️ CRITICAL**: Renderer code MUST NOT call `window.electron.ipcRenderer.invoke(...)` directly.
> All main-process interactions MUST go through `src/lib/host-api.ts` and `src/lib/api-client.ts`.

## 5. Type Definitions

Add renderer-side type declarations.

```ts
// src/types/electron.d.ts
interface Window {
  electron: {
    // ... existing APIs
    newCapabilityPerform: (params: { param1: string; param2: number }) => Promise<{
      success: boolean;
      data: unknown;
    }>;
  };
}
```

## 6. Service Registration

Register the new service in the main process initialization.

```ts
// electron/main/index.ts
import { NewCapabilityService } from '../services/new-capability';

function initializeServices() {
  // ... existing services
  new NewCapabilityService();
}
```

---

## Build & Test Checklist

- [ ] Run `pnpm run lint` and fix any issues
- [ ] Run `pnpm run typecheck` and fix any type errors
- [ ] Add unit tests for the main-process service
- [ ] If this change touches communication paths (gateway events, runtime send/receive, delivery, fallback), run:
  - `pnpm run comms:replay`
  - `pnpm run comms:compare`
- [ ] Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates

# Template: New Renderer Page

Use this template when adding a new page to the StoClaw application.

---

## 1. Route Registration

Register the new route in the application's router configuration.

```tsx
// src/App.tsx or router config
import { NewPage } from './pages/NewPage';

// Add route
<Route path="/new-page" element={<NewPage />} />
```

## 2. Page Component

Create the page component under `src/pages/`.

```tsx
// src/pages/NewPage/index.tsx
import { useEffect } from 'react';
import { useNewPageStore } from '@/stores/new-page';
import { hostApi } from '@/lib/host-api';

export function NewPage() {
  const { data, setData } = useNewPageStore();

  useEffect(() => {
    // Fetch initial data via host-api (NEVER call Gateway HTTP directly from renderer)
    hostApi.fetchNewPageData().then(setData);
  }, [setData]);

  return (
    <div className="p-4">
      <h1>New Page</h1>
      {/* Page content */}
    </div>
  );
}
```

## 3. Store Slice

Create a Zustand store for page state management.

```ts
// src/stores/new-page.ts
import { create } from 'zustand';

interface NewPageState {
  data: unknown;
  setData: (data: unknown) => void;
}

export const useNewPageStore = create<NewPageState>((set) => ({
  data: null,
  setData: (data) => set({ data }),
}));
```

## 4. Host-API Integration

Expose the new API through the host-api layer.

```ts
// src/lib/host-api.ts
export const hostApi = {
  // ... existing APIs

  async fetchNewPageData() {
    return window.electron.invoke('hostapi:fetch', {
      endpoint: '/new-page-data',
      method: 'GET',
    });
  },
};
```

> **⚠️ CRITICAL**: Renderer code MUST NOT call `fetch('http://127.0.0.1:18789/...')` directly.
> Always use Main-process proxy channels (`hostapi:fetch`, `gateway:httpProxy`).

## 5. Main-Process Handler (if needed)

If the page requires new main-process functionality:

```ts
// electron/main/ipc-handlers.ts
ipcMain.handle('new-page:action', async (_event, params) => {
  // Implementation
  return result;
});
```

## 6. Preload API Exposure (if needed)

```ts
// electron/preload/index.ts
contextBridge.exposeInMainWorld('electron', {
  // ... existing APIs
  invokeNewPageAction: (params) => ipcRenderer.invoke('new-page:action', params),
});
```

> **⚠️ CRITICAL**: Renderer code MUST NOT add new direct `window.electron.ipcRenderer.invoke(...)` calls.
> All backend calls MUST go through `src/lib/host-api.ts` and `src/lib/api-client.ts`.

---

## Build & Test Checklist

- [ ] Run `pnpm run lint` and fix any issues
- [ ] Run `pnpm run typecheck` and fix any type errors
- [ ] Add/update unit tests in `tests/unit/`
- [ ] If this change touches communication paths (gateway events, runtime send/receive, delivery, fallback), run:
  - `pnpm run comms:replay`
  - `pnpm run comms:compare`
- [ ] Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates

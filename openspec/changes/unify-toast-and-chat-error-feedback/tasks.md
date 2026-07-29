## 1. OpenSpec + MCP

- [x] Create change folder and proposal/design/specs
- [x] Record MCP toast/error measurements
- [x] Update proposal/design to minimal implementation direction

## 2. Global Toast (`notification-feedback`)

- [x] Add feedback tokens in `globals.css` (light + dark)
- [x] Add Sonner CSS overrides in `globals.css` with `.sto-global-toaster` namespace
- [x] Configure `<Toaster>` directly in `App.tsx` with sidebar-aware `calc()` positioning
- [x] Keep `/float-icon` boundary

## 3. Chat Error Card (`chat-error-feedback`)

- [x] Inline error card in `HomeMainConversation.tsx` (warning style, close button)
- [x] Confirm `/chat` redirect-only → skip Chat/index.tsx
- [x] HomeComposer has no error subscription

## 4. Cleanup

- [x] Delete `AppToaster.tsx`, `toast-anchor-geometry.ts`, `ChatErrorNotice.tsx`
- [x] Delete `data-toast-anchor` from `MainLayout.tsx`
- [x] Delete geometry CSS vars (`--sto-toast-center-x`, `--sto-toast-top`, `--sto-toast-max-width`)
- [x] Delete bound tests (`app-toaster.test.tsx`, `chat-error-notice.test.tsx`)
- [x] Remove glassmorphism toast override (replaced by design-spec overrides)

## 5. Verify

- [x] No stale references to deleted files
- [x] Lint clean on touched files

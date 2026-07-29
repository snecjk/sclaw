## 1. Spec & store foundation

- [x] 1.1 Define browser tab + shell state types (`home` | `browser`, `live` | `suspended` | `blank`) and URL normalize helper with unit tests — **Req:** Opening apps reuses tabs with the same URL; Live browser webviews are capped at five with suspend and reload
- [x] 1.2 Add Zustand store for App Plaza shell visibility, tab list, active tab id, LRU timestamps, and live-cap enforcement APIs — **Req:** Live browser webviews are capped at five with suspend and reload; App plaza shell stays mounted when leaving the route
- [x] 1.3 Wire open-or-focus API used by cards/banners (`openOrFocusAppPlazaBrowserTab`) replacing plaza-path `openInSclawBrowser` — **Req:** Opening apps reuses tabs with the same URL

## 2. Shell UI & home tab

- [x] 2.1 Mount `AppPlazaShell` at MainLayout level; sync visibility from `/more-apps` without unmounting — **Req:** App plaza shell stays mounted when leaving the route; Hidden shell does not intercept input
- [x] 2.2 Implement Chrome-like tab strip (Home fixed, closable browser tabs, add blank) with light/dark semantic tokens — **Req:** App plaza shell provides a fixed home tab and browser tabs; Dark mode tab strip readability
- [x] 2.3 Embed existing `MoreAppsPage` content as Home tab body without double chrome regressions — **Req:** Default home tab

## 3. Browser tabs, favorite, AI chat

- [x] 3.1 Render live browser tabs with existing `SclawBrowserFrame` / toolbar patterns; blank tab address submit creates live webview — **Req:** Open blank browser tab; Register runtime for new live tab
- [x] 3.2 Implement suspend LRU on 6th live and reload-on-reactivate for suspended tabs — **Req:** Sixth live tab suspends LRU; Reactivate suspended tab reloads
- [x] 3.3 Add favorite control → more-apps registry / My Apps without URL duplicates — **Req:** Browser tabs can be favorited into My Apps
- [x] 3.4 Bind side AI chat per live tab runtime; switch/suspend/close tear down correctly; bound apps retain chat collections — **Req:** Each browser tab supports side AI chat; Switch tab switches chat binding; Bound app keeps chat after tab close
- [x] 3.5 Classify ephemeral vs bound tabs; on ephemeral tab close purge embed chat index + best-effort `deleteSession`; on favorite promote identity and retain chats — **Req:** Ephemeral browser tabs purge side AI chat when closed without saving

## 4. Keep-alive & sidebar

- [x] 4.1 Stop Sidebar primary-nav from destroying App Plaza tabs on route change; only hide shell — **Req:** Sidebar navigation must not destroy the app plaza tab workspace
- [x] 4.2 Ensure hidden shell uses `display:none` (or equivalent) + `pointer-events: none` and clears focus — **Req:** Hidden shell does not intercept input; Navigate away to chat / Navigate back to app plaza

## 5. Validation & docs

- [x] 5.1 Unit tests: URL normalize/reuse, live cap + suspend/reload, favorite dedupe, shell visibility reducer — **Req:** (browser-tabs + shell-keepalive scenarios)
- [x] 5.2 Dark-mode verification on tab strip, address bar, favorite, suspended affordance (no light-only hardcodes) — **Req:** Dark mode tab strip readability; Dark mode keep-alive shell chrome remains consistent
- [x] 5.3 Run targeted unit tests for plaza shell / URL / more-apps / open-sclaw-browser (full typecheck blocked by pre-existing dist-electron gaps)
- [x] 5.4 Review READMEs — no App Plaza open/keep-alive section present; no doc update required

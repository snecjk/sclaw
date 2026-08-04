## ADDED Requirements

### Requirement: App plaza shell provides a fixed home tab and browser tabs
The system SHALL present the App Plaza workspace as a shell with a Chrome-like tab strip. The first tab MUST be a non-closable Home tab whose content is the existing App Plaza marketplace UI (market catalog and My Apps). The shell SHALL allow opening additional browser tabs to the right of Home, including a blank browser tab that accepts a user-entered URL.

#### Scenario: Default home tab
- **WHEN** the user navigates to the App Plaza route
- **THEN** the shell SHALL show the Home tab as selected
- **AND** the Home tab content SHALL be the App Plaza marketplace (including 应用广场 / 我的应用 content switching)
- **AND** the Home tab MUST NOT provide a close affordance

#### Scenario: Open blank browser tab
- **WHEN** the user activates the add-tab control
- **THEN** the shell SHALL append a blank browser tab after existing tabs
- **AND** the blank tab SHALL show an address field for URL entry
- **AND** the blank tab MUST NOT create a webview until a navigable URL is submitted

#### Scenario: Dark mode tab strip readability
- **WHEN** the application appearance is dark mode
- **THEN** the tab strip, selected tab, address field, and icon buttons SHALL use semantic theme tokens consistent with `docs/sto-design.md`
- **AND** text and focus/hover/selected states SHALL remain readable against the shell background

### Requirement: Opening apps reuses tabs with the same URL
The system SHALL normalize URLs before open-or-focus. When the normalized URL matches an existing browser tab, the system MUST activate that tab instead of creating a duplicate. When no match exists, the system SHALL create a new browser tab (subject to the live-tab limit).

#### Scenario: Reuse existing live tab
- **WHEN** the user opens an app or submits a URL whose normalized form matches an existing browser tab
- **THEN** the shell SHALL select that tab
- **AND** the system MUST NOT create an additional tab for the same normalized URL

#### Scenario: Open new tab when URL is new
- **WHEN** the user opens an app whose normalized URL does not match any browser tab
- **THEN** the shell SHALL create a new browser tab for that URL and select it

### Requirement: Live browser webviews are capped at five with suspend and reload
The system SHALL allow at most five browser tabs in the `live` state (webview mounted) at the same time. Home and blank tabs without a webview do not count toward this limit. When creating or resuscitating a tab would exceed five live webviews, the system MUST suspend the least-recently-used live browser tab that is not the tab being activated by destroying its webview while retaining tab metadata (url, title, app id). Activating a suspended tab MUST remount a webview and reload the retained URL.

#### Scenario: Sixth live tab suspends LRU
- **WHEN** five browser tabs are already `live` and the user opens a sixth distinct URL
- **THEN** the system SHALL suspend the least-recently-used live browser tab that is not the newly activated tab
- **AND** the suspended tab SHALL remain visible in the tab strip without an active webview

#### Scenario: Reactivate suspended tab reloads
- **WHEN** the user selects a suspended browser tab
- **THEN** the system SHALL remount a webview for that tab
- **AND** the webview SHALL navigate to the tab's retained URL (reload)
- **AND** if this would exceed five live webviews, the system SHALL suspend another least-recently-used live tab first

### Requirement: Browser tabs can be favorited into My Apps
The system SHALL provide a favorite control on browser tabs that persist the current page into My Apps using the existing more-apps registry (favorites and/or external apps). Favoriting an URL that already exists as an external or favorited catalog app MUST NOT create a duplicate entry.

#### Scenario: Favorite arbitrary URL
- **WHEN** the user favorites a browser tab whose URL is not yet in My Apps
- **THEN** the system SHALL persist it so it appears under 我的应用
- **AND** subsequent visits to App Plaza Home SHALL show that app in My Apps after registry refresh/hydrate

#### Scenario: Favorite existing app toggles state
- **WHEN** the user favorites a tab whose URL already maps to a catalog or external app in the registry
- **THEN** the system SHALL mark that app as favorited (or toggle off if already favorited) without creating a second registry row for the same URL

### Requirement: Each browser tab supports side AI chat
The system SHALL retain side AI chat for browser tabs. Each live browser tab MUST bind chat to its own embed runtime. Switching browser tabs SHALL present the chat association for the active tab. Suspending a tab MUST tear down that tab's embed runtime registration without deleting bound app chat history. Chat session collections MUST remain isolated per app identity (catalog / My Apps app id), matching the existing App Plaza embed-chat model.

#### Scenario: Open AI chat on active tab
- **WHEN** the user opens the side AI chat on the active live browser tab
- **THEN** the system SHALL attach chat to that tab's embed runtime and app identity
- **AND** chat sessions SHALL be listed in the context of that app identity

#### Scenario: Switch tab switches chat binding
- **WHEN** side AI chat is available and the user switches from browser tab A to browser tab B
- **THEN** the visible chat binding SHALL follow tab B's runtime/app identity
- **AND** tab A's page content SHALL remain mounted if tab A stays `live`

#### Scenario: Bound app keeps chat after tab close
- **WHEN** the user closes a browser tab whose app identity is a catalog app or an app already saved in My Apps
- **THEN** the system SHALL destroy that tab's webview and unregister its embed runtime
- **AND** the embed chat session collection for that app identity MUST remain available for a later open of the same app

### Requirement: Ephemeral browser tabs purge side AI chat when closed without saving
Browser tabs opened as blank or via a user-entered URL that is not saved into My Apps are ephemeral. Closing an ephemeral tab MUST purge that tab's temporary app-identity embed chat index and best-effort delete the underlying chat sessions. Suspending an ephemeral tab or hiding the App Plaza shell MUST NOT purge those sessions. Favoriting an ephemeral tab into My Apps MUST promote it to a bound app identity so subsequent tab closes retain the chat collection.

#### Scenario: Close unsaved custom-URL tab clears chat
- **WHEN** the user closes a browser tab for a custom URL that is not in My Apps
- **THEN** the system SHALL remove the ephemeral embed chat index for that temporary app identity
- **AND** the system SHALL best-effort delete each embed chat session created under that identity
- **AND** reopening the same URL later in a new ephemeral tab SHALL start with an empty chat session collection

#### Scenario: Suspend ephemeral tab keeps chat
- **WHEN** an ephemeral browser tab is suspended due to the live-tab limit
- **THEN** the system MUST NOT purge that tab's embed chat sessions solely because of suspension
- **AND** when the user reactivates the tab, side AI chat for that temporary identity SHALL still be available

#### Scenario: Favorite then close retains chat
- **WHEN** the user favorites an ephemeral custom-URL tab into My Apps and later closes that tab
- **THEN** the chat session collection SHALL remain under the bound My Apps identity
- **AND** opening that app again from My Apps SHALL be able to continue those sessions

### Requirement: Renderer uses host-api for embed browser host operations
The system SHALL perform embed-browser host operations (session prepare, runtime register/unregister, bridge ensure, and related host calls) through `src/lib/host-api.ts` / existing sclaw-browser host-api wrappers, not via new direct `window.electron.ipcRenderer.invoke` calls from pages or presentational components.

#### Scenario: Register runtime for new live tab
- **WHEN** a browser tab becomes `live` and requires an embed runtime
- **THEN** the client SHALL register the runtime through the existing sclaw-browser host-api path
- **AND** pages/components MUST NOT add new raw IPC invokes for that registration

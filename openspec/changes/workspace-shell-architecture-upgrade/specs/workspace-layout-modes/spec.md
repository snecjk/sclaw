## ADDED Requirements

### Requirement: PreviewMode is closed, split, or expanded inside the Workspace
Workbench preview layout SHALL use `PreviewMode = 'closed' | 'split' | 'expanded'`. Expanded mode SHALL occupy the L1 Workspace only. The Conversation subtree SHALL remain mounted (hidden/inert) so draft text, scrollTop, search, and message state are preserved. The system SHALL NOT use the DOM Fullscreen API, `position:fixed` viewport overlays, or unmounting Conversation to implement expanded.

#### Scenario: Open artifact enters split
- **WHEN** PreviewMode is `closed` and the user opens an artifact preview
- **THEN** PreviewMode SHALL become `split`

#### Scenario: Expand and restore
- **WHEN** PreviewMode is `split` and the user expands preview
- **THEN** PreviewMode SHALL become `expanded` and Conversation SHALL remain mounted but not visible/interactive
- **AND** when the user restores, PreviewMode SHALL return to `split` with the previous `previewSplitPercent`

#### Scenario: Close from expanded
- **WHEN** PreviewMode is `expanded` and the user closes preview
- **THEN** PreviewMode SHALL become `closed`
- **AND** no `requestFullscreen` / `fullscreenchange` path SHALL be required for this transition

### Requirement: Split boundary has zero structural seam and Body-only handle
In `split` mode, Header and Body SHALL share one Grid driven by `--sto-split-preview-col`. The middle track SHALL be `0px`. Chat pane right edge, OverlayScrollbar rail right edge, logical split boundary, and Preview left border SHALL coincide. The system SHALL NOT apply bilateral `10px` structural insets (`--sto-split-preview-inset-x` as seam), SHALL NOT use Handle `row-span-2`, and SHALL NOT `translate-x(10px)` the handle to compensate for seam. The resize handle SHALL be an overlay on the Preview side of the Body row only (engineering hit width 8px unless a later MCP node supersedes), default-transparent with a `#FFD6BA` 2px hint on hover/dragging/focus-visible.

#### Scenario: No 10px structural gutter
- **WHEN** PreviewMode is `split`
- **THEN** Chat and Preview SHALL NOT each reserve a `10px` structural inset that creates an empty gap between OverlayScrollbar and Preview border

#### Scenario: Handle geometry
- **WHEN** PreviewMode is `split`
- **THEN** the resize handle SHALL cover the Body row only
- **AND** it SHALL NOT span the Header row via `row-span-2`
- **AND** when PreviewMode is `closed` or `expanded`, the handle SHALL NOT render

### Requirement: ContentHeader slots are chatActions, previewActions, and layoutMode
ContentHeader registration SHALL expose `chatActions`, `previewActions`, and `layoutMode` (`conversation` | `split` | `preview-expanded`). After migration, the system SHALL NOT simultaneously retain `actions`, `panelActions`, and `previewActions` as three living semantics. A unidirectional compatibility adapter MAY exist only with an explicit removal deadline. `isSplitLayout` boolean-only API SHALL be replaced by `layoutMode` (or derived strictly from PreviewMode). Conversation, Split, and Preview Expanded SHALL share one stable ContentHeader DOM containing chat-header, sidebar/title, chat-actions, preview-tabs, and workspace-actions slots; mode changes SHALL alter Grid Area/visibility rather than return a different top-level template.

#### Scenario: Split header columns
- **WHEN** `layoutMode` is `split`
- **THEN** the chat header column SHALL end with `chatActions`
- **AND** the preview header column SHALL show `previewTabs` and `previewActions`

#### Scenario: Workspace action anchor across modes
- **WHEN** layoutMode changes between `conversation`, `split`, and `preview-expanded`
- **THEN** the preview/workspace layout action SHALL remain anchored `8px` from the Workspace right edge
- **AND** its horizontal position before and after a Split/Expanded transition SHALL differ by no more than `1px`

#### Scenario: Preview Expanded hides Conversation chrome
- **WHEN** layoutMode is `preview-expanded`
- **THEN** the Conversation title, Conversation search, Conversation refresh, and thinking toggle SHALL remain mounted but hidden and non-interactive
- **AND** Preview tabs SHALL occupy the available Header track after any Sidebar restore control

#### Scenario: Workspace layout actions use one stable order
- **WHEN** PreviewMode is `split` or `expanded`
- **THEN** the Workspace expand/restore action SHALL render immediately before the Preview panel open/close action in ContentHeader
- **AND** the Preview file action row SHALL NOT own the Workspace expand/restore action

#### Scenario: Naming consolidation
- **WHEN** callers are migrated
- **THEN** documentation and code SHALL treat `previewActions` as the preview-column action slot
- **AND** new code SHALL NOT add `panelActions` as a third parallel slot

### Requirement: Header chrome inset and Workbench body inset have separate ownership
The system SHALL keep macOS native-chrome avoidance within ContentHeader only. The collapsed macOS Header safe start SHALL be `76px`, producing an `8px ± 1px` clear gap from the native traffic-light group to the `28px` Sidebar restore control. Header start inset SHALL NOT be applied to the Workspace `main`, Split Body, Conversation Body, or Preview Expanded Body. Split Preview SHALL keep zero horizontal seam at its logical boundary. Preview Expanded SHALL use its own bilateral `12px` Workbench Surface inset, derived from approved design node `48:11093` (`1152px - 1128px = 24px`), and SHALL NOT inherit the collapsed macOS Header safe inset or the Split end-only inset Token.

#### Scenario: Collapsed macOS Preview Expanded
- **WHEN** the provincial Sidebar is collapsed on macOS and PreviewMode is `expanded`
- **THEN** ContentHeader controls SHALL avoid the native traffic lights
- **AND** the native traffic-light group to Sidebar restore-control clear gap SHALL be `8px ± 1px`
- **AND** the Sidebar restore control to Preview menu clear gap SHALL be `8px ± 1px`, owned only by the direct Header zone gap
- **AND** Preview Surface left and right insets from the Workspace Body SHALL each remain `12px ± 1px`, not the Header safe inset

#### Scenario: Visible-Sidebar Expanded Header aligns with Preview Surface
- **WHEN** the Sidebar is visible and PreviewMode is `expanded`
- **THEN** the Preview menu/tab group and the bordered Preview Surface SHALL share the same `12px ± 1px` start line from the Workspace
- **AND** the hidden Conversation Header zone SHALL remain mounted and inert while contributing `0px` layout width and `0px` inter-zone gap
- **AND** the implementation SHALL reuse the Expanded inset Token rather than add a negative margin or absolute-position correction

#### Scenario: Split seam remains zero
- **WHEN** PreviewMode is `split`
- **THEN** Header-only safe inset SHALL NOT change the logical Chat/Preview boundary
- **AND** OverlayScrollbar rail and Preview left border SHALL remain coincident within `1px`

#### Scenario: Dark-mode inset ownership
- **WHEN** light or dark theme renders collapsed Preview Expanded
- **THEN** both themes SHALL use the same Header-only safe inset and Body-owned Surface inset geometry
- **AND** neither theme SHALL add a mode-only background wedge or negative-margin compensation

### Requirement: Header compact controls are 28px and search expands without action reflow
Primary ContentHeader action boxes, Session/Artifact pills, the Header-owned Sidebar restore control, and the outer search surface SHALL use one authoritative `28px` control-height Token. Header SVG glyphs SHALL remain `16px` unless an existing business icon has an independently approved optical size. The expanded search surface SHALL be a transient no-drag overlay anchored to the search toggle and expanding toward the available chat-header space; it SHALL NOT enter normal Header Flex width and SHALL NOT change Header height, Split boundary, or sibling action positions. Keyboard behavior (Enter, Shift+Enter, Escape), focus, clear, and result navigation SHALL remain available.

#### Scenario: Search surface dimensions
- **WHEN** the user opens Header search
- **THEN** the outer search surface and its toggle box SHALL each equal `28px`
- **AND** the ContentHeader height SHALL remain `44px`

#### Scenario: Search does not move sibling actions
- **WHEN** Header search transitions between closed and open
- **THEN** refresh, thinking, and workspace layout action horizontal positions SHALL each change by no more than `1px`
- **AND** Preview tabs SHALL not be pushed across the logical Split boundary

#### Scenario: Search overlay owns pointer and keyboard interaction
- **WHEN** Header search transitions from closed to open inside the draggable ContentHeader
- **THEN** the complete search overlay SHALL be a `no-drag` interaction region
- **AND** the already-mounted input SHALL receive focus after the open state is committed
- **AND** typing, clear, close, Enter, Shift+Enter, and Escape SHALL remain operable without dragging the window

#### Scenario: Search dark-mode interaction
- **WHEN** Header search is open in dark theme
- **THEN** its background, border, text, focus, disabled, and hover states SHALL use semantic tokens consistent with `docs/sto-design.md`
- **AND** the geometry and keyboard behavior SHALL match light theme

#### Scenario: Header toggle state uses neutral paired glyphs
- **WHEN** the user toggles Thinking visibility, Preview Panel visibility, Workspace expanded mode, or Header search
- **THEN** the Header button SHALL NOT retain a primary-colored background or primary-colored glyph after activation
- **AND** Thinking, Preview Panel, and Workspace expanded mode SHALL use paired neutral glyphs to distinguish their states
- **AND** the expanded Search Surface SHALL distinguish the Search state without moving sibling actions
- **AND** hover, disabled, and `focus-visible` feedback SHALL remain available

### Requirement: ContentHeader never exposes a native horizontal scrollbar
ContentHeader and its chat-header and preview-tab slots SHALL NOT become visible horizontal Scroll Owners. Conversation titles SHALL truncate, Preview tab overflow SHALL remain available through the existing overflow menu, and the Header SHALL keep its authoritative height without a classic scrollbar gutter. This requirement SHALL use the same geometry in light and dark themes.

#### Scenario: Narrow Split Header does not reserve a scrollbar strip
- **WHEN** Split mode renders a long Conversation title and multiple Preview tabs in a narrow Workspace
- **THEN** ContentHeader SHALL show no native horizontal scrollbar
- **AND** no transparent `12px–15px` scrollbar strip SHALL cover or displace Header or Body content

### Requirement: Split Preview Surface keeps a Body-owned end inset
In Split mode, the Preview L2 bordered Surface SHALL preserve an additional `12px` end inset inside the Preview Body, separate from the Workspace L0 right Frame. With the approved `8px` Workspace right Frame, the bordered Preview Surface SHALL measure `20px ± 1px` from the window end edge. This Body-owned inset SHALL NOT alter the zero-width Chat/Preview seam, the Preview column percentage, the Body-only resize handle, ContentHeader action anchoring, or Preview Expanded geometry. Light and dark themes SHALL share this geometry and use semantic Surface tokens for border/background.

#### Scenario: Split Preview border keeps approved end distance
- **WHEN** PreviewMode is `split`
- **THEN** the Preview bordered Surface SHALL be `20px ± 1px` from the window end edge
- **AND** the Chat/Preview logical boundary and resize handle SHALL remain coincident within `1px`

#### Scenario: Preview Expanded does not inherit Split-only end inset
- **WHEN** PreviewMode is `expanded`
- **THEN** the Preview Surface SHALL use its independent bilateral `12px` expanded Workbench inset contract
- **AND** it SHALL NOT inherit the Split-only end inset Token or implement the two equal values as one shared mode-dependent rule

### Requirement: OverlayScrollbar is reused without rewrite
Split and expanded layout work SHALL reuse the existing OverlayScrollbar primitive (`overlay-scrollbar-surfaces`). Agents SHALL NOT copy or rewrite metrics/hook/component logic; only host/rail alignment may be adjusted to satisfy the zero-seam equality.

#### Scenario: Reuse on Home conversation
- **WHEN** Home conversation scrolls in `closed` or `split`
- **THEN** the existing `OverlayScrollbar` binding SHALL remain the scroll visual owner
- **AND** scroll follow / user-away semantics SHALL be preserved

#### Scenario: Dark-mode workbench chrome
- **WHEN** split or expanded layouts render in dark theme
- **THEN** Header icons, handle hint, and panel borders SHALL remain readable via semantic tokens
- **AND** light-only residual fills SHALL NOT remain on interactive chrome

### Requirement: ContentHeader vertical geometry is a single Token and centerline
Primary ContentHeader height SHALL be owned by one authoritative Token (`--sto-content-header-h` / `CONTENT_HEADER_HEIGHT_PX`). Conversation, Split, and Preview Expanded modes SHALL share the same Header height and the same window-space centerline. Header DOM SHALL keep `items-center` alignment; agents SHALL NOT restyle individual controls with `translate-y` / `top` offsets or rebuild Header structure to fake alignment.

Approved runtime geometry (Stage 3 re-acceptance, provincial AppShell):

| Quantity | Value | Notes |
| --- | --- | --- |
| Workspace top frame | `8px` | `--sto-shell-card-gap` |
| ContentHeader top | `8px` | after Workspace frame |
| ContentHeader height | `44px` | latest product acceptance; supersedes the earlier 52px MCP sample |
| ContentHeader centerY | `30px` | `8 + 44/2` |
| Header control centerY | `30px` | title / search / refresh / brain / tabs / layout; Δ ≤ 1px |
| Primary Header control height | `28px` | shared control Token; 16px SVG glyphs remain unchanged |

#### Scenario: Shared Header height and centerline across PreviewMode
- **WHEN** PreviewMode is `closed`, `split`, or `expanded`
- **THEN** ContentHeader height SHALL equal the approved Token (`44px`)
- **AND** the window-space Header centerY SHALL remain `30px` (Δ ≤ 1px across mode switches)

#### Scenario: Header DOM controls share one centerline
- **WHEN** ContentHeader renders title, search, refresh, thinking, preview tabs, and layout actions
- **THEN** each control's DOM centerY SHALL differ from ContentHeader centerY by at most `1px`
- **AND** the implementation SHALL NOT use per-control `translate-y` / absolute vertical offsets

### Requirement: macOS native chrome and Sidebar chrome use separate optical baselines
On macOS with `titleBarStyle: hiddenInset`, native traffic lights and the provincial Sidebar toggle SHALL use separately named optical-position metrics because they are measured from different coordinate owners. Latest runtime acceptance SHALL place native traffic lights at `{x:16,y:20}` and the provincial Sidebar chrome row toggle at a `16px` top inset with a `28px` click box. ContentHeader DOM controls SHALL use the independent 44px Header `items-center` contract. Agents SHALL NOT force native and Sidebar chrome onto the ContentHeader mathematical centerline, and SHALL NOT use per-icon `translate-y`, negative margins, or unexplained local offsets.

Approved optical calibration:

| Item | Value |
| --- | --- |
| Traffic light diameter (macOS points) | `12` |
| Superseded `trafficLightPosition.y` | `28` → light center ≈ `34` |
| Latest runtime accepted `trafficLightPosition.y` | `20` → light center ≈ `26` |
| Provincial Sidebar toggle top inset | `16px` |
| Provincial Sidebar toggle click box | `28px` |
| Calibrated `x` | keep `16` unless screenshot proves otherwise |

#### Scenario: macOS native and Sidebar chrome optical positions
- **WHEN** the provincial shell runs on macOS
- **THEN** `BrowserWindow.trafficLightPosition` SHALL equal `{x:16,y:20}`
- **AND** the expanded Sidebar chrome toggle SHALL use a `16px` top inset and `28px` click box while Header DOM controls remain flex-centered

### Requirement: Header-to-body spacing uses explicit mode-owned formulas
Vertical space from ContentHeader bottom to the first line of primary Conversation content SHALL use mode-owned formulas. Conversation, Split, and Preview Expanded SHALL each use a zero-gap Token between Header and their Surfaces. Conversation and Split Chat SHALL retain the independent `8px` content inset inside their scroll Surfaces. No path SHALL use accidental padding stacks, negative margin, translate, or clipping hacks:

```text
Conversation:
Header bottom → Body Surface     = CONVERSATION_HEADER_TO_SURFACE_GAP (0px)
Body Surface  → first content    = WORKBENCH_BODY_TO_CONTENT_INSET_Y (8px)
Total visual                     = 8px

Split:
Header bottom → both Surfaces    = SPLIT_HEADER_TO_SURFACE_GAP       (0px)
Chat Surface  → first content    = WORKBENCH_BODY_TO_CONTENT_INSET_Y (8px)
Total visual                     = 8px

Preview Expanded:
Header bottom → Preview Surface  = PREVIEW_EXPANDED_HEADER_TO_SURFACE_GAP (0px)
```

Conversation Body and Split Chat/Preview Body Row top padding SHALL map to their independently named zero-gap Tokens. Conversation and Split Chat scroll `padding-top` SHALL continue to map to the content inset Token. Preview Expanded SHALL preserve the bordered L2 Surface, its action row, and its viewer overflow owner while consuming only the Expanded zero-gap Token.

#### Scenario: Header-to-body spacing
- **WHEN** primary Conversation renders in `closed`
- **THEN** Header bottom to Body Surface SHALL equal `0px`
- **AND** Body Surface to the first content line SHALL equal `8px`
- **AND** Header bottom to the first content line SHALL equal `8px`

#### Scenario: Split Surfaces touch the 44px Header
- **WHEN** PreviewMode is `split`
- **THEN** both Chat Surface and bordered Preview Surface SHALL touch ContentHeader bottom within `1px`
- **AND** Chat Surface to the first content line SHALL equal `8px`
- **AND** neither Split Body column SHALL consume the Conversation outer gap Token

#### Scenario: Preview Expanded Surface touches the 44px Header
- **WHEN** PreviewMode is `expanded`
- **THEN** ContentHeader visual height SHALL remain `44px`
- **AND** the bordered Preview Surface top SHALL equal ContentHeader bottom within `1px`
- **AND** the Preview Surface, 46px action row, and viewer scroll/overflow structure SHALL remain mounted
- **AND** Conversation SHALL retain its independent `0px` Header-to-Surface gap
- **AND** Split SHALL retain its independent `0px` Header-to-Surface gap

### Requirement: Preview layout Surfaces share one bottom inset
Split Chat, Split Preview, and Preview Expanded SHALL consume one Body-owned `8px` bottom inset Token. The provincial Workspace SHALL continue to own its independent `8px` outer bottom Frame, producing a `16px` window-to-Surface-bottom total in these preview layouts. Mode changes SHALL NOT remove the Body-owned inset or replace it with per-mode padding literals.

#### Scenario: Split and Preview Expanded keep the same Surface bottom line
- **WHEN** PreviewMode changes between `split` and `expanded`
- **THEN** the active bordered Preview Surface SHALL remain `8px ± 1px` above the Workspace Body bottom
- **AND** its window-bottom distance SHALL remain `16px ± 1px` with the provincial `8px` Workspace Frame
- **AND** Split Chat SHALL use the same Body-owned bottom inset as Split Preview

#### Scenario: Bottom inset ownership has no legacy Split token
- **WHEN** preview layout classes are evaluated
- **THEN** Split Chat, Split Preview, and Preview Expanded SHALL consume the shared Workbench Surface bottom inset Token
- **AND** the implementation SHALL NOT retain `--sto-split-preview-inset-y`, per-mode `pb-*` literals, negative margins, or height compensation

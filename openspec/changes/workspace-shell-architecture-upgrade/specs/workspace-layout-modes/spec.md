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
ContentHeader registration SHALL expose `chatActions`, `previewActions`, and `layoutMode` (`conversation` | `split` | `preview-expanded`). After migration, the system SHALL NOT simultaneously retain `actions`, `panelActions`, and `previewActions` as three living semantics. A unidirectional compatibility adapter MAY exist only with an explicit removal deadline. `isSplitLayout` boolean-only API SHALL be replaced by `layoutMode` (or derived strictly from PreviewMode).

#### Scenario: Split header columns
- **WHEN** `layoutMode` is `split`
- **THEN** the chat header column SHALL end with `chatActions`
- **AND** the preview header column SHALL show `previewTabs` and `previewActions`

#### Scenario: Naming consolidation
- **WHEN** callers are migrated
- **THEN** documentation and code SHALL treat `previewActions` as the preview-column action slot
- **AND** new code SHALL NOT add `panelActions` as a third parallel slot

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
| ContentHeader height | `52px` | Token; MCP Header children also 52 |
| ContentHeader centerY | `34px` | `8 + 52/2` |
| Header control centerY | `34px` | title / search / refresh / brain / tabs / layout; Δ ≤ 1px |

#### Scenario: Shared Header height and centerline across PreviewMode
- **WHEN** PreviewMode is `closed`, `split`, or `expanded`
- **THEN** ContentHeader height SHALL equal the approved Token (`52px`)
- **AND** the window-space Header centerY SHALL remain `34px` (Δ ≤ 1px across mode switches)

#### Scenario: Header DOM controls share one centerline
- **WHEN** ContentHeader renders title, search, refresh, thinking, preview tabs, and layout actions
- **THEN** each control's DOM centerY SHALL differ from ContentHeader centerY by at most `1px`
- **AND** the implementation SHALL NOT use per-control `translate-y` / absolute vertical offsets

### Requirement: macOS traffic lights share the ContentHeader centerline
On macOS with `titleBarStyle: hiddenInset`, `trafficLightPosition` SHALL be derived from the ContentHeader centerline and the measured traffic-light diameter. Design MCP frames do not include native OS traffic lights; calibration SHALL use runtime geometry (and/or actual app screenshots). The vertical distance between traffic-light circle centers and ContentHeader centerY SHALL be ≤ `2px`. Agents SHALL NOT leave a hard-coded `{ x:16, y:18 }` that is unrelated to Header centerY.

Approved calibration (re-measure current `{x:16,y:18}` then fix):

| Item | Value |
| --- | --- |
| Traffic light diameter (macOS points) | `12` |
| Current `trafficLightPosition.y` | `18` → light center ≈ `24` |
| Current Δ vs Header centerY `34` | `10px` (fail) |
| Calibrated `y` | `34 - 12/2 = 28` → light center `34` |
| Calibrated `x` | keep `16` unless screenshot proves otherwise |

#### Scenario: macOS traffic lights centerline
- **WHEN** the provincial shell runs on macOS
- **THEN** `BrowserWindow.trafficLightPosition` SHALL place traffic-light centers within `2px` of ContentHeader centerY (`34px`)
- **AND** the chosen `{x,y}` SHALL be documented against the diameter + Header centerline formula (not an unexplained magic pair)

### Requirement: Header-to-body spacing uses one explicit formula
Vertical space from ContentHeader bottom to the first line of primary Conversation content SHALL follow one formula with two named gaps (no accidental stacking of unrelated paddings, no negative margin / translate / clip hacks):

```text
Header bottom → Body Surface     = WORKBENCH_HEADER_TO_BODY_GAP      (8px)
Body Surface  → first content    = WORKBENCH_BODY_TO_CONTENT_INSET_Y (8px)
Total visual                     = 16px
```

Split Body Row top padding and Conversation scroll `padding-top` SHALL map to these two Tokens respectively. The previous `8px + 16px = 24px` stack is forbidden.

#### Scenario: Header-to-body spacing
- **WHEN** primary Conversation renders in `closed` or `split`
- **THEN** Header bottom to Body Surface SHALL equal `8px`
- **AND** Body Surface to the first content line SHALL equal `8px`
- **AND** Header bottom to the first content line SHALL equal `16px`
- **AND** the same formula SHALL apply in Preview Expanded for the Preview body surface gap below Header

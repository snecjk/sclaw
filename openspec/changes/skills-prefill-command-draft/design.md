## Decisions

### 1. Keep the existing skill plaza navigation contract
- **Decision**: Skill cards and detail modals continue to call `newSession()` and navigate to `/?q=<prompt>`.
- **Rationale**: This preserves the current behavior that refreshes session context so newly installed skills are available.
- **Alternative considered**: Mutate the current composer directly from the skill plaza page. Rejected because the skill plaza is not the composer owner and would require cross-route UI state plumbing.

### 2. Interpret pure `q` links as composer drafts in Home
- **Decision**: Home stores a pure `q` query value in local draft state, clears the URL, and passes the draft to the existing Home composer seed path.
- **Rationale**: Home already owns the URL consumption and composer rendering, so the behavior stays local to the entry route.
- **Alternative considered**: Add a global draft store. Rejected because the behavior is a one-route handoff and does not need durable global state.

### 3. Preserve workflow deep-link auto-send when `workflowId` is present
- **Decision**: If both `q` and `workflowId` are present, Home keeps the existing auto-send path.
- **Rationale**: Workflow links are separate from skill use and may rely on immediate workflow execution.
- **Alternative considered**: Convert all `q` links to drafts. Rejected because it would broaden the behavior change beyond installed skill use.

### 4. Make editor seed consumption one-way
- **Decision**: `DingTalkMentionEditor` applies non-empty `seedText` values but does not clear editor content when the parent prop becomes empty.
- **Rationale**: URL cleanup must not erase a user-editable draft. Manual send and explicit editor clear paths still clear the editor through the component handle.
- **Alternative considered**: Add a new required seed object with a version key across every composer layer. Rejected as unnecessary for this scoped behavior.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Pure `q` links from non-skill sources no longer auto-send | Preserve auto-send for `q + workflowId`; pure `q` is treated as draft because the known current source is skill plaza use |
| Same seed text clicked repeatedly in one mounted editor may need re-application | Reset the last-applied seed marker when the parent seed becomes empty, allowing the same command to be consumed again |
| User draft could be overwritten by a new skill click | A new skill click is an explicit navigation/use action and should replace the draft in the newly created session |

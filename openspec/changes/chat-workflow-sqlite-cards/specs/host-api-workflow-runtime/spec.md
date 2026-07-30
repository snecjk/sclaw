## ADDED Requirements

### Requirement: Renderer accesses workflow runtime through host API boundaries
The renderer MUST register and query workflow chat cards through the shared API client/host boundary and MUST NOT access SQLite directly.

#### Scenario: Session card references are loaded
- **WHEN** the renderer enters a chat session
- **THEN** it SHALL call the workflow runtime host interface to list that session's visible card references

#### Scenario: A card snapshot is refreshed
- **WHEN** a mounted workflow card needs its latest state
- **THEN** it SHALL call the workflow runtime host interface for a compact SQLite snapshot

## ADDED Requirements

### Requirement: Project agent workspace is under `.sclaw`

The system SHALL point each project agent's OpenClaw workspace to `<projectRoot>/.sclaw`, not the project root.

#### Scenario: Ensure project agent

- **WHEN** a project agent is created or updated for project root `/path/to/app`
- **THEN** the agent workspace SHALL be `/path/to/app/.sclaw`
- **AND** `<projectRoot>/.sclaw/.claw-output` SHALL exist

### Requirement: Legacy root runtime files are migrated

The system SHALL migrate OpenClaw bootstrap files and `.claw-output` from the project root into `.sclaw` when ensuring the project agent.

#### Scenario: Migrate existing clutter

- **WHEN** `AGENTS.md` and `.claw-output/` exist at the project root and `.sclaw` does not yet contain them
- **THEN** ensuring the project agent SHALL move them under `.sclaw`

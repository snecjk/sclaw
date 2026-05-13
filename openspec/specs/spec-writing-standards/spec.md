## Purpose

Establish writing standards and formatting rules for all OpenSpec artifacts (proposal, design, spec, tasks) in the StoClaw project.

## Requirements

### Requirement: Proposal artifacts include all mandatory sections
Every proposal.md SHALL contain the sections Why, What Changes, Capabilities, and Impact.

#### Scenario: Reviewing a proposal
- **WHEN** an AI or human reviewer reads a proposal.md
- **THEN** all four mandatory sections SHALL be present and non-empty
- **AND** the Capabilities section SHALL distinguish between New Capabilities and Modified Capabilities with explicit lists

### Requirement: Design artifacts document decisions with rationale
Every design.md SHALL list key technical decisions, each with a clear rationale and at least one alternative considered.

#### Scenario: Evaluating a design decision
- **WHEN** a design.md describes a decision about state management
- **THEN** the document SHALL explain why the chosen approach is preferred
- **AND** the document SHALL mention at least one alternative that was considered and why it was rejected

### Requirement: Spec requirements use normative language and scenarios
Every requirement in a spec.md SHALL use SHALL or MUST for normative statements, and every requirement SHALL have at least one scenario using exactly four hashtag characters (`####`).

#### Scenario: Writing a requirement
- **WHEN** a spec author defines a new requirement
- **THEN** the requirement text SHALL contain at least one SHALL or MUST statement
- **AND** the requirement SHALL be followed by one or more `#### Scenario:` blocks

#### Scenario: Reviewing scenario formatting
- **WHEN** a reviewer inspects a spec.md scenario
- **THEN** the scenario header SHALL use exactly four hashtags (`#### Scenario: Name`)
- **AND** the scenario body SHALL use `- **WHEN**` and `- **THEN**` format

### Requirement: UI and shell theming specs align with STO design constitution
Any spec.md requirement that normatively defines user-visible colors, brand emphasis, status colors (success, warning, danger, info), or page/shell background and text hierarchy for the renderer SHALL be consistent with `docs/sto-design.md` and SHALL express colors using semantic token or Property language from that document (e.g., Brand-6 for primary emphasis, Grey-10 for default text, Danger for destructive actions) rather than unconstrained ad-hoc hex values, except when the requirement explicitly quotes canonical values from `docs/sto-design.md`.

#### Scenario: Authoring a page-level visual requirement
- **WHEN** a spec author adds a new requirement about a primary call-to-action color on a page
- **THEN** the requirement SHALL reference brand or semantic fill/text tokens aligned with `docs/sto-design.md`
- **AND** the requirement SHALL NOT mandate a random hex as the product primary without mapping it to the STO palette or documenting an approved exception in the same change’s design.md

#### Scenario: Reviewing a status or feedback color
- **WHEN** a requirement describes error, success, or warning presentation in the UI
- **THEN** the requirement SHALL map the intent to Danger, Success, or Warning semantics (or equivalent token names) as defined in `docs/sto-design.md`

### Requirement: Task artifacts reference corresponding specs
Every task in tasks.md SHALL explicitly reference the spec requirement it implements, using the requirement name or identifier.

#### Scenario: Tracing a task to its spec
- **WHEN** a developer reads a task in tasks.md
- **THEN** the task description SHALL contain a reference to the corresponding `### Requirement:` name from the spec.md
- **AND** the task SHALL be grouped under a heading that matches the capability name

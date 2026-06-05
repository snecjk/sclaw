## Purpose

Define the directory structure, naming conventions, and organizational rules for OpenSpec capabilities in the StoClaw project.

## Requirements

### Requirement: Capability names align with business modules
Each new capability SHALL be named after the StoClaw business module or user-facing feature it represents.

#### Scenario: Naming a chat-related capability
- **WHEN** a change introduces a new capability related to the Chat page
- **THEN** the capability name SHALL reference the business domain (e.g., `chat-message-sync`, `chat-file-attachment`) rather than the technical layer (e.g., `frontend-chat-component`, `chat-store-reducer`)

#### Scenario: Naming a settings-related capability
- **WHEN** a change modifies AI provider configuration in Settings
- **THEN** the capability name SHALL be `settings-ai-provider` or similar, directly mapping to the Settings page module

### Requirement: Spec files follow the canonical directory layout
Each capability SHALL have its spec file located at `specs/<capability-name>/spec.md` within the change directory.

#### Scenario: Creating a new capability spec
- **WHEN** a change introduces a new capability named `user-auth`
- **THEN** the system SHALL create the spec file at `openspec/changes/<change-name>/specs/user-auth/spec.md`

### Requirement: Cross-cutting capabilities use dedicated semantic names
Capabilities that span multiple business modules SHALL use a clear, descriptive name that indicates the cross-cutting concern, not a generic placeholder.

#### Scenario: Naming a cross-cutting capability
- **WHEN** a change affects both Chat and Channels with a shared real-time communication mechanism
- **THEN** the capability name SHALL describe the concern (e.g., `realtime-message-delivery`) rather than a list of modules (e.g., `chat-and-channels-update`)

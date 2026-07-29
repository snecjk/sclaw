## ADDED Requirements

### Requirement: Single error display above composer

The chat error (`useChatStore.error`) SHALL be displayed exactly once, above the chat input in `HomeMainConversation`. No other component on the home page SHALL subscribe to or render the same error.

#### Scenario: Error shown

- **WHEN** `useChatStore.error` is non-null
- **THEN** a warning-style card appears above the composer with the raw error text

#### Scenario: Error dismissed

- **WHEN** the user clicks the close button
- **THEN** `clearError()` is called and the card disappears

#### Scenario: No error

- **WHEN** `useChatStore.error` is null
- **THEN** no error card is rendered

### Requirement: No fabricated actions

The error card SHALL only display a warning icon, the raw error text, and a close button. No copy, retry, or other action buttons SHALL be shown unless the upstream data model provides them.

### Requirement: Visual spec

| property | value |
| --- | --- |
| background | `--sto-chat-error-bg` |
| border | `--sto-chat-error-border` |
| border-radius | 10px |
| padding | 8px |
| icon | 16px, color `--sto-chat-error-icon` |
| text | 13px / line-height 20px / `#1D2129` |
| close | 16px icon, top-right |

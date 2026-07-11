## Why

Installed skills in the skill plaza currently send their default prompt immediately after the user clicks "Use". Users need a chance to append task-specific details before sending, matching the Claude Code interaction pattern where a skill command is inserted into the composer first.

## What Changes

- Change installed skill "Use / Use now" behavior to prefill the Home composer with the skill default prompt
- Preserve the existing new-session behavior when a skill is used
- Keep skill usage counting and install/update behavior unchanged
- Keep workflow deep-link auto-send behavior unchanged when a workflow id is present

## Capabilities

### New Capabilities
<!-- No new capabilities -->

### Modified Capabilities
- `skills-marketplace`: Installed skill use now creates an editable composer draft instead of immediately sending a chat turn

## Impact

- `src/pages/Home/`: Convert pure `?q=` skill use links into one-time composer drafts
- `src/components/dingtalk/`: Preserve seeded draft text when URL cleanup clears the parent seed prop
- `src/components/skill-plaza/`: Existing navigation and usage tracking remain unchanged

## Context

The existing skill plaza entrypoints already create a new chat session and navigate to `/?q=<prompt>`. The Home page currently consumes that query parameter by waiting for the gateway to run, clearing the URL, and sending the message automatically. This change keeps the navigation contract but changes pure skill prompt links to draft insertion.

## Goals / Non-Goals

**Goals:**
- Let users edit or append to the skill command before sending
- Avoid duplicate draft insertion on refresh after URL cleanup
- Preserve the new-session behavior for skill use

**Non-Goals:**
- Changing skill install, update, enable, disable, or usage-count APIs
- Changing direct workflow execution or workflow deep-link behavior
- Adding new renderer-to-main IPC or Gateway transport paths

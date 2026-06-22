## ADDED Requirements

### Requirement: Workflow card exposes create scheduled task action
The system SHALL display a **创建定时任务** action on a terminal `WorkflowCard` when the run has a non-empty `workflowId`. The action SHALL appear adjacent to the existing **查看工作流** control in the same action row.

#### Scenario: Completed workflow shows create action
- **WHEN** a `WorkflowCard` is in a terminal status (`completed`, `failed`, or `timeout`) and `workflowId` is present
- **THEN** the card SHALL render **创建定时任务** next to **查看工作流**

#### Scenario: Running workflow hides create action
- **WHEN** a `WorkflowCard` status is `running` or `pending`
- **THEN** the card SHALL NOT render **创建定时任务**

#### Scenario: Missing workflow id hides create action
- **WHEN** a terminal `WorkflowCard` has no `workflowId`
- **THEN** the card SHALL NOT render **创建定时任务**

### Requirement: Create action opens existing local Cron modal
The system SHALL open the existing `CronTaskCreateModal` component (the same modal used on the Cron page) when the user clicks **创建定时任务** on a workflow card. The system MUST NOT introduce a new modal or form component for this flow.

#### Scenario: User clicks create scheduled task on card
- **WHEN** the user clicks **创建定时任务** for workflow instance `wf_2c200d96`
- **THEN** `CronTaskCreateModal` SHALL open in create mode
- **AND** the modal SHALL expose the existing fields: task name, execution engine, instructions, schedule, and recipients

#### Scenario: Instructions field is prefilled from workflow id
- **WHEN** `CronTaskCreateModal` opens from a workflow card for `workflowId` `wf_2c200d96`
- **THEN** the **让 STO Claw 帮你做什么…** field SHALL be prefilled with `执行 wf_2c200d96 工作流`
- **AND** the user MAY edit the prefilled text before saving

#### Scenario: Task name is not forced
- **WHEN** `CronTaskCreateModal` opens from a workflow card
- **THEN** the task name field MAY remain empty until the user fills it
- **AND** existing Cron validation for required task name SHALL still apply on save

### Requirement: Save uses existing OpenClaw local cron creation path
The system SHALL persist a task created from the workflow-card modal through the same OpenClaw local cron creation path used by the Cron page (`useCronStore.createJob` with `engineType: 'openclaw'`). The system MUST NOT call cloud Scheduled Tasks APIs for this entry point.

#### Scenario: User saves a prefilled workflow cron task
- **WHEN** the user completes required fields in `CronTaskCreateModal` opened from a workflow card and clicks **保存**
- **THEN** the system SHALL call the existing OpenClaw local cron `createJob` flow with the modal form values
- **AND** the created task message SHALL include the user-edited instructions text (defaulting to `执行 {workflowId} 工作流`)

#### Scenario: Save succeeds without leaving chat
- **WHEN** local cron task creation succeeds from the workflow-card modal
- **THEN** the system SHALL close the modal
- **AND** the system SHALL show a success toast
- **AND** the system SHALL NOT require navigation away from the current conversation

#### Scenario: Save failure keeps modal open
- **WHEN** local cron task creation fails (for example duplicate task name or Gateway unavailable)
- **THEN** the system SHALL keep `CronTaskCreateModal` open
- **AND** the system SHALL surface the existing Cron error feedback pattern (inline field error and/or toast)

### Requirement: Workflow card entry is available in chat surfaces
The workflow-card create-scheduled-task entry SHALL be wired in every chat surface that renders `WorkflowCard` today, including the Chat page and Home main conversation.

#### Scenario: Chat page supports workflow card cron entry
- **WHEN** the user views a terminal workflow card on the Chat page
- **THEN** clicking **创建定时任务** SHALL open `CronTaskCreateModal` with workflow-based prefilled instructions

#### Scenario: Home main conversation supports workflow card cron entry
- **WHEN** the user views a terminal workflow card in Home main conversation
- **THEN** clicking **创建定时任务** SHALL open `CronTaskCreateModal` with the same prefilled instructions behavior as the Chat page

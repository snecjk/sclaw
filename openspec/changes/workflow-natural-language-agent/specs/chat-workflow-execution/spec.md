## ADDED Requirements

### Requirement: Workflow creation and execution supports natural language flow
The system SHALL support creating and executing workflows through a natural language-driven flow, not only via slash commands.

#### Scenario: Natural language triggers full workflow chain
- **WHEN** user sends "帮我做一份总部结算对账表"
- **THEN** the system SHALL call `searchWorkflowTemplates("总部结算对账")`
- **THEN** upon matching template confirmation, the system SHALL call `getStartupSchema(templateId)`
- **THEN** the system SHALL display AI guidance with `parameter_form`
- **THEN** upon form confirmation, the system SHALL call `createWorkflow` and `startWorkflow`
- **THEN** the system SHALL display a `workflow_card` and start `WorkflowExecutionTracker`

#### Scenario: Workflow supports create-and-execute in one step
- **WHEN** user sends "创建并执行结算对账工作流"
- **THEN** after parameter confirmation, the system SHALL create the workflow and immediately execute it
- **THEN** the system SHALL NOT require a separate "执行" confirmation

### Requirement: System supports long-term workflow memory
The system SHALL remember created workflows so users can re-execute them without reconfiguring parameters.

#### Scenario: User re-executes a remembered workflow
- **WHEN** user sends "执行刚才的工作流" or "再跑一遍对账"
- **THEN** the system SHALL look up the most recent workflow in `workflow-memory` for the current session
- **THEN** if a workflow is found, the system SHALL call `startWorkflow` with the saved `workflowId` and `collectedInputs`
- **THEN** the system SHALL display the `workflow_card` and begin tracking

#### Scenario: User modifies parameters before re-execution
- **WHEN** user sends "修改对账周期为每周，然后执行"
- **THEN** the system SHALL load the remembered workflow
- **THEN** the system SHALL update `collectedInputs` with the new parameter value
- **THEN** the system SHALL call `startWorkflow` with the updated inputs

#### Scenario: Workflow memory expires
- **WHEN** user tries to re-execute a workflow whose memory record is older than 30 days
- **THEN** the system SHALL inform the user that the previous workflow has expired
- **THEN** the system SHALL prompt the user to create a new workflow

### Requirement: Concurrent workflow execution guard
The system SHALL prevent starting too many concurrent workflows in the same session.

#### Scenario: User tries to start workflow while at concurrency limit
- **WHEN** the current session already has 5 active (pending or running) workflows
- **THEN** the system SHALL reject the new workflow start
- **THEN** the system SHALL inform the user to wait for existing workflows to complete

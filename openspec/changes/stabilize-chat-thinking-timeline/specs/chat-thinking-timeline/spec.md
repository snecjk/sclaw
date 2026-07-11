## ADDED Requirements

### Requirement: Tool input preservation in streaming store

The chat runtime store SHALL preserve Anthropic `tool_use` / OpenAI tool call `input` (or `arguments`) when extracting tool status updates. Upsert merge SHALL NOT replace meaningful existing input with null, undefined, or empty object from later updates.

#### Scenario: tool_use block carries input

- **WHEN** an assistant message content block has `type: tool_use` with `input`
- **THEN** `streamingTools` for that toolCallId includes the same input payload

#### Scenario: tool_result after tool_use

- **WHEN** a tool completes via tool_result without input in the update
- **THEN** the prior tool_use input remains on the merged `streamingTools` entry

### Requirement: Done-turn tool source merge

Done-turn tool resolution SHALL merge module cache, assistant snapshot tool_use blocks, and cached tool_result rows. The resolver SHALL NOT return cache-only results when assistant messages contain higher-quality input for the same tool identity.

#### Scenario: cache placeholder vs message input

- **WHEN** cache holds a tool without input and turn messages contain the same toolCallId with input
- **THEN** resolved done tools use the message input

### Requirement: Tool card input state display

Tool call UI SHALL distinguish unknown/pending input from confirmed empty input. Running tools without input SHALL NOT display the「无参数」label.

#### Scenario: running tool awaiting input

- **WHEN** a tool card is `running` and input is not yet displayable
- **THEN** the UI shows loading or omits the params body instead of「无参数」

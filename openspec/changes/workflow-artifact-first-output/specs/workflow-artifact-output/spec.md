## ADDED Requirements

### Requirement: Models declare workspace artifacts without embedding file bodies

The workflow runtime SHALL allow a successful smart-node submission to declare zero or more artifacts using a node-relative `resourceId`. The runtime MUST NOT require a particular file extension or MIME type and MUST NOT persist file bodies in the canonical payload.

#### Scenario: Model chooses a deliverable format

- **WHEN** a task requires a file and the model writes a non-empty file inside its node workspace
- **THEN** the model declares the relative resource and the client records a canonical artifact without copying the body into payload

#### Scenario: Small data requires no file

- **WHEN** a task produces only payload strings of at most 1024 UTF-8 bytes and declares no artifacts
- **THEN** the runtime accepts the payload without manufacturing a result file

### Requirement: Client canonicalizes artifact metadata

The workflow runtime SHALL generate stable artifact identity, URI, size, default name, and inferred content type from each valid artifact draft before persistence or downstream delivery.

#### Scenario: Unknown file format

- **WHEN** a declared file extension has no known MIME mapping
- **THEN** the runtime preserves the file and assigns `application/octet-stream`

#### Scenario: Multiple declared files

- **WHEN** a node declares multiple valid OUTPUT or INTERMEDIATE files
- **THEN** the runtime canonicalizes and records every declared file exactly once

### Requirement: Artifact paths remain inside the node workspace

The workflow runtime MUST reject absolute paths, traversal paths, missing or empty files, directories, and symbolic links whose real path escapes the node workspace.

#### Scenario: Escaping artifact path

- **WHEN** an artifact draft resolves outside the node workspace
- **THEN** the node submission fails with a stable artifact validation diagnostic and no artifact is recorded

### Requirement: Large text is transferred as an artifact

The workflow runtime MUST reject any successful payload containing a string larger than 1024 UTF-8 bytes and SHALL allow the existing retry coordinator to request a file-backed result.

#### Scenario: Oversized inline text

- **WHEN** a successful payload contains a string larger than 1024 UTF-8 bytes
- **THEN** validation returns `RESULT_LARGE_TEXT_INLINE` and instructs the model to write and declare a file

### Requirement: Terminal output is format independent

The workflow runtime SHALL reuse upstream OUTPUT artifacts as final deliverables and MUST NOT create a second serialized result file when no explicit deliverable was declared.

#### Scenario: Upstream output artifact reaches completion

- **WHEN** a terminal output node receives one or more upstream OUTPUT artifacts
- **THEN** the same artifacts remain final outputs and no duplicate `result.json` or format-specific copy is created

### Requirement: Runtime prompts use the artifact-first contract

Claude and OpenClaw workflow prompts SHALL instruct models to choose task-appropriate formats, write files before declaring them, use relative resource IDs, and keep file bodies out of payload and final text.

#### Scenario: HTML requested by a legacy workflow

- **WHEN** an existing task requests HTML or has a legacy `payload.html` schema
- **THEN** the runtime requests an HTML file artifact and does not request or accept inline HTML

### Requirement: Run status responses are compact by default

The workflow runtime SHALL return only run status, compact node progress, applicable waiting-state data, final output, and preview-ready final artifact metadata by default. It MUST require an explicit detail or diagnostic view before reading or returning event timelines, raw node input/output, startup input, or agent raw text.

#### Scenario: Workflow status polling

- **WHEN** a tool or workflow card requests a run without an explicit view
- **THEN** the response omits events, tool invocation duplicates, raw node input/output, startup data, and empty optional fields

#### Scenario: Designer requests an execution timeline

- **WHEN** the Workflow Designer requests the detail view
- **THEN** the response includes event timeline data but still omits raw node input/output diagnostic payloads

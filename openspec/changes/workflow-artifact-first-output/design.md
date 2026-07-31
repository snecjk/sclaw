## Context

The runtime currently treats HTML as a special payload schema, then copies `payload.html` into a file while retaining the original field. The packet is subsequently persisted and synchronized several times. Existing workspace discovery also records every file, including undeclared temporary files.

## Goals / Non-Goals

**Goals:**
- Store and transfer one file body plus compact artifact metadata.
- Let the model choose zero, one, or multiple deliverable formats.
- Preserve strict workspace isolation and deterministic artifact identity.
- Keep Claude and OpenClaw canonical output behavior equivalent.

**Non-Goals:**
- Rendering or converting one file format into another.
- Adding extension, MIME, or file-size allowlists.
- Preserving `payload.html` consumers.
- Changing dependencies, packaging, or CI configuration.

## Decisions

### 1. Separate model artifact drafts from canonical artifact references

The model SHALL submit `resourceId` plus optional `kind`, `name`, and `contentType`. The client SHALL resolve and validate the file, then generate `artifactId`, `uri`, and `size` before the packet crosses the node boundary.

Rationale: the model cannot safely derive host paths or authoritative file metadata. Alternative considered: require the model to manufacture complete references; rejected because it permits inconsistent IDs and nonexistent files.

### 2. Register only declared files

The runtime SHALL stop recursively registering every workspace file. Only files declared in the packet artifacts array become workflow artifacts.

Rationale: temporary files are implementation details. Alternative considered: retain discovery as fallback; rejected because it makes delivery nondeterministic.

### 3. Apply one size rule without format restrictions

Payload strings larger than 1024 UTF-8 bytes SHALL fail submission validation with a retryable protocol error. Extensions and MIME values SHALL not be allowlisted; unknown types fall back to `application/octet-stream`.

Rationale: byte size drives context cost while format does not. Alternative considered: model-only judgment; rejected because it cannot guarantee bounded downstream context.

### 4. Reuse upstream OUTPUT artifacts at workflow completion

The terminal output node SHALL preserve upstream OUTPUT artifacts and SHALL NOT create a fallback result file for a small payload.

Rationale: terminal serialization recreates the duplication being removed. Alternative considered: retain `result.json`; rejected because artifact creation should be task-driven.

### 5. Separate compact status reads from diagnostic run reads

The runtime SHALL return a compact status view by default: run identity/status, compact node progress, waiting-state data when present, final output, and preview-ready artifacts. Event timelines and raw node input/output SHALL be loaded only by explicit detail or diagnostic views.

Rationale: status polling and workflow cards do not consume event payloads or duplicated tool invocation rows. Alternative considered: query the full run and trim it at the HTTP boundary; rejected because it preserves unnecessary SQLite reads and object construction.

## Risks / Trade-offs

- **[Risk]** Published workflows bind `payload.html`. → **Mitigation**: reject the obsolete binding with a stable diagnostic directing authors to consume the upstream artifact.
- **[Risk]** A declared path escapes the workspace through traversal or symlink. → **Mitigation**: resolve both workspace and file real paths, require a non-empty regular file, and reject paths outside the workspace.
- **[Risk]** A format has no preview support. → **Mitigation**: retain it as `application/octet-stream` and expose normal download/open behavior.
- **[Risk]** Explicit readonly/tool restrictions prevent required file creation. → **Mitigation**: preserve the restriction and return a deterministic failure rather than widening permissions.
- **[Risk]** The Workflow Designer loses its execution timeline when status responses become compact. → **Mitigation**: make the Designer explicitly request the detail view while cards and tools retain the default status view.

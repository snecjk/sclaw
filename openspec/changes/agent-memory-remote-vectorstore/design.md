## Context

sto-claw uses mem0's TypeScript OSS custom VectorStore contract. Semantic retrieval already delegates to memory-center and DashVector, while `keywordSearch` is unimplemented. Mem0 owns keyword-score normalization and hybrid ranking.

## Goals / Non-Goals

**Goals:**
- Return raw Elasticsearch BM25 results through `keywordSearch`
- Keep authenticated user and app isolation identical across vector and keyword retrieval
- Maintain the Elasticsearch secondary index from existing write/delete calls
- Degrade to semantic retrieval when keyword retrieval fails

**Non-Goals:**
- Moving dense vectors from DashVector to Elasticsearch
- Changing mem0 `infer:true` add-time duplicate lookup
- Adding renderer controls or an administration UI
- Creating or modifying the Elasticsearch index mapping

## Decisions

### 1. Keep DashVector and Elasticsearch as separate retrieval channels
- **Decision**: `search()` continues to use DashVector and `keywordSearch()` uses Elasticsearch.
- **Rationale**: This matches mem0's custom VectorStore hybrid contract and limits the migration to keyword retrieval.
- **Alternative considered**: Move both dense vector and keyword retrieval to Elasticsearch. Rejected because it expands migration and rollback risk without being required for keyword search.

### 2. Maintain Elasticsearch behind existing write/delete APIs
- **Decision**: memory-center synchronizes Elasticsearch after successful DashVector upsert/delete operations.
- **Rationale**: Callers cannot accidentally update only one retrieval store, and sto-claw's write contract remains stable.
- **Alternative considered**: Add separate public ES write APIs and call both from sto-claw. Rejected because partial client failures would be harder to repair.

### 3. Treat Elasticsearch as a secondary index
- **Decision**: Elasticsearch synchronization failures are logged but do not fail a completed DashVector mutation.
- **Rationale**: Retrying a completed mem0 add can create a new memory id and amplify duplicate records.
- **Alternative considered**: Make dual-write atomic from the API caller's perspective. Rejected because the two external stores have no shared transaction.

### 4. Use the existing HTTP client dependency
- **Decision**: memory-center calls Elasticsearch 8.x REST APIs through `httpx`.
- **Rationale**: The repository already depends on `httpx`, and no Elasticsearch SDK is present in the current branch.
- **Alternative considered**: Add the official Python Elasticsearch client. Deferred because it requires dependency review and is not necessary for the small API surface.

## Risks / Trade-offs

- [Risk] Elasticsearch can temporarily lag successful vector writes → Mitigation: semantic retrieval remains available and synchronization failures are observable for replay/backfill.
- [Risk] Stale ES documents can remain after a failed delete → Mitigation: scope every query by authenticated owner/app/collection and provide collection-level repair/delete operations.
- [Risk] Index analyzer changes require reindexing → Mitigation: address the index through a configurable alias rather than creating it at runtime.

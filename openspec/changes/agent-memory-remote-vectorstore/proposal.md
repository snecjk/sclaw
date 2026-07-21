## Why

The custom mem0 vector provider currently returns no keyword results, so mem0 V3 hybrid retrieval is effectively semantic-only. Agent Memory needs an authenticated Elasticsearch BM25 channel while retaining DashVector for semantic retrieval.

## What Changes

- Implement the custom provider's `keywordSearch` method through memory-center
- Add an authenticated memory-center keyword-search API backed by Elasticsearch 8.x
- Synchronize existing memory upsert, update, delete, and collection-delete operations to the keyword index
- Preserve semantic-only fallback when Elasticsearch is unavailable

## Capabilities

### New Capabilities

- `service-agent-memory-hybrid-retrieval`: Elasticsearch keyword retrieval combined with the existing remote semantic vector provider

### Modified Capabilities

- `agent-memory-remote-vectorstore`: Existing remote memory writes and deletes also maintain the keyword index

## Impact

- `electron/services/mem0-custom-providers.ts`
- `electron/services/agent-memory-remote-service.ts`
- memory-center Agent Memory schemas, route, service, configuration, and Elasticsearch adapter
- No renderer or user-visible theme changes

## ADDED Requirements

### Requirement: Custom vector provider supplies keyword results
The custom mem0 VectorStore SHALL send keyword queries to memory-center and SHALL return the raw keyword score and rehydrated memory payload to mem0.

#### Scenario: Keyword query succeeds
- **WHEN** mem0 invokes `keywordSearch` with a query, filters, and topK
- **THEN** sto-claw SHALL call the authenticated memory-center keyword endpoint and return matching VectorStore results

#### Scenario: Keyword query has no matches
- **WHEN** memory-center returns no Elasticsearch hits
- **THEN** sto-claw SHALL return an empty result array

### Requirement: Keyword retrieval preserves authenticated scope
The memory-center keyword API MUST use the authenticated owner as the authoritative user scope and MUST filter by app and logical collection.

#### Scenario: Request attempts to select another user
- **WHEN** a keyword request is handled for an authenticated owner
- **THEN** Elasticsearch filtering MUST use the authenticated owner and MUST NOT accept a caller-selected user as authorization input

### Requirement: Memory mutations maintain the keyword index
Successful memory upserts, updates, deletes, and logical collection deletes SHALL also update the Elasticsearch keyword index using the same record id and logical scope.

#### Scenario: Existing memory is updated
- **WHEN** DashVector successfully upserts an existing record id
- **THEN** memory-center SHALL index the latest text and metadata under the same Elasticsearch document id

#### Scenario: Memory is deleted
- **WHEN** DashVector successfully deletes an authenticated owner's memory
- **THEN** memory-center SHALL delete the corresponding Elasticsearch document within the same owner, app, and collection scope

### Requirement: Keyword index failure does not repeat primary writes
The system MUST retain a successful DashVector mutation when Elasticsearch secondary-index synchronization fails.

#### Scenario: Elasticsearch fails after vector upsert
- **WHEN** DashVector has accepted a memory and Elasticsearch synchronization fails
- **THEN** memory-center SHALL return the successful primary mutation result and SHALL log the secondary-index failure

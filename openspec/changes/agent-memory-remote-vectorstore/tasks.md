## 1. Backend Contract

- [x] 1.1 Add the keyword search schema and authenticated route for `Keyword retrieval preserves authenticated scope`
- [x] 1.2 Add configurable Elasticsearch connection and index settings for `Custom vector provider supplies keyword results`

## 2. Backend Storage Integration

- [x] 2.1 Implement raw BM25 search/result mapping for `Custom vector provider supplies keyword results`
- [x] 2.2 Synchronize upsert/delete/delete-col for `Memory mutations maintain the keyword index`
- [x] 2.3 Preserve successful vector mutations on ES errors for `Keyword index failure does not repeat primary writes`

## 3. sto-claw Integration

- [x] 3.1 Add the remote keyword-search client for `Custom vector provider supplies keyword results`
- [x] 3.2 Implement mem0 `keywordSearch` payload rehydration for `Custom vector provider supplies keyword results`

## 4. Verification and Documentation

- [x] 4.1 Add backend contract and adapter tests for `Keyword retrieval preserves authenticated scope`
- [x] 4.2 Add sto-claw provider tests for `Custom vector provider supplies keyword results`
- [x] 4.3 Run targeted backend tests and sto-claw typecheck for all requirements
- [x] 4.4 Review README files for documentation impact for all requirements; no user-facing documentation change is required

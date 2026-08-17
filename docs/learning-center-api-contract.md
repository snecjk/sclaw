# Learning Center Client API Contract

This document records the `memory-center` contract consumed by the sto-claw
learning center. Renderer code must call these routes through `hostApiFetch`;
it must not call memory-center or OSS directly.

## Envelope

All JSON requests use `POST` and wrap business parameters in `{ "data": ... }`.
Successful responses use:

```json
{ "success": true, "data": {} }
```

Business failures use `success: false` with `errCode` and `errMessage`. Transport
failures can be thrown by `hostApiFetch` before an envelope reaches the adapter.

Paged data has `items`, `total`, `pageNum`, and `pageSize`. The client accepts
snake_case aliases and legacy `records`/`list` only at the adapter boundary.

## Routes

| Route | Request data | Response data |
| --- | --- | --- |
| `/api/learning-center/domain/page` | `pageNum`, `pageSize` | paged domains |
| `/api/learning-center/category/page` | `domainId`, `pageNum`, `pageSize` | paged categories |
| `/api/learning-center/tutorial/page` | `categoryId`, `pageNum`, `pageSize` | paged tutorials |
| `/api/learning-center/case-template/page` | `categoryId`, `pageNum`, `pageSize` | paged case templates |
| `/api/learning-center/tutorial/detail` | `tutorialId` | tutorial detail |
| `/api/learning-center/case-template/detail` | `caseId` | case detail plus `tutorial`/`tutorials` |
| `/api/learning-center/case-template/use` | `caseId` | action and authoritative `useCount` |

The use response supports target types `SKILL`, `CONNECTOR`, `APP`, `WORKFLOW`,
`URL`, and `CHAT`, with prompt modes `REPLACE` and `APPEND`. Unknown values are
normalized to `UNKNOWN` and must not be dispatched.

## ID precision

All resource IDs are strings in sto-claw ViewModels and request payloads. The
adapter accepts numeric IDs only when `Number.isSafeInteger` is true. An unsafe
numeric response is rejected because precision has already been lost by JSON
parsing and silently converting it to a string could address the wrong resource.

`memory-center` currently declares these response fields as Python `int`, so
Snowflake-sized IDs must be serialized as JSON strings by the service contract
before production rollout. The client already accepts that forward-compatible
shape; changing the backend serializer is tracked separately from this frontend
implementation scope.

## Client ownership boundary

sto-claw does not calculate visibility, authorization ancestry, use counts,
managed object keys, or signed OSS URLs. It displays the service response and
re-requests detail when a signed image URL needs refreshing.

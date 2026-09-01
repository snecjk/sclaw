---
name: pkg-fastapi
description: FastAPI 与接口文档、action 契约对齐。
---

# FastAPI

1. 新增/变更接口后同步 `docs/api/`。
2. 前端通过 `action-registry` 的 actionId 调用，不写死 URL 到 page JSON。
3. 响应字段与契约一致，禁止臆造字段。

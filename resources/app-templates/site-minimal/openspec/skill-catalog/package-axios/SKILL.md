---
name: package-axios
description: Axios HTTP 客户端在 SClaw 用户应用中的 AI 使用约定
---

# Axios（选装包）

## 何时使用

需要在宿主或 Catalog 实现里发 HTTP 请求时使用 axios。

## 必须遵守

1. 先读 `docs/api/` 与 `contracts/action-registry.v1.json`
2. 页面交互优先走 **actionId**，由 Action Runtime 调接口；不要在 `src/pages/*.page.json` 里写死 URL
3. 禁止臆造 path、method、字段名
4. 鉴权方式以接口文档为准，禁止把密钥写进仓库

## 推荐写法（实现层）

```ts
import axios from 'axios';
// baseURL / headers 从环境或契约读取，不要硬编码生产密钥
```

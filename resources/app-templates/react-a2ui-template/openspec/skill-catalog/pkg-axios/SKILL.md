---
name: pkg-axios
description: 在 A2UI 应用中使用 axios 对接接口的约束。
---

# Axios（选装包 AI 用法）

## 何时用

需要在 Action Runtime / Catalog 实现里发 HTTP 请求时。

## 必须遵守

1. 页面与业务交互优先走 `contracts/action-registry.v1.json` 的 `actionId`。
2. **禁止**在 `src/pages/*.page.json` 里写死后端 URL。
3. 真实 URL、method、字段以 `docs/api/` 为准；没有文档先补文档再写调用。
4. axios 实例可放在 `src/runtime/` 或后续 `src/lib/http.ts`，由 action executor / Catalog 调用。

## 推荐流程

用户说「调某个接口」→ 更新 `docs/api` + `action-registry` → 如需真实请求再在 executor 里用 axios → 页面 Button 只引用 `actionId`。

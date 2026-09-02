---
name: pkg-policy-ontology-sdk
description: 在托管应用中通过受控 Operation 使用 STO Policy Ontology 数据能力。
---

# STO Policy Ontology SDK

## 何时使用

当托管应用需要查询 STO Policy Ontology 的对象、关系、指标或只读函数时使用。

## 必须遵守

1. 页面和业务组件只调用稳定的 `operationId`，具体 Operation 使用 `definePolicyOperation()` 定义。
2. Operation 只声明业务参数、固定 Policy Action 和请求构造逻辑；禁止接受任意 Host、Path、Method 或 Header。
3. `policyOrigin` 和 `stoToken` 必须由应用基础设施注入，禁止写入源码、页面 JSON、URL、日志或持久化存储。
4. 本地开发使用同源代理；不得在页面代码中直接请求 `https://*.sto.cn`。
5. 托管应用不得自行执行 Site SSO 跳转；身份来自可信外层宿主或本地 SClaw 会话。
6. 处理 `StoPolicySdkError` 时只展示安全错误信息，并保留 `traceId` 用于排障。

## 推荐流程

先确认真实 Ontology Schema 和查询合同，再定义 Operation、注册到 SDK、由页面通过 `operationId` 调用，最后验证加载、空结果、权限失败、超时和异常响应。

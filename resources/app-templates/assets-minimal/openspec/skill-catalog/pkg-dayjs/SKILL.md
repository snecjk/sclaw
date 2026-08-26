---
name: pkg-dayjs
description: 在 A2UI 应用中使用 dayjs 的约束。
---

# Day.js（选装包 AI 用法）

## 何时用

需要在 Catalog 组件或 Action 结果格式化里处理日期时间。

## 必须遵守

1. 页面展示文案仍通过 A2UI data model 绑定；不要为了改时间格式去手写整页 JSX。
2. 格式化逻辑放在 Catalog / runtime，而不是散落在多个 page JSON。
3. 时区与展示格式与产品约定一致；不确定时先问用户。

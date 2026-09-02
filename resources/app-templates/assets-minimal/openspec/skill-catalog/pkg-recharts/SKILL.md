---
name: pkg-recharts
description: Recharts 必须先 Catalog 化再进入页面。
---

# Recharts（选装包 AI 用法）

## 必须遵守

1. **禁止**在 `src/pages/*.page.json` 直接写 Recharts 组件名。
2. 先在 `src/catalog/` 封装收敛 props 的图表组件，注册进 MessageProcessor Catalog。
3. 页面只引用已注册的 `component` 名；数据走 data model / action。
4. 封装时可借助官方文档；不要把演示页 JSX 整页贴进业务应用。

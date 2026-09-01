---
name: pkg-antd
description: Ant Design Catalog 已接入；查询/列表页应优先使用 Antd* 组件。
---

# Ant Design（选装包 AI 用法）

## 目标

用户装 antd / 模板已带 antd Catalog，是为了让 AI **自动**用企业级查询页能力（筛选、表格、分页），用户不必口头说「用 antd」。

## 已注册组件（catalogId: `antd`）

| 组件 | 用途 |
|---|---|
| `AntdFilterBar` | 关键词 + 查询按钮 |
| `AntdTable` | 表格（columns / dataSource） |
| `AntdPagination` | 分页 |
| `AntdButton` | 按钮 |
| `AntdInput` | 输入框 |
| `AntdText` | 标题/文本 |
| `AntdStack` | 纵向布局（antd 页代替 Column） |

参考实现：`src/catalog/antd-catalog.tsx`  
参考页面：`src/pages/customer-list.page.json`

## 用户说「做查询页 / 列表 / 表格 / 分页」时

1. **必须** `createSurface.catalogId = "antd"`（或短名 antd）
2. **必须** 组合 `AntdFilterBar` + `AntdTable` + `AntdPagination`
3. 使用 A2UI v0.9 消息数组，**禁止** `{ type, props }` 伪格式
4. 同一 surface **不要**混用 basic 的 `Column`/`Text`

## 禁止

- 禁止说「还不能用 antd Table」（Catalog 已有 `AntdTable`）
- 禁止在 page JSON 写原生 antd 名如 `Table`/`Form`（要用 `AntdTable`）
- 禁止改成自由 JSX 业务页主路径

# Catalog

已启用 **antd Catalog**（`src/catalog/antd-catalog.tsx`），与 A2UI `basicCatalog` 并存。

| catalogId | 用途 |
|---|---|
| `basic` | 简单说明页、布局实验 |
| `antd` | **查询/列表/表格/分页**（AI 默认应走这里） |

查询页组件：`AntdFilterBar`、`AntdTable`、`AntdPagination`、`AntdStack`、`AntdText`、`AntdButton`、`AntdStatCard`。
搭建规范：`contracts/component-builder.v1.json`。模块片段：`src/catalog/modules/`。

示例：`src/pages/customer-list.page.json`。

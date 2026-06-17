# StoClaw 工作流查询 API 调用梳理

> 最后更新：2026-06-17

仅梳理「查询工作流模板列表」和「查询工作流列表」两类调用。

---

## 一、查询工作流模板列表

### 后端 API

| FastAPI 端点 | 方法 | 涉及的数据表 | 说明 |
|-------------|------|-------------|------|
| `/agent/v1/workflow-templates` | POST | `workflow_template` | 分页查询系统/官方推荐模板（按 site_visible + scope 过滤） |
| `/agent/v1/workflow-templates/mine` | POST | `workflow_template` | 分页查询当前用户可见模板（系统 + 个人），按 site_visible + scope 过滤 |
| `/agent/v1/workflow-templates/search` | POST | `workflow_template` | 关键词搜索模板，按 site_visible + scope 过滤 |

### Renderer 前端调用处

| 文件 | 函数 / 调用 | 后端 API | 调用方式 |
|------|------------|---------|---------|
| `src/lib/workflow-api.ts` | `listWorkflowTemplates()` | `POST /agent/v1/workflow-templates` | `hostApiFetch` |
| `src/lib/workflow-api.ts` | `searchWorkflowTemplates()` | `POST /agent/v1/workflow-templates`（封装 listWorkflowTemplates） | `hostApiFetch` |
| `src/stores/workflows.ts` | `loadTemplates()` / `prefetchTemplates()` | `POST /agent/v1/workflow-templates` | 经 `workflow-api.ts` |
| `src/pages/Workflow/use-workflow-list.ts` | `hostApiFetch('/api/workflow-templates/mine')` | `POST /agent/v1/workflow-templates/mine`（经 playground route 代理） | `hostApiFetch` |
| `src/pages/Workflow/use-workflow-list.ts` | `listWorkflowTemplates()` | `POST /agent/v1/workflow-templates` | `hostApiFetch` |

### Electron 主进程调用处

| 文件 | 路由 / 方法 | 后端 API | 说明 |
|------|------------|---------|------|
| `electron/api/routes/workflows.ts` | `POST /agent/v1/workflow-templates` 代理 | `POST /agent/v1/workflow-templates` | 代理转发到后端 |
| `electron/api/routes/workflow-playground.ts` | `GET /api/workflow-templates/mine` | `POST /agent/v1/workflow-templates/mine` | 内部 API，供列表页使用 |
| `electron/services/workflow-service.ts` | `fetchMineTemplates()` | `POST {baseUrl}/agent/v1/workflow-templates/mine` | 拉取个人可见模板 |

### sto-workflow-tool 插件

| Tool 名称 | 后端 API |
|-----------|---------|
| `search_workflow_templates` | `POST /agent/v1/workflow-templates` |

---

## 二、查询工作流列表

### 后端 API

| FastAPI 端点 | 方法 | 涉及的数据表 | 说明 |
|-------------|------|-------------|------|
| `/agent/v1/workflows/page` | POST | `workflow` | 分页查询用户的工作流列表 |
| `/agent/v1/my-workflow` | GET | `workflow` | 获取当前用户所有工作流（不分页） |

### Electron 主进程调用处

| 文件 | 路由 / 方法 | 后端 API | 说明 |
|------|------------|---------|------|
| `electron/api/routes/workflow-playground.ts` | `GET /api/workflows?keyword=` | `POST /agent/v1/workflows/page`（自动翻页聚合） | 获取用户全部工作流 |
| `electron/api/routes/workflow-playground.ts` | `POST /api/workflows/page` | `POST /agent/v1/workflows/page` | 单页查询 |
| `electron/services/workflow-service.ts` | `fetchWorkflowPage()` | `POST {baseUrl}/agent/v1/workflows/page` | 分页拉取工作流列表 |
| `electron/services/workflow-service.ts` | `listMyWorkflows()` | `POST {baseUrl}/agent/v1/workflows/page`（循环翻页） | 拉取全部工作流（上限 500） |

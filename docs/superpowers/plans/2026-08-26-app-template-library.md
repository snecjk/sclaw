# SClaw 应用模板库实施计划

> 本计划只覆盖 SClaw。后端任务见 memory-center 项目的 `docs/superpowers/plans/2026-08-26-app-template-service.md`，文档名称为《memory-center 应用模板服务实施计划》。

## 目标

为 SClaw 增加按 `site` / `assets` 分类的模板选择、模板本地工作区、确认发布以及用选定模板创建新应用的能力。所有契约统一使用 `templateId`。

## 任务 1：契约与内置模板资源

- 定义模板、版本、分页、发布和下载信息的 TypeScript 类型。
- 类型字段使用 `templateId`、`pageType`、`version`、`packageOssKey`、`packageEtag`、`packageSize`。
- 在 `resources/app-templates` 增加 `site-minimal` 与 `assets-minimal`。
- 增加 manifest 校验，并测试类型不匹配、非法路径和缺少入口等情况。
- 增加平台发布流水线的模板初始化步骤：分别打包并首次发布两个 minimal 模板。
- 初始化必须幂等；远端 `templateId` 已存在时跳过，不生成新版本，且客户端启动时不得执行初始化。
- 平台初始化请求为两个固定 minimal 模板传递 `isBuiltin: true`；模板管理页面发布普通模板时不提交该字段。

## 任务 2：memory-center 客户端

- 新建 `AppTemplateApiClient`，使用 `resolveStoBaseUrl + getAuthHeaders + fetch` 的直接调用方式，不经过 `memoryCenterFetchForSession`。
- `getAuthHeaders()` 复用 `getStoToken()` 和 `buildStoMemoryCenterAuthHeaders()`，不得自行定义另一套 Token 请求头。
- 每次请求拼接 `${baseUrl}${endpoint}`，统一处理超时、HTTP 错误和 memory-center 业务错误。
- JSON 请求显式设置 `Content-Type: application/json` 并序列化 body。
- multipart 发布请求把 `FormData` 直接作为 body，只传鉴权头，不得手工设置 `Content-Type`，确保运行时正确生成 boundary。
- 为列表、发布、版本列表和下载信息定义清晰的请求与响应类型。
- 列表和详情响应读取 `isBuiltin`，普通发布请求类型不暴露该可写字段。
- 实现列表、发布、版本列表和下载信息调用。
- SClaw 不计算版本号，发布请求中不传目标版本。

## 任务 3：模板包与本地工作区

- 用现有 ULID 工具为新模板生成一次性的 `templateId`。
- 从对应 minimal 模板初始化工作区。
- 支持安全打包、解包、manifest 校验和 Git checkpoint。
- 下载时校验文件大小、可用的 ETag 和 manifest；不引入额外摘要字段。

## 任务 4：Host API

- 增加 `/api/app-templates` 路由，隔离 Renderer 与远端鉴权。
- 对 multipart 上传、分页参数和错误响应做边界校验。
- 保持 Host API 与 memory-center 契约的明确字段映射。

## 任务 5：模板管理界面

- 增加模板列表，支持 `全部 / 独立站点 / 托管应用` 分类。
- 增加模板工作区，复用应用开发中的 AI、预览、代码和 Git 体验。
- 发布必须二次确认，并展示服务端实际生成的版本。
- 第一阶段仅平台团队入口可见。

## 任务 6：应用创建联动

- 创建应用时先选应用类型，再请求同类型 ACTIVE 模板。
- 默认类型为 `site`，默认选择对应 minimal 模板。
- memory-center 尚未完成 minimal 模板初始化时展示明确错误，不回退为无远端版本的本地模板。
- 使用指定版本的下载信息初始化工程。
- 在应用元数据中记录 `templateId`、`pageType`、`version`、`packageOssKey`、`packageEtag`。
- 验证模板后续发布不影响已创建应用。

## 任务 7：契约验证

- 在 SClaw 仓库内建立自包含契约样例，完整声明请求和响应，不依赖读取另一个仓库的 fixture。
- 样例依据《memory-center 应用模板服务与接口设计》的接口章节维护。
- 覆盖成功、业务错误、下载链接过期和并发发布冲突。
- 完成 TypeScript 检查、单元测试和关键创建流程集成测试。

## 非目标

- 不实现模板自动升级、主题、组件管理、私有模板、复制已有模板和模板版本回滚。
- 不修改 memory-center 代码；两项目按各自计划实施，通过自包含契约测试联动。

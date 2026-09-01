# SClaw 应用模板库设计

## 1. 目标与范围

第一期由平台团队维护应用模板，让用户在创建应用时按应用类型选择模板，并在独立的模板工作区中通过 AI、预览、代码编辑器和 Git checkpoint 维护模板。

本期只影响之后新建的应用，不自动升级存量应用。暂不建设主题系统、组件管理、业务团队私有模板、模板回滚和应用广场能力。

模板分为两种不可变类型：

- `site`：独立站点模板。
- `assets`：托管应用模板。

每种类型提供一个固定内置模板，资源随 SClaw 发布：

- `site-minimal`
- `assets-minimal`

## 2. 模板标识与版本

所有界面、存储和接口统一使用 `templateId` 作为唯一模板标识。

- 两个内置模板使用固定 `templateId`：`site-minimal`、`assets-minimal`。
- 新模板从对应类型的 minimal 模板创建；SClaw 在首次建立本地模板工作区时，使用现有 ULID 工具生成稳定的 `templateId`。
- `templateId` 创建后不可修改，模板名称和描述可以修改。
- 首次发布版本为 `1.0.0`，之后由 memory-center 自动递增 patch 版本；SClaw 不计算、不提交目标版本号。
- 应用创建时记录模板 ID 和当时选定的版本，后续模板发布不会改变已有应用。

## 3. 模板包

模板包是可直接解压为应用工程的 ZIP，至少包含：

- `manifest.json`：声明 `templateId`、`pageType`、名称、模板格式版本和入口信息。
- `package.json`：工程依赖和脚本。
- 实际工程骨架以及无法声明化的源代码。

`manifest.json` 与工程骨架放在同一个包内，但职责不同：manifest 用于平台校验和展示，工程文件用于创建实际应用。

第一期不把主题和组件能力抽成独立 JSON；以后可以在不改变模板 ID 的前提下扩展 manifest 格式。

## 4. SClaw 职责

### 4.1 内置资源

在 `resources/app-templates/site-minimal` 和 `resources/app-templates/assets-minimal` 保存两个种子模板，它们是内置 minimal 模板源文件的唯一来源，也是新模板的唯一初始来源。

平台发布流水线负责在模板服务首次上线时，将两个目录分别打包并发布到 memory-center。该初始化任务必须幂等：仅当对应 `templateId` 不存在时创建 `1.0.0`，已经存在时直接跳过，不能因为 SClaw 客户端再次发版而自动产生新版本。后续版本统一由模板管理页面确认发布。

应用创建页以 memory-center 返回的 ACTIVE 模板为准，不在客户端启动时上传、注册或合并本地内置模板。若远端初始化未完成，应展示明确的模板服务未初始化错误，而不是生成无法追溯版本的本地应用。

### 4.2 本地模板工作区

模板草稿只保存在当前工作区，不上传草稿。工作区保存：

- 模板源文件。
- 本地元数据，包括 `templateId`、`pageType`、名称和最近发布版本。
- AI 对话产生的变更。
- Git checkpoint。

模板作者可使用 AI、内嵌预览和代码编辑器维护模板；发布前必须明确确认。

### 4.3 应用创建

创建应用时先选择“独立站点”或“托管应用”，再只展示同类型的 ACTIVE 模板。默认应用类型为 `site`，默认选中对应 minimal 模板。

下载模板包后，SClaw 校验：

1. 响应文件大小是否与 `packageSize` 一致。
2. 服务端和 OSS 返回 ETag 时，是否与 `packageEtag` 一致。
3. ZIP 能否安全解压，且不存在路径穿越。
4. `manifest.json` 中的 `templateId`、`pageType`、`schemaVersion` 是否与选择结果一致；发布版本由下载接口返回，不写入 manifest。

生成的应用标记记录：`templateId`、`pageType`、`version`、`packageOssKey`、`packageEtag`。该标记用于追溯，第一期不据此自动升级模板。

## 5. 与 memory-center 的联动

相关后端设计位于 memory-center 项目的 `docs/superpowers/specs/2026-08-26-app-template-service-design.md`，文档名称为《memory-center 应用模板服务与接口设计》。

SClaw 使用模板业务客户端直接调用 memory-center，调用链为：

```text
Renderer
  -> SClaw Host API /api/app-templates
  -> electron/services/app-template-api-client.ts
  -> resolveStoBaseUrl + getAuthHeaders + fetch
  -> memory-center /agent/v1/app-templates
```

`AppTemplateApiClient` 参考现有 `skill-plaza-service.ts` 中的 `PythonApiClient`：通过 `resolveStoBaseUrl()` 解析当前环境地址，通过 `getAuthHeaders()` 获取当前 Session 的 `stoToken` 并调用 `buildStoMemoryCenterAuthHeaders()`，最后拼接 URL 并调用 `fetch()`。

通用请求骨架为：

```ts
const baseUrl = await resolveStoBaseUrl();
const headers = await this.getAuthHeaders();
const url = `${baseUrl}${endpoint}`;
```

JSON 请求显式传入 JSON Content-Type：

```ts
await fetch(url, {
  method: 'POST',
  headers: {
    ...headers,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});
```

模板发布直接把 `FormData` 作为 body，不传 `Content-Type`，由运行时自动生成正确的 multipart boundary：

```ts
await fetch(url, {
  method: 'POST',
  headers,
  body: formData,
});
```

模板客户端统一处理超时、HTTP 错误、`success: false` 业务错误以及响应类型映射。它不使用 `memoryCenterFetchForSession`，但继续复用公共的环境解析、Token 存储和鉴权头构建函数。

主要接口：

| 用途 | SClaw Host API | memory-center API |
| --- | --- | --- |
| 模板列表 | `GET /api/app-templates?pageType=site&status=ACTIVE` | `POST /agent/v1/app-templates/page` |
| 发布模板 | `POST /api/app-templates/publish` | `POST /agent/v1/app-templates/publish` |
| 版本列表 | `GET /api/app-templates/{templateId}/versions` | `GET /agent/v1/app-templates/{templateId}/versions` |
| 下载信息 | `GET /api/app-templates/{templateId}/versions/{version}/download` | `GET /agent/v1/app-templates/{templateId}/versions/{version}/download` |

发布使用 multipart：ZIP 文件加 JSON 元数据。普通发布元数据包含 `templateId`、`pageType`、`name`、`description`，不包含目标版本。`isBuiltin` 仅在平台初始化两个 minimal 模板时由受信任的发布流程传递，普通模板发布请求不得设置或修改该字段。

下载信息返回 `packageOssKey`、`packageEtag`、`packageSize`、`downloadUrl`、`expiresAt`。

接口沿用 memory-center 现有 `ok()` / `BizException` 响应结构，SClaw 统一解析 `success`、`errCode`、`errMessage`、`data`、`traceId`。

## 6. 状态与约束

- 服务端模板状态：`ACTIVE`、`DISABLED`；草稿只存在于 SClaw 本地工作区，应用创建页只展示 ACTIVE。
- `pageType` 创建后不可修改。
- `isBuiltin` 创建后不可修改；仅 `site-minimal` 和 `assets-minimal` 可以为 `true`。
- 同一 `templateId` 的发布必须串行化，防止并发生成相同版本。
- 发布失败不得暴露不完整版本。
- 第一阶段不支持从已有模板复制，只能从同类型 minimal 模板创建。
- 两个 minimal 模板由平台发布流水线首次注册；客户端运行时不得执行模板初始化。

## 7. 后续演进预留

- 业务团队上传及私有模板。
- 模板版本升级评估、差异展示和手动迁移。
- 主题和组件边界配置。
- 模板审核、回滚、灰度和使用统计。

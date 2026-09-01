# 外部服务广场与应用服务绑定设计

**状态：已确认设计，待实施**
**范围：memory-center 外部服务配置、SClaw 全局管理与应用绑定、应用开发 Agent 受控接入、本地代理与发布环境解析**

## 1. 目标

在 SClaw 中提供一个轻量的“外部服务广场”：平台团队统一维护服务的 daily、stage、online 地址和认证方式；每个 Site 或 Assets 应用只选择自己需要的服务。应用开发 Agent 可以通过受控能力搜索和绑定服务，只在绑定后获得该服务的完整配置和使用说明。

第一期解决两个核心问题：

1. 本地 React/Vite 应用通过 `dev-proxy.v1.json` 访问 daily 服务，浏览器不产生跨域请求。
2. 应用发布时使用发布流程已经选择的 `daily / stage / online` 环境，解析已绑定服务对应的真实地址。

## 2. 第一阶段边界

- Site 和 Assets 都可以声明、搜索和绑定外部服务。
- 本地 Site 和 Assets 均固定使用服务的 daily 地址，并经 Vite Proxy 转发。
- 发布 Site 使用发布环境对应地址，并由 `@sto/sclaw-plugin-sso-auth` 提供 `stoToken`。
- 发布 Assets 的身份由 iframe 宿主后续提供，不在第一期实现。
- 认证只支持 `none` 和 `stoToken`；API Key 以后扩展。
- 不引入 `@sto/sclaw-plugin-external-services` 基础 npm 包。
- 不上传外部服务 ZIP，不管理 OSS 服务制品，不管理独立的 `SKILL.md`、OpenAPI 或文档包。
- npm SDK 是可选项，仍由公司 npm 仓库管理；服务配置只记录固定包名和版本。
- 应用绑定关系保存在应用 Git 中，不保存到 memory-center。

## 3. 核心模型：一个服务只有一份配置

平台团队在 SClaw 中编辑一份外部服务配置，由 memory-center 保存草稿和不可变发布版本。

```json
{
  "schemaVersion": "external-service/v1",
  "serviceId": "sto-policy-ontology",
  "version": "1.0.0",
  "name": "策略本体服务",
  "description": "提供策略本体查询与维护能力",
  "owner": "policy-platform",
  "environments": {
    "daily": "https://zc-hybrid-test.sto.cn/sto-policy/api",
    "stage": "https://zc-hybrid-stage.sto.cn/sto-policy/api",
    "online": "https://zc-hybrid.sto.cn/sto-policy/api"
  },
  "auth": {
    "type": "stoToken"
  },
  "integration": {
    "npmPackage": "@sto/sclaw-plugin-policy-ontology",
    "packageVersion": "1.0.0",
    "usageGuide": "安装 SDK 后导入 createOntologyClient，并通过生成的服务 transport 调用。"
  }
}
```

字段规则：

- `serviceId` 是不可修改的稳定、小写 kebab-case 标识。
- `daily / stage / online` 三个 HTTPS 地址都必须填写，地址不能包含 Query 或 Fragment。
- `auth.type` 只允许 `none` 或 `stoToken`。
- `stoToken` 服务的三个主机名必须是 `sto.cn` 或 `*.sto.cn`，防止 Token 被发送到任意域名。
- `integration` 整体可选；`npmPackage` 和 `packageVersion` 必须同时出现。
- `usageGuide` 是可选的 Markdown 文本，只在应用绑定该服务后提供给 Agent。

## 4. 版本和生命周期

- 新服务先保存草稿，再由用户确认发布。
- memory-center 自动生成 `1.0.0`、`1.0.1` 形式的补丁版本。
- 发布版本是单个 JSON 配置快照，发布后不可修改。
- 修改服务时只更新草稿；再次发布产生新版本。
- 应用绑定固定的 `serviceId + version`，不会自动跟随服务最新版本。
- 应用开发者主动升级后才写入新的配置快照和 Git 变更。
- 已经发布的版本不能物理删除；服务可以停用，停用后不再出现在新绑定搜索结果中，现有应用仍可读取固定版本。

## 5. 系统职责

```text
memory-center
  ├─ 保存服务草稿、服务状态和不可变版本 JSON
  ├─ 校验环境地址、认证方式和 npm 集成字段
  └─ 提供管理、搜索、版本详情和发布 API

SClaw
  ├─ 全局“外部服务管理”页面
  ├─ 应用工作台“外部服务”广场
  ├─ Agent 搜索/绑定命令
  ├─ 校验并写入应用配置快照
  └─ 生成本地代理和应用调用入口

应用仓库
  ├─ contracts/external-services.v1.json   # 已绑定服务的不可变配置快照
  ├─ contracts/dev-proxy.v1.json           # 本地 Vite 代理生成物
  └─ src/sclaw/services.generated.ts       # 应用代码调用入口生成物
```

## 6. memory-center API

所有接口位于现有 `/agent/v1` 体系，并使用既有 stoToken 鉴权。

```text
POST /agent/v1/external-services/page
  查询可绑定的已发布服务摘要；支持 keyword、pageNum、pageSize。

POST /agent/v1/external-services/admin/page
  管理员查询全部服务，包括未发布草稿和已停用服务。

GET /agent/v1/external-services/{serviceId}/versions
  查询服务的已发布版本列表。

GET /agent/v1/external-services/{serviceId}/versions/{version}
  查询一个不可变版本的完整配置。

GET /agent/v1/external-services/{serviceId}/draft
  管理员读取当前草稿。

PUT /agent/v1/external-services/{serviceId}/draft
  管理员创建或更新草稿；serviceId 创建后不可修改。

POST /agent/v1/external-services/{serviceId}/publish
  管理员确认发布草稿并自动产生下一个补丁版本。

POST /agent/v1/external-services/{serviceId}/status
  管理员将服务设为 ACTIVE 或 DISABLED。
```

SClaw 访问 memory-center 时复用现有调用方式：

```ts
const baseUrl = await resolveStoBaseUrl();
const headers = await getAuthHeaders();
const response = await fetch(`${baseUrl}${endpoint}`, { headers });
```

Renderer 中的纯 JSON 请求走现有 `/ai-memory/agent/v1/*` 通用透传，不增加专用透传路由。只有“写应用本地文件、安装依赖、生成代码”使用独立的 SClaw Host API。

## 7. 全局管理与应用广场

### 7.1 全局管理

“创建应用”菜单增加“管理外部服务”，与“管理应用模板”同级。第一期使用普通表单维护单个 JSON 配置，包括名称、描述、维护团队、三个环境地址、认证方式、可选 npm 包、版本和使用说明。

发布前使用确认弹窗；发布成功后展示自动生成的版本号。只有具备平台管理权限的用户能够保存草稿、发布和停用服务。

### 7.2 当前应用选择

应用工作台增加“外部服务”页签，提供：

- 搜索已发布服务；
- 查看名称、描述、维护团队、最新版本、认证方式和是否包含 SDK；
- 将固定版本添加到当前应用；
- 查看当前绑定；
- 手动升级到新版本；
- 移除绑定。

Site 与 Assets 使用同一个选择器，不在服务定义中重复维护页面类型。

## 8. Agent 受控搜索和绑定

应用模板内置“外部服务接入”Skill 和跨平台 Node 命令。Agent 必须通过命令调用本机 SClaw Host API：

```text
pnpm sclaw:services -- search <keyword>
pnpm sclaw:services -- list
pnpm sclaw:services -- bind <serviceId> [version] [alias]
pnpm sclaw:services -- upgrade <alias> <version>
pnpm sclaw:services -- remove <alias>
```

受控能力的含义：

- `search` 只返回服务摘要，不把全广场配置注入 Agent 上下文。
- `bind` 必须由 SClaw 从 memory-center 获取真实已发布版本；Agent 不能提交自造域名或版本。
- SClaw 负责写配置、生成文件、安装固定 npm 版本并返回变更摘要。
- 绑定完成后，Agent 才能读取该服务快照中的 `usageGuide`。
- 无 `usageGuide` 的服务，Agent 必须向用户收集接口路径、方法、参数和返回示例，不能猜测接口。

## 9. 应用内文件及生成关系

### 9.1 `external-services.v1.json`

这是应用选择结果，也是发布可复现的事实来源。它保存已发布版本的完整公开配置快照，而不只是远程引用，部署平台不需要在构建时再次请求 memory-center。

```json
{
  "schemaVersion": "external-services/v1",
  "services": [
    {
      "alias": "policyOntology",
      "serviceId": "sto-policy-ontology",
      "version": "1.0.0",
      "name": "策略本体服务",
      "environments": {
        "daily": "https://zc-hybrid-test.sto.cn/sto-policy/api",
        "stage": "https://zc-hybrid-stage.sto.cn/sto-policy/api",
        "online": "https://zc-hybrid.sto.cn/sto-policy/api"
      },
      "auth": { "type": "stoToken" },
      "integration": {
        "npmPackage": "@sto/sclaw-plugin-policy-ontology",
        "packageVersion": "1.0.0",
        "usageGuide": "安装 SDK 后导入 createOntologyClient。"
      }
    }
  ]
}
```

`alias` 是应用内稳定标识，必须是合法 JavaScript identifier；同一应用不能重复绑定相同 alias 或 `serviceId`。

### 9.2 `dev-proxy.v1.json`

该文件继续保留，但只作为本地开发代理的生成物。每个绑定服务生成一个带 `managedBy: "external-services"` 的 `/proxy/<alias>` 规则，目标是该服务的 daily 地址。重新生成时只替换受管条目，保留已有人工代理；若 alias 与人工代理 key 冲突则阻止绑定。文件不保存 Token，也不参与发布环境选择。

### 9.3 `services.generated.ts`

该文件只生成薄调用入口，复用模板内稳定的 HTTP Runtime，不复制 Token、环境判断和错误处理实现。

```ts
import { createExternalServiceClient } from './external-service-runtime';

export const services = {
  policyOntology: createExternalServiceClient('policyOntology'),
} as const;
```

业务代码使用：

```ts
const result = await services.policyOntology.request({
  method: 'GET',
  path: '/v1/ontology/search',
  params: { keyword: '运单' },
});
```

## 10. 环境与请求链路

```text
本地开发
页面代码 → services.generated.ts → /proxy/<alias> → Vite Proxy → daily 服务

发布 Site
页面代码 → services.generated.ts → 当前发布环境 baseUrl → 外部服务
                                           ↑
                          发布时注入的 deployEnv
```

规则：

- 本地 `import.meta.env.DEV` 始终使用 daily。
- 本地 Assets 可以复用 SClaw 当前用户身份，但只允许 SSO Auth 的 local provider；发布 Assets 仍禁止自行执行 SSO 登录、跳转和回跳。
- 发布 Site 从已确认的 SSO Auth 发布配置读取 `deployEnv`；业务代码不判断 hostname，也不读取 `VITE_SSO_ENV`。
- 外部服务 Runtime 根据 `deployEnv` 从应用快照中选择地址。
- `none` 不附加 Token。
- `stoToken` 使用 SSO Auth 插件当前 Token，并按现有请求约定附加 `stoToken` 和 `Authorization: Bearer`。
- `stoToken`、Cookie、SSO code、本地 Session Secret 均不得写入三个应用文件、URL、日志或 Git。
- 发布站点直连外部服务的前提是目标服务已将发布域名加入 CORS 白名单。
- 发布 Assets 的 deployEnv 和身份由未来 iframe 宿主 Bridge 提供；第一期只保证本地开发链路。

## 11. 绑定、升级与移除事务

绑定操作按以下顺序执行：

1. 从 memory-center 获取已发布固定版本并重新校验。
2. 检查 alias、重复服务和域名安全边界。
3. 如果配置 SDK，安装精确版本 `<npmPackage>@<packageVersion>`。
4. 原子写入 `external-services.v1.json`。
5. 从主配置重新生成 `dev-proxy.v1.json` 和 `services.generated.ts`。
6. 返回修改文件、安装依赖和使用说明摘要。

配置写入或生成失败时，保留原文件；npm 安装失败时不写入绑定。升级复用同一流程并替换固定版本。移除时先更新配置和生成物；只有确认没有其他绑定使用同一 npm 包时才允许卸载依赖，第一期可安全地保留未使用依赖。

## 12. 发布前校验

SClaw 发起 `code-deploy create` 之前校验：

- `external-services.v1.json` 结构合法；
- 每个 alias、serviceId 唯一；
- 三个环境地址和认证方式完整；
- `stoToken` 服务只指向允许的 STO HTTPS 域名；
- `dev-proxy.v1.json` 和 `services.generated.ts` 可以从主配置无差异重建；
- Site 存在 SSO Auth 发布能力；Assets 发布身份缺口明确提示但不在第一期补齐。

发布环境仍由现有发布弹窗选择，并通过现有 `sai-cli policy code-deploy create --env ...` 传递。Agent 绑定服务时不选择部署环境。

## 13. 验收标准

1. 管理员可在 SClaw 保存一份服务草稿并确认发布，memory-center 自动生成不可变版本。
2. 应用开发者和 Agent 都可以搜索已发布服务，但完整配置只在绑定后进入当前应用。
3. 绑定服务会写入完整配置快照，并自动生成本地代理与调用入口。
4. 配置 SDK 的服务安装固定 npm 版本；无 SDK 的服务仍可通过通用 HTTP 客户端接入。
5. 本地 Site/Assets 请求经 Vite Proxy 访问 daily 服务，不发生浏览器 CORS。
6. 发布 Site 根据发布环境选择对应地址并携带当前用户 `stoToken`。
7. Agent 无法绑定不存在的服务版本，也无法通过配置把 `stoToken` 发送到非 STO 域名。
8. 服务发布新版本不会改变已有应用；应用升级产生可审查的 Git 变更。

# CompanyCode 隔离外部服务的 SClaw 接入设计

## 1. 背景

SClaw 已具备外部服务广场、应用绑定、固定版本快照、Vite 本地代理、可选 npm SDK 安装和发布前一致性校验。当前服务由平台全局维护，Agent 的 CLI 发现流程与应用绑定流程相互独立；A2UI Action 仍直接使用 `/proxy/<key>/...`，没有使用能够正确选择 daily、stage、online 的外部服务 Runtime。

本设计联动 Memory Center，把外部服务扩展为平台公共服务和按 CompanyCode 隔离的用户服务，并统一“安装、Agent 开发、本地代理、环境切换、认证、发布”链路。

## 2. 目标与非目标

### 2.1 目标

- 用户在 SClaw 创建和维护本人 CompanyCode 下的服务；
- 用户服务支持私有和公司内公开；
- 应用只能安装当前用户可见且通过 Memory Center 校验的服务；
- 安装固定 `serviceUid + version`，快照跟随 Git 和应用产物；
- Agent 优先理解当前应用已安装服务，只在缺失时搜索服务广场；
- 已注册服务统一通过生成 Runtime 调用，正确处理本地代理、部署环境和 stoToken；
- A2UI Action 支持按服务 alias 调用；
- 保留未注册接口的人工 dev-proxy 兜底能力；
- 兼容现有平台服务和老应用快照。

### 2.2 非目标

- 不在 SClaw 建立独立的 CompanyCode 或租户选择器；
- 不允许 Agent 无确认安装服务或 npm 包；
- 不实现跨公司分享、协作者和审核流；
- 不把应用安装状态同步保存到 Memory Center；
- 不实现 Assets 发布态 Token Bridge；
- 不自动卸载移除服务遗留的 npm 包。

## 3. 总体架构

```text
Memory Center
  ├─ PLATFORM 公共服务
  └─ 当前 CompanyCode 服务
       ├─ PRIVATE：仅创建者
       └─ PUBLIC：公司内公开
             │
             ├─ CLI list/describe：Agent 渐进发现
             │
             └─ resolve-install：校验应用和服务权限
                         │
SClaw                    ▼
  ├─ 外部服务管理：创建、编辑、发布、可见性、启停
  ├─ 应用外部服务面板：选择服务、版本、alias 并确认安装
  └─ 应用仓库
       ├─ contracts/external-services.v1.json
       ├─ contracts/dev-proxy.v1.json
       └─ src/sclaw/services.generated.ts
                         │
                         ▼
  本地：/proxy/<alias> → daily
  发布：Runtime → daily/stage/online → stoToken
```

## 4. 客户端服务引用

服务列表、版本和安装操作统一使用服务端生成的 `serviceUid`。`serviceId` 继续用于展示和业务识别，但不得单独作为接口主键。

```ts
type ExternalServiceRef = {
  serviceUid: string;
  scopeType: 'PLATFORM' | 'COMPANY';
  companyCode: string;
  serviceId: string;
};
```

应用绑定快照新增这些字段，同时继续保存 alias、固定版本、三套环境地址、认证方式和 integration：

```json
{
  "serviceUid": "01K...",
  "scopeType": "COMPANY",
  "companyCode": "COMP001",
  "serviceId": "policy-database",
  "version": "1.0.2",
  "alias": "policyDatabase"
}
```

## 5. SClaw 外部服务管理

现有管理入口改为两部分：

### 5.1 服务广场

展示当前用户可见、已发布且 ACTIVE 的服务：

- 平台公共服务；
- 当前 CompanyCode 的 PUBLIC 服务；
- 当前用户创建的 PRIVATE 服务。

卡片显示作用域标签：`平台`、`公司公开`、`我的私有`。

### 5.2 我的服务

用户可以：

- 人工填写小写 kebab-case `serviceId` 创建服务；
- 编辑名称、描述、owner、daily/stage/online、认证方式；
- 维护可选 npmPackage、精确 packageVersion 和 usageGuide；
- 发布自动递增版本；
- 切换 PRIVATE/PUBLIC；
- 启用或停用。

CompanyCode、createdBy 和 scopeType 不出现在可编辑表单中，完全由服务端身份决定。平台服务继续由平台管理员管理。

## 6. 应用安装流程

应用外部服务面板继续作为安装确认入口。

```text
用户选择服务和版本
  ↓
选择或确认合法 alias
  ↓
SClaw 解析当前 workspace 的 appCode
  ↓
调用 resolve-install(serviceUid, appCode, version)
  ↓
Memory Center 校验身份、应用权限、CompanyCode 和服务可见性
  ↓
返回不可变版本快照
  ↓
若包含 SDK，展示包名和版本并二次确认
  ↓
安装 SDK
  ↓
更新应用绑定快照和生成物
```

安装接口失败时不得写入任何绑定文件。用户取消 SDK 二次确认时不得安装 SDK，也不得完成服务绑定。

### 6.1 SDK 安全

- 只接受内部 npm registry；
- 只接受精确版本；
- 安装前展示包名、版本和服务来源；
- Agent 无权代替用户确认；
- SDK 安装失败时保留原绑定文件；
- 后续生成物写入失败时明确提示 package.json 可能已经变化，并提供恢复入口；
- 移除绑定不自动卸载 SDK，避免多个服务共享包时误删依赖。

## 7. 应用仓库契约

### 7.1 事实来源

`contracts/external-services.v1.json` 是应用已安装服务的事实来源。它保存服务端返回的固定版本快照，不保存 Token、Cookie、SSO code 或 API Key。

老快照缺少 serviceUid 时仍允许构建和发布；只有升级或重新安装时才要求通过 Memory Center 解析并补齐新字段。

### 7.2 生成物

SClaw 根据事实来源生成：

- `contracts/dev-proxy.v1.json`：每个已注册服务生成 daily 代理；
- `src/sclaw/services.generated.ts`：每个 alias 生成类型安全的运行时调用入口。

人工代理继续保留，托管代理带有 `managedBy=external-services` 和 serviceUid。alias 与人工代理 key 冲突时拒绝安装。

### 7.3 一致性校验

发布前校验：

- 绑定快照结构和 alias；
- 托管代理与 daily 地址一致；
- services.generated.ts 与 alias 集合一致；
- SDK 元数据是精确版本；
- 新格式绑定包含 serviceUid、scopeType 和 companyCode。

老格式快照执行兼容校验，不要求远端查询。

## 8. Runtime 调用模型

已注册服务唯一推荐入口：

```ts
import { services } from '@/sclaw/services.generated';

await services.policyDatabase.request({
  method: 'POST',
  path: '/v1/search',
  data: params,
});
```

规则：

- path 必须是以 `/` 开头的相对路径；
- 本地开发固定调用 `/proxy/<alias>/...`，由 Vite 转发到 daily；
- Site 发布优先读取不可变部署配置中的 deployEnv，并选择对应服务地址；
- 部署配置缺失时可保留受控域名映射兜底，但不得把模糊 hostname 推断作为长期权威来源；
- auth=stoToken 时由统一 request 层携带 Token；
- auth=none 时明确禁用 Token；
- stoToken 只能发送到 STO 域名；
- Assets 发布态 stoToken 服务在 Token Bridge 未实现前继续抛出明确错误。

## 9. A2UI Action Registry

Action Definition 增加服务调用字段：

```json
{
  "actionId": "policy.search",
  "service": "policyDatabase",
  "path": "/v1/search",
  "method": "POST"
}
```

Action Executor：

1. 有 `service` 时，从 `services.generated.ts` 查找 alias；
2. 校验 path 为相对路径；
3. 把 action context 作为请求数据传给服务 Runtime；
4. alias 不存在时返回“服务未安装”，不得回退为猜测 URL；
5. 只有没有 `service` 且存在 `url` 时才走旧 request(url) 兼容路径。

这可以确保 A2UI 和 React/TypeScript 页面共用同一套环境与认证规则。

## 10. Agent 工作流

Agent 在需要业务数据时按以下顺序工作：

1. 读取当前应用 `external-services.v1.json`；
2. 在已绑定服务的 name、description、serviceId 和 usageGuide 中选择匹配项；
3. 只读取一个匹配服务的 usageGuide；
4. 使用既有 alias 和 `services.generated.ts` 开发；
5. 当前应用没有匹配服务时，执行 CLI list；
6. 唯一候选后执行 describe(serviceUid, version)；
7. 提示用户到外部服务面板确认安装；
8. 检测绑定文件更新后再开始修改业务代码；
9. 服务广场无匹配时才回退 sai-cli discover/help 和人工 dev-proxy。

Agent 禁止：

- 自动安装服务或 npm 包；
- 根据服务名称猜测接口；
- 把环境绝对地址写进业务代码；
- 为已注册服务再次创建人工代理；
- 把 describe 等同于已安装。

## 11. CLI 契约调整

```bash
sai-cli siteapp external-service list --keyword "业务词" -f json
sai-cli siteapp external-service describe --serviceUid 01K... --version 1.0.2 -f json
```

SClaw 的 AGENTS 上下文、模板内 external-services skill 和自然语言建页 skill 同步使用 serviceUid。旧 serviceId-only describe 只作为迁移兼容，不用于新生成代码。

## 12. 发布行为

应用发布选择 daily、stage、online 后：

- 发布前只校验本地快照及生成物；
- 不重新查询服务是否仍 PUBLIC 或 ACTIVE；
- 不因创建者 CompanyCode 变化而阻止已有应用发布；
- Site 使用发布环境和 SSO Token 直连对应服务域名；
- Assets 显示 Token Bridge 风险提示；
- 外部服务域名仍必须完成发布域名 CORS 白名单配置。

固定快照保证服务改私有、停用或发布新版本后，既有应用仍可重复构建和发布。

## 13. 升级与移除

### 13.1 升级

- 用户明确选择目标版本；
- SClaw 调用 resolve-install 重新校验权限；
- 服务已停用、不可见或跨公司时拒绝升级；
- SDK 版本变化时再次二次确认；
- 成功后重写快照和生成物。

### 13.2 移除

- 从绑定快照移除对应 alias；
- 删除该服务托管代理和生成客户端；
- 保留人工代理；
- 不自动卸载 npm 包；
- 提示用户检查业务代码是否仍引用 alias 或 SDK。

## 14. 错误处理

- 身份或 CompanyCode 缺失：显示重新登录或联系管理员；
- 服务不可见：统一显示“服务不存在或无权访问”；
- 应用与服务公司不一致：禁止安装；
- appCode 无法解析：禁止安装，提示先完成云端应用绑定；
- SDK 安装失败：保持原绑定配置；
- 生成物漂移：发布前阻止并提供“一键重新生成”；
- Runtime alias 缺失：明确提示安装服务，不允许猜测 URL；
- Assets 身份未接入：抛 `AUTH_RUNTIME_UNAVAILABLE`。

## 15. 兼容与迁移

- 现有 Memory Center 服务作为 PLATFORM 服务继续显示；
- 当前绑定接口在过渡期兼容 serviceId，但新 UI 只提交 serviceUid；
- 老应用快照可以继续构建和发布；
- 老绑定升级时通过服务端解析为平台 serviceUid 并补齐字段；
- `external-services.v1.json` 保持文件名和 schemaVersion，新增字段采用向后兼容策略；
- Agent 指令从“所有接口统一 `/proxy`”迁移为“已注册服务走 services alias，未注册接口才走人工 `/proxy`”。

## 16. 测试要求

### 16.1 SClaw Host API

- serviceUid 搜索、安装、升级和错误透传；
- appCode 解析和 resolve-install 参数；
- SDK 二次确认前不执行安装；
- 安装失败不写绑定文件；
- 老快照兼容。

### 16.2 生成与 Runtime

- 平台与公司同名服务使用不同 serviceUid；
- daily 本地代理；
- Site stage/online 地址选择；
- none/stoToken 认证；
- 非法绝对 path；
- 人工代理保留和 alias 冲突；
- 生成物漂移检测和重新生成。

### 16.3 A2UI 与 Agent

- Action service/path 调用；
- alias 未安装错误；
- 旧 url Action 兼容；
- Agent 优先读取已绑定服务；
- Agent 未经确认不安装服务；
- 无匹配服务才回退 discover/help。

### 16.4 页面

- 服务广场作用域标签；
- 我的服务创建、编辑、发布、可见性和启停；
- SDK 二次确认；
- 私有服务只在创建者页面出现；
- 安装、升级和移除后的状态刷新。

## 17. 项目边界与实施顺序

Memory Center 先提供：

1. serviceUid、scopeType、CompanyCode、visibility 数据与迁移；
2. 用户服务管理权限；
3. page、mine/page、版本和 resolve-install 接口；
4. CLI list/describe 新契约。

SClaw 再实现：

1. 新接口类型和客户端；
2. 外部服务管理页面；
3. 应用安装和 SDK 二次确认；
4. 绑定快照与生成物升级；
5. A2UI Action service/path；
6. Agent 指令调整；
7. 发布校验、兼容与回归测试。

两边以 `serviceUid + version` 和 resolve-install 响应作为唯一联动契约。

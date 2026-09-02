# SClaw 应用模板来源项目导入契约 v1

本文定义模板编辑工作台“上传项目 / 重新上传”的 Host API、安全边界和文件处理规则。该能力只修改当前本地模板工作区；它不调用 memory-center、不上传 OSS、不生成模板版本，也不等同于发布模板。

## 1. 支持范围

- 目标必须是由 Session Catalog 中 `workspaceId` 解析出的应用模板工作区。
- 来源必须是本机可访问的 React/Vite 工程根目录，并包含 `package.json`、`src/` 和唯一的 `src/main.{tsx,ts,jsx,js}`。
- 目标模板的 `pageType` 是最终依据。来源明确声明相反的 `site/assets` 类型时阻断导入；未声明时只提示警告。
- 来源目录不能与目标模板相同，也不能是目标模板的父目录或子目录。

## 2. API

所有响应都包含 `success`。失败响应结构为：

```json
{ "success": false, "error": "错误说明" }
```

四个接口都要求由 Electron IPC Host API 代理注入运行期随机内部凭证；浏览器页面直接访问 `127.0.0.1` 会返回 403。该凭证不会暴露给 Renderer，也不会被 CORS 允许。

### 2.1 查询来源状态

```http
GET /api/app-templates/workspaces/import-source/status?workspaceId=ws-1
```

```json
{
  "success": true,
  "hasSource": true,
  "sourceName": "customer-site",
  "sourceAvailable": true,
  "lastImportedAt": "2026-08-28T00:00:00.000Z"
}
```

该接口只返回来源目录名称，不返回来源绝对路径。

### 2.2 预检

首次上传传入来源目录：

```http
POST /api/app-templates/workspaces/import-source/prepare
Content-Type: application/json

{ "workspaceId": "ws-1", "sourcePath": "/local/customer-site" }
```

重新上传可省略 `sourcePath`，Host 使用上一次保存在本地状态中的来源目录：

```json
{ "workspaceId": "ws-1" }
```

响应示例：

```json
{
  "success": true,
  "importToken": "01K...",
  "expiresAt": "2026-08-28T00:10:00.000Z",
  "sourceName": "customer-site",
  "detectedStack": "react-vite",
  "pageType": "site",
  "changes": [
    { "path": "src/App.tsx", "kind": "modify" },
    { "path": "src/Old.tsx", "kind": "delete" }
  ],
  "ignoredPaths": [".env.daily"],
  "packageChanges": [],
  "issues": []
}
```

Host 在临时目录创建只读来源快照。`importToken` 固定十分钟过期，绑定 `workspaceId`、prepare 时的 canonical 模板根目录和 `templateId`，并且只能被 apply 消费一次；到期计时器会主动删除快照。Renderer 不能在 apply 时重新提交或修改文件清单。确认期间工作区若改绑到其他模板，apply 会拒绝旧 token。

### 2.3 应用覆盖

```http
POST /api/app-templates/workspaces/import-source/apply
Content-Type: application/json

{ "workspaceId": "ws-1", "importToken": "01K..." }
```

```json
{
  "success": true,
  "changedFiles": ["package.json", "src/App.tsx", "src/main.tsx", "vite.config.ts"],
  "checkpointCreated": true,
  "importedAt": "2026-08-28T00:01:00.000Z",
  "restartRequested": true
}
```

Host 在写入前创建 Git checkpoint；仓库没有未提交变更时，必须验证已有 HEAD 可作为恢复点，Git status/add/commit 的真实失败会阻断写入。随后创建临时恢复快照。文件写入、镜像删除、平台入口恢复、Vite 配置包装、`package.json` 合并或本地状态写入失败时，目标文件恢复到操作前状态。同一 canonical 模板根目录同一时刻只允许一个 apply，避免多个 workspaceId 指向同一模板时并发回滚互相覆盖。预览重启失败不回滚已经成功写入的源码，错误由现有应用运行状态展示。

### 2.4 取消预检

```http
POST /api/app-templates/workspaces/import-source/cancel
Content-Type: application/json

{ "workspaceId": "ws-1", "importToken": "01K..." }
```

```json
{ "success": true, "cancelled": true }
```

取消会清理临时来源快照。已消费、不存在或已过期的 token 返回 `cancelled: false`；使用其他工作区的 token 会被拒绝。

## 3. 问题代码

| code | 含义 | 常见级别 |
| --- | --- | --- |
| `INVALID_PROJECT` | 缺少 React/Vite、入口不唯一或工程结构无效 | blocker |
| `PAGE_TYPE_MISMATCH` | 来源类型与模板类型相反 | blocker |
| `PAGE_TYPE_UNDECLARED` | 来源未声明 Site/Assets 类型 | warning |
| `PACKAGE_JSON_INVALID` | package 配置无法解析 | blocker |
| `VITE_CONFIG_UNRECOGNIZED` | Vite 配置数量或格式不受支持 | blocker |
| `DEPENDENCY_CONFLICT` | 来源与平台依赖版本冲突，并已按规则裁决 | warning |
| `SENSITIVE_FILE_IGNORED` | 环境或凭据文件被忽略 | warning |
| `SOURCE_ENTRY_WRAPPED` | 来源入口改名并由平台入口包装 | warning |
| `SOURCE_LIMIT_EXCEEDED` | 文件数量或体积超过限制 | blocker |
| `GIT_UNAVAILABLE` | 无法创建上传前恢复点 | blocker |

只要存在 blocker，apply 就不会写入模板工作区。

## 4. 文件规则

永久保护内容包括 `.git/`、`.sclaw/`、`.gitignore`、`manifest.json`、平台 `src/main.*`、`src/sclaw/`、`openspec/skills/`、外部服务契约与脚本、`vite.config.ts` 和 `vite.config.sclaw.ts`。保护和忽略规则使用不区分大小写的比较，避免在默认大小写不敏感的文件系统上绕过。

来源入口保存为 `src/main.source.*`，由平台生成的 `src/main.tsx` 启动；来源 `index.html` 对 `src/main.{tsx,ts,jsx,js}` 的引用会统一改写到受管 `src/main.tsx`。来源 Vite 配置保存为 `vite.config.source.*`，最终配置按“来源默认值、平台覆盖值”合并。

忽略内容包括：

- `.env` 和 `.env.*`，仅 `.env.example` 可导入；
- `node_modules/`、`dist/`、`build/`、`coverage/` 和缓存；
- 来源 `.git/`、`.sclaw/` 和符号链接；
- 凭据、证书、私钥及受保护平台文件。

apply 写入前会逐段检查目标父目录，拒绝模板工作区内已有的符号链接，防止复制或回滚跟随链接写出工作区。

重新上传使用镜像语义，但只删除上次状态中记录的来源业务文件；平台文件和模板作者后来新增的其他文件不会因来源缺失而删除。

## 5. package.json 与规模限制

- 来源业务依赖默认生效；SClaw 管理的认证插件和已绑定外部服务 SDK 始终使用平台版本。
- `dev`、`build`、`preview` 等平台脚本保留。
- Rollup 的平台 `resolutions/overrides` 保留。
- 最大 5,000 个导入文件、单文件 5 MiB、来源快照总计 200 MiB。

## 6. 本地状态与发布隔离

来源绝对路径和上次导入文件哈希只写入：

```text
.sclaw/local/template-source-import.json
```

`.sclaw/` 不进入模板 ZIP，因此来源绝对路径不会提交到模板 OSS 产物。用户完成上传、AI 修改和预览确认后，仍需单独点击“发布模板”并再次确认，才会生成新的模板版本。

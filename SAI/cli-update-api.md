# CLI Update API

> 公开接口，无需鉴权。为 sai CLI 提供版本检查与二进制包下载能力。

## GET /api/v1/cli/update

查询指定平台/架构当前生效的最新 CLI 发布信息。

说明：
- 接口当前总是返回该平台/架构的“最新发布信息”，不会额外返回 `needsUpdate` 字段。
- 客户端需要自行根据 `currentVersion` 与返回的 `latestVersion` 比较，判断是否提示升级。
- `downloadUrl` 由服务端按 `object_key` 实时生成 OSS 签名地址，默认有效期 1 天。
- `forceUpdate` 可能由以下任一条件触发：
  - 发布记录本身配置了强制更新
  - `latestVersion` 的主版本号高于当前版本，且差值达到强更阈值
  - 发布记录配置了 `minRequiredVersion`，且当前版本低于该最低要求版本

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `os` | string | 是 | 操作系统：`windows` / `linux` / `darwin`；服务端会转成小写处理 |
| `arch` | string | 是 | CPU 架构：`amd64` / `arm64` |
| `currentVersion` | string | 是 | 当前客户端版本号（semver 格式） |

### 请求示例

```bash
curl -X GET "https://api.example.com/api/v1/cli/update?os=windows&arch=amd64&currentVersion=1.1.0"
```

### 成功响应 (200)

```json
{
  "latestVersion": "1.2.0",
  "downloadUrl": "https://oss.example.com/...",
  "releaseNotes": "v1.2.0: 新增 xxx 功能, 修复 yyy bug",
  "sha256": "abc123def456...",
  "forceUpdate": false,
  "publishedAt": "2026-04-28T10:00:00Z"
}
```

### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `latestVersion` | string | 当前平台/架构命中的最新发布版本号 |
| `downloadUrl` | string | 安装包下载地址；通常为实时生成的 OSS 签名 URL |
| `releaseNotes` | string | 发布说明；无内容时为空字符串 |
| `sha256` | string | 安装包 SHA256 校验值；未配置时为空字符串 |
| `forceUpdate` | boolean | 是否建议客户端按强制升级处理 |
| `publishedAt` | string | 发布时间，RFC 3339 UTC 字符串，示例：`2026-04-28T10:00:00Z` |

### 错误响应

| HTTP 状态码 | 场景 | 响应示例 |
|------------|------|---------|
| 400 | 参数缺失或格式错误 | `{"error": "missing required parameter: os"}` |
| 400 | 平台不支持 | `{"error": "unsupported platform: freebsd, supported: windows, linux, darwin"}` |
| 400 | 架构不支持 | `{"error": "unsupported arch: riscv64, supported by windows: amd64, arm64"}` |
| 404 | 找不到匹配平台/架构的更新包 | `{"error": "no update available for linux-arm64"}` |
| 500 | 服务端内部错误 | `{"error": "internal server error"}` |

---

## GET /api/v1/cli/download/{platform}-{arch}/sai.exe

下载指定平台/架构的 CLI 二进制文件。服务端查询当前 `active` 状态发布后，返回 302 重定向到 OSS 签名 URL。

说明：
- 当前路由路径字面量固定为 `.../sai.exe`，即使 `linux` / `darwin` 平台也是同一访问路径格式。
- 服务端内部按 `{platform}` + `{arch}` 查找最新 `active` 发布，不额外校验平台枚举值；查不到时直接返回 404。
- 签名 URL 默认有效期 1 天。

### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `platform` | string | 平台：`windows` / `linux` / `darwin` |
| `arch` | string | 架构：`amd64` / `arm64` |

### 请求示例

```bash
curl -L -O "https://api.example.com/api/v1/cli/download/windows-amd64/sai.exe"
```

### 成功响应

HTTP 302 重定向到 OSS 签名 URL（有效期 1 天），最终返回 `application/octet-stream` 二进制流。

### 错误响应

| HTTP 状态码 | 场景 | 响应示例 |
|------------|------|---------|
| 404 | 无可用发布 | `{"error": "no update available for windows-amd64"}` |
| 500 | 服务端内部错误 | `{"error": "internal server error"}` |

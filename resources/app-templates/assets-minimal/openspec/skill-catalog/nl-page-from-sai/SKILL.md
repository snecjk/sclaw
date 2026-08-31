---
name: nl-page-from-sai
description: >-
  自然语言建页需要业务接口时，先通过 external-service list/describe 按需读取服务说明；
  没有匹配服务再回退 discover/help。绝对 HTTP 地址用 ensure-dev-proxy 注册域名，页面/action 只写 /proxy/<key>/...；
  开发走 Vite proxy，生产由 request.ts 按合约还原为真实域名（禁止把 /proxy 当生产路径）。
version: 0.1.5
---

# 自然语言建页 → 按需发现外部服务

## 何时启用

用户用自然语言新建/改造页面，且该页**需要调用业务接口**（搜索、列表、分页、看板取数等）。

## 正确做法

1. **先查平台已发布的服务摘要**
   - 执行 `sai-cli siteapp external-service list --keyword "<业务词>" -f json`
   - 用户明确要浏览全部服务时，执行不带 `keyword` 的 `list`
   - 多个合理候选时先让用户选择，不得批量读取说明

2. **只读取一个明确版本的说明**
   - 使用候选的 `serviceId` 和 `latestVersion` 执行 `sai-cli siteapp external-service describe --serviceId <serviceId> --version <latestVersion> -f json`
   - `hasUsageGuide=false` 或说明不足时向用户确认，禁止猜测 method、path、params 和 response
   - 平台没有匹配服务时，回退原始 sai-cli 接口发现流程：
     - **先引导用户指定 CLI 接口**，再生成并绑定真实取数；未指定前不要臆造 URL / 命令路径去接真接口
     - 引导话术示例：「这个页面需要接业务数据。请告诉我要用哪条 sai-cli 指令（例如：一口价运费查询），指定后我再按该指令的参数和字段生成搜索/列表。」
     - 若用户说不清命令名，可执行 `sai-cli discover "<业务词>"`，把候选列出来**请用户指定一条**；仍以用户指定为准
     - 用户指定后执行 `sai-cli help <product> <module> <action>`

3. **按 usageGuide 或 help 接入**
   - 从 usageGuide 或 help 得到真实 HTTP 地址（若有）后，**必须**先注册开发代理，再写相对 path：
     ```bash
     node scripts/ensure-dev-proxy.mjs "https://example-api.sto.cn/api/xxx"
     ```
     命令输出 `relativeUrl`（如 `/proxy/example-api-sto-cn/api/xxx`）写入 `contracts/action-registry.v1.json` 的 `url` 或页面请求 path
   - **禁止**把 `https://...` 绝对地址写进页面或 action（本地预览会 CORS）
   - **禁止**假设生产静态站点存在 `/proxy/...` 路由：生产构建里 `src/lib/request.ts` 会按 `contracts/dev-proxy.v1.json` 把 `/proxy/<key>/...` **自动还原**成 `target + path`
   - 用 usageGuide 或 help 的参数说明、示例、`outputFields` 生成 `docs/api`、页面（及菜单，若用户提了）
   - 新增了 proxy 域名后提示用户**刷新/重启预览**（Vite 需加载新 proxy）

4. **用户只要壳、明确先不接真接口**
   - 可用 mock 出页，并说明：之后可通过已注册外部服务接入

## 环境约定（强制）

| 环境 | `/proxy/<key>/...` 行为 |
|------|-------------------------|
| 本地 / Claw 预览 (`import.meta.env.DEV`) | 原样请求，由 Vite `server.proxy` 转发 |
| 生产构建 / 发布平台 | `request.ts` 查 `dev-proxy.v1.json`，改写为 `https://<target>/...`，**不得**请求发布域名下的 `/proxy/...` |

## 预览 CORS / 直连报错时

若控制台出现 `blocked by CORS` 或直连 `*.sto.cn` 失败：

1. 从报错里取出绝对 URL
2. 运行 `node scripts/ensure-dev-proxy.mjs "<绝对URL>"`
3. 把 action-registry / 页面里对应 url 改成输出的 `relativeUrl`（`/proxy/...`）
4. 重启预览后再试

若**生产环境** Network 里仍出现 `https://page-*.sto.cn/proxy/...` 404：说明未走 `request.ts` 的解析，或 `dev-proxy.v1.json` 缺对应 key——修好请求封装与合约，不要在生产网关再挂一套 `/proxy`。

## 禁止

- 未读取 usageGuide/help（或用户未明确接口）就编造 URL、CLI 或字段并绑定真实取数
- 页面或 action 使用绝对业务域名（开发必须走 `/proxy/<key>/...`）
- 把 `/proxy` 当成生产可用路径，或为生产静态站单独配置 `/proxy` 路由来「兼容」泄漏
- 多候选时静默选型，或一次 describe 多个服务

## 与其它技能

- 字段与契约 → `api-contract`
- 页面验收 → `ui-checklist`

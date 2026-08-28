# PC 企业应用模板

本模板 = **公司发布平台 Vite 工程底座** + **antd PC 三栏工作台** + **请求封装**。

## 默认布局

1. **顶部一级导航**：Logo、应用名、横向菜单、用户信息
2. **左侧二级导航**：随顶部菜单切换
3. **正文区域**：业务页面容器

## 请求封装

```ts
import { http, request } from '@/lib/request';

// 约定：业务 path 写成 /proxy/<key>/...
// - 开发：Vite server.proxy 转发
// - 生产：request.ts 按 contracts/dev-proxy.v1.json 还原为真实域名
await http.get('/proxy/some-key/api/xxx');
await http.post('/proxy/some-key/api/xxx', { id: 1 });

// 身份由 @sto/sclaw-plugin-sso-auth 初始化，
// 后续请求自动附加 Header：stoToken / Authorization
```

开发环境**禁止**浏览器直连 `https://*.sto.cn`（会 CORS）。新接口域名先注册代理：

```bash
node scripts/ensure-dev-proxy.mjs "https://baseinfo-chatbotapi-test.sto.cn/api/robot/page"
# → 写入 contracts/dev-proxy.v1.json
# → relativeUrl: /proxy/baseinfo-chatbotapi-test-sto-cn/api/robot/page（写入页面/action）
# → absoluteUrl: https://baseinfo-chatbotapi-test.sto.cn/api/robot/page（生产由 request 自动还原）
```

`vite.config.ts` 只在 **dev server** 读取该契约生成 `server.proxy`。
生产构建**没有** `/proxy` 路由；`src/lib/request.ts` + `src/lib/resolve-api-url.ts` 负责改写。

## 目录

| 路径 | 说明 |
|---|---|
| `src/layouts/` | 顶部 / 侧栏布局与导航配置 |
| `src/pages/` | 首页、组件示例、占位业务页 |
| `src/lib/request.ts` | fetch 封装（插件身份 + 生产 proxy 还原） |
| `src/lib/resolve-api-url.ts` | `/proxy/<key>` ↔ 真实域名 |
| `src/sclaw/` | SClaw 插件静态注册与启动入口 |
| `contracts/dev-proxy.v1.json` | 代理合约：key → target（dev + prod 共用） |
| `scripts/ensure-dev-proxy.mjs` | 引入新绝对 URL 时自动登记 proxy |
| `src/catalog/` `src/runtime/` `src/pages/*.page.json` | 保留的 A2UI 能力（可选扩展） |
| `vite.config.ts` | 公司发布平台构建约定（产物 `build/`）+ dev proxy |

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build        # vite build
npm run typecheck    # 可选：tsc -b
```

产物输出到 `build/`。

## 身份认证

Site 默认安装 `@sto/sclaw-plugin-sso-auth`。本地预览通过 Vite 同源端点复用当前登录 SClaw 的用户身份；发布后由部署平台注入 `window.__STO_SSO_AUTH_CONFIG__`，插件负责单点登录、Code 换票和会话管理。业务页面不得自行读取 Cookie、拼接 SSO URL 或调用换票接口。

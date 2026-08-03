# PC 企业应用模板

本模板 = **公司发布平台 Vite 工程底座** + **antd PC 三栏工作台** + **请求封装**。

## 默认布局

1. **顶部一级导航**：Logo、应用名、横向菜单、用户信息
2. **左侧二级导航**：随顶部菜单切换
3. **正文区域**：业务页面容器

## 请求封装

```ts
import { http, request } from '@/lib/request';

// 默认 credentials: 'include'（携带 cookie）
await http.get('/api/xxx');
await http.post('/api/xxx', { id: 1 });

// URL 若带 ?stoToken=...，启动时写入 sessionStorage，
// 后续请求自动附加 Header：stoToken / stotoken
```

## 目录

| 路径 | 说明 |
|---|---|
| `src/layouts/` | 顶部 / 侧栏布局与导航配置 |
| `src/pages/` | 首页、组件示例、占位业务页 |
| `src/lib/request.ts` | fetch 封装（cookie + stoToken） |
| `src/lib/auth-token.ts` | URL / session stoToken |
| `src/catalog/` `src/runtime/` `src/pages/*.page.json` | 保留的 A2UI 能力（可选扩展） |
| `vite.config.ts` | 公司发布平台构建约定（产物 `build/`） |

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

# iframe 分析子应用模板

这是一个 SClaw 内置 **Assets** 模板，适用于由政策管家等主应用通过 iframe 承载的单页分析页面。

## 包含内容

- iframe 宿主身份桥接：可信来源校验、`stoToken` 获取和 Token 失效通知。
- 不含顶部栏、左侧菜单、标签页或站内路由的单页分析看板。
- 筛选区、指标卡、趋势图、分类分布和明细表。
- 明确标记的模拟数据，便于先预览页面结构。

## 应用编码配置

发布环境优先从 `window.__SCLAW_APP_CONFIG__.applicationId` 读取应用编码；本地模拟发布态可配置 `VITE_SCLAW_APPLICATION_ID`。二者都不存在时，应用会提示缺少配置，避免向宿主发送错误身份请求。

## 接入真实数据

模拟数据直接写在 `src/pages/AnalysisPage.tsx` 的 `metrics`、`trend` 和 `rows` 中。接入业务接口时，在该页面把这些模拟数据替换为接口调用结果即可；若接口需要 `stoToken`，可调用 `getIframeStoToken()` 获取。

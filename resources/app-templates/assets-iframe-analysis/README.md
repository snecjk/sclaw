# iframe 分析子应用模板

这是一个 SClaw 内置 **Assets** 模板，适用于由政策管家等主应用通过 iframe 承载的单页分析页面。

## 包含内容

- iframe 宿主身份桥接：可信来源校验、`stoToken` 获取和 Token 失效通知。
- 不含顶部栏、左侧菜单、标签页或站内路由的单页分析看板。
- 筛选区、指标卡、趋势图、分类分布和明细表。
- 明确标记的模拟数据，便于先预览页面结构。

## 身份桥接

发布环境通过 iframe 宿主身份桥接获取登录 Token。桥接仅校验当前 iframe 窗口、可信宿主来源、协议版本与请求 ID，不依赖应用编码配置。

## 接入真实数据

模拟数据直接写在 `src/pages/AnalysisPage.tsx` 的 `metrics`、`trend` 和 `rows` 中。接入业务接口时，在该页面把这些模拟数据替换为接口调用结果即可；若接口需要 `stoToken`，可调用 `getIframeStoToken()` 获取。

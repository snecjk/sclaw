# 外部服务接入

通过公司 `sai-cli` 按需读取已发布外部服务的使用说明，再接入业务 API。

## 工作流程

1. 当前需求不涉及外部业务数据时，不调用外部服务命令。
2. 已知业务关键词时执行 `sai-cli siteapp external-service list --keyword "<关键词>" -f json`；用户明确要浏览全部服务时执行不带 `keyword` 的 `list`。
3. 摘要只用于选择候选。存在多个合理候选时先让用户确认，不得批量读取服务说明。
4. 确定候选后，使用其 `serviceId` 和 `latestVersion` 执行：
   `sai-cli siteapp external-service describe --serviceId <serviceId> --version <latestVersion> -f json`。
5. 一次只 describe 一个明确版本；读取 `usageGuide` 后再修改业务代码。
6. `hasUsageGuide=false`、说明不足或运行前提不满足时，向用户确认 method、path、params、response 或缺失配置，禁止猜测接口。

## 安全边界

- 禁止把 Token、Cookie、SSO code、API Key 或其他密钥写入代码、JSON、URL 和日志。
- 禁止根据服务名称、描述或环境地址臆造接口。
- 禁止把 daily、stage、online 地址直接硬编码到业务代码。
- `describe` 只提供集成说明，不代表 npm 包已安装、服务已绑定或本地代理已生成。
- 本期 Agent 不执行 `bind`、`upgrade`、`remove` 或自动安装 npm 包。

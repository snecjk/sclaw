# 应用开发 Agent 外部服务渐进发现设计

**状态：已确认，待实施**
**所属项目：sto-claw**

## 目标

应用开发 Agent 在遇到外部业务数据需求时，通过 memory-center 注册的公司 CLI 命令渐进发现服务：先读取摘要，再只加载选中服务的固定版本 `usageGuide`。

## 依赖契约

依赖 memory-center 交付以下命令：

```bash
sai-cli siteapp external-service list
sai-cli siteapp external-service list --keyword "业务关键词"
sai-cli siteapp external-service describe \
  --serviceId <serviceId> \
  --version <latestVersion>
```

`list` 返回服务摘要及 `hasUsageGuide`，`keyword` 可选；`describe` 返回明确不可变版本的完整外部服务配置。

## Agent 行为

1. 不涉及外部业务数据时不调用 CLI。
2. 用户给出业务目标但没有服务 ID 时，执行 `list --keyword`；仅在用户要求浏览全部服务时执行不带关键词的 list。
3. 根据摘要选择候选；多个合理候选时让用户确认。
4. 确定候选后使用 `serviceId + latestVersion` 执行一次 describe。
5. 读取 usageGuide 后再改业务代码；不得根据名称、描述或环境地址猜测接口。
6. 没有 usageGuide、说明不足、SDK 未安装或运行前提不满足时，向用户说明缺口并请求确认。

## 与现有能力的关系

- 现有外部服务管理页面、应用绑定 Host API、生成文件和发布校验保持不变。
- `scripts/external-services.mjs` 与 `sclaw:services` 暂时保留兼容，不再作为 Agent 推荐入口，也不在本期扩展。
- `ensure-dev-proxy.mjs`、`dev-proxy.v1.json` 和运行时请求逻辑不属于本期改动。
- CLI describe 是文档发现能力，不代表 SDK 已安装或服务已绑定。

## 指令优先级

应用开发通用上下文和模板 Skill 统一遵循：

1. 优先用 `siteapp external-service list --keyword/describe` 查平台维护的集成指南；
2. 只有平台外部服务没有匹配结果时，才回退到通用 `sai-cli discover/help`；
3. 不允许同时加载多个 usageGuide；
4. 不允许把三个环境地址直接硬编码进业务代码。

## 非目标

- 通过 Agent 自动 bind、upgrade、remove；
- 自动安装 npm 包；
- 删除旧应用中的 pnpm 脚本；
- 修改本地代理和发布架构；
- 从 usageGuide 推导结构化 OpenAPI。

## 验收

1. Site 与 Assets 新模板使用完全一致的渐进发现规则。
2. 普通页面修改不会调用外部服务 CLI。
3. 外部数据需求会先 list（可带 keyword），后 describe 一个明确版本。
4. 多候选和缺少指南时 Agent 不猜测。
5. 应用开发上下文不再把“用户必须先提供具体 sai-cli 指令”作为唯一入口。

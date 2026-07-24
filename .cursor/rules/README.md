# sto-claw Cursor Rules

这套规则用于约束 AI 在 sto-claw 中的分析、规划、实现、测试和 Review。规则的目标不是让 AI 一次写完，而是让每一步都可判断、可验证、可停止。

## 当前规则入口

| 文件 | 作用 | 加载方式 |
| --- | --- | --- |
| `00-workflow-and-risk.mdc` | T1/T2/T3、AI 工作节奏、Stop Rules、设计稿反哺策略 | 始终加载 |
| `05-engineering-guardrails.mdc` | OpenSpec、依赖与工程配置红线、Renderer/Main 边界 | 始终加载 |
| `01-code-rules.mdc` | Renderer API、状态、表单、React、Zustand、Electron 边界和业务模式 | 修改 `src/` 下 TS/TSX 时加载 |
| `02-styles.mdc` | 当前样式工作基线和已验证视觉资产 | 修改 `src/` 下 TS/TSX/CSS 时加载 |

当前行为边界以以上四个 `.mdc` 为准。`references/01-code-reference.md` 和 `references/02-styles-reference.md` 保存从活跃规则移出的长示例、完整表格和历史说明，仅在对应任务需要时查阅，不自动加载。

其他未列出的 `.md` 文件是提示词、模板和历史方法文档，不是自动执行的 Cursor Rules。

## 先判断 Tier

### Tier 1：低风险

样式、文案、图标和不改变逻辑的视觉状态。只允许修改完成视觉目标所需的内容；一旦触及 props、hooks、store、API、路由、IPC 或持久化，停止并重新分级。

### Tier 2：中风险

小交互、小组件、新页面、已有接口功能和局部重构。先读旧代码，再比较方案，人确认后拆成小步骤；每一步都测试和 Review。

### Tier 3：高风险

新项目、大功能、多模块、多接口、权限、架构、通信或工程配置。必须使用 OpenSpec 并经过技术评审，分步实施和验证。

## 当前样式策略

- 最新、已确认的设计稿是当前任务的第一视觉依据。
- `02-styles.mdc` 是动态资产，不是最终公司设计规范。
- 新设计稿先在页面验证，再把稳定、可复用的结论反哺给 `02-styles.mdc`。
- 单页面特例必须标注适用范围，不能直接升级成全局规则。
- 公司设计规范齐全后，再统一校准 Token、Rules 和历史页面。

## 接口与 OpenSpec

- AI 不得猜 URL、method、字段、枚举、错误结构和返回类型。
- 优先读取现有 API client、共享类型、`docs/api-contracts/` 和相关 OpenSpec。
- 新功能和 Tier 3 变更遵循 `proposal -> design -> specs -> tasks -> apply`。
- 接口未准备好时使用 `@mock` / `MOCK_` / `.mock.ts` 明确标注，并写清待接契约。

## 使用方式

1. 让 AI 复述需求、验收标准和不可修改边界。
2. 判断 Tier，并进入 Analyze；复杂任务先 Plan，不直接实现。
3. 确认方案和任务拆分。
4. 一次完成一个步骤，立即测试和检查 diff。
5. 触发 Stop Rules 时停止补丁，回到 Analyze / Plan。
6. 交付前完成三态、自测、联调和前端 Review。

## 维护规则

- 规则必须来自真实代码、真实契约或已验证实践。
- AI 写错一次先修任务；同类问题重复出现，再把稳定结论写入规则。
- 规则与项目不一致时，以真实项目和人工确认结果为准，并同步修正规则。
- 不把临时方案、单页面特例和未确认建议写成全局硬规则。

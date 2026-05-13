# SAI项目周报 | 2026-04-20 ~ 2026-04-24

> **项目**: SAI（申通 AI 智能体平台） | **D1-D5**  
> **报告周期**: 2026-04-20（周一）~ 2026-04-24（周五）  
> **数据来源**: http://gitlab.sto.cn/sai/docs.git  
> **报告人**: 小七（AI 助手）

---

## 一、里程碑性进展

| 里程碑 | 说明 |
|--------|------|
| **项目启动 & 基础设施搭建** | 6 个代码仓库创建、Git 权限开通、docs 公共文档库建立、项目管理方案v1.0 发布 |
| **CLI 架构方向落定** | 从"各业务域各自开发 CLI"演进为"Harness Manager 统一构建单一 sai-cli"，职责边界清晰收敛 |
| **CLI 管理接口测试环境发布** | CLI 命令元数据 AI 生成 + 命令上报接口联调中，CLI 包主体开发完成，登录鉴权打通 |
| **各域 API 注册落地** | 运营/网络/政策/财务 4 域共 8 个 API 完成注册，本地 CLI 可执行 |
| **LiteLLM 网关生产环境部署** | 前后端应用 + RDS + Redis + PostgreSQL 部署完成，公网域名申请完成，日志采集 + 告警配置就绪 |
| **LiteLLM 全用户体系链路贯通** | Organization → Team → User → Key 全链路打通，Key 额度与有效期全流程管控 |
| **AgentRun 核心功能开发测试闭环** | MSE 路由注册/清理、SVC 注册/清理、OSS 挂载、Pod 释放、空闲 Pod 扩容，全部开发+测试完毕 |
| **申懂懂 APP 一期需求评审通过** | PRD 定稿，430 轻量级 Demo 和 512 版本功能边界明确 |
| **agent-gateway 框架搭建** | 项目框架初始化，分布式锁防 Agent 实例重复创建，OSS 挂载 Apollo 配置，多产品登录态适配 |
| **赵柏敏跨模块设计评审完成** | 5 个模块逐一 review，产出 7 项关键缺失和 6 项矛盾点，P0/P1/P2 优先级行动项已明确 |

---

## 二、各模块进展详情

### ① Agent Runtime（奕杭）

**已完成：**
- 用户隔离方案确定（基于 AgentRun serverless，session_id 单 session 单实例）
- SKILL 隔离方案确定（docker 文件目录挂载，workspace/systemspace 分离）
- 与徐总 serverless 层接口澄清（`get_session` / `send_request` 两个核心接口）
- 通用 Agent 代码 review（CLI 登录态达成一致）
- 通用 Agent 页面 SDK PC 端 demo 跑通（AI 销售助理）
- ACP 协议兼容性设计
- agent-gateway 项目框架初始化
- SKILL 与 CLI 资源路径映射方案确定（与隋云团队对齐）
- AI 销售助理三个核心技能迁移至 SAI项目空间（线索/报价/标书）

**进行中 / 待办：**
- SKILL 与 CLI 外部资源路径配置代码开发（预计下周二完成）
- Serverless POD 动态伸缩容联调（暂定下周三，@徐定仙）
- 430 MVP 功能联调：申懂懂 → agent-gateway → Agent(serverless) 链路
- Agent Runtime 正式设计文档补齐（架构图、接口定义、错误处理）
- 与 HM 的 Skill 拉取接口契约定义

---

### ② Harness Manager（隋云）

**已完成：**
- 上下游依赖共识达成（覆盖昆仑域、网络域、政策域、财务域）
- Harness-CLI 设计方案（单 CLI 统一封装，v1.2）
- CLI 注册上报数据结构规范（9 维 Tag 设计 D1-D9）
- CLI 管理接口测试环境发布（元数据 AI 生成 + 命令上报）
- CLI 包主体开发（本地缓存 + 动态加载网关命令清单）
- 登录鉴权基本能力打通
- 技能广场 OSS 挂目录迁移（与 Agent 启动挂载 OSS 对齐）
- CLI 二进制构建机制与鉴权兼容设计
- 与 Agent 交互通过 OSS 路径挂载方式确定

**进行中 / 待办：**
- CLI 命令元数据 AI 生成联调（聚焦 9 维 Tag 输出稳定性）
- CLI 命令上报接口联调（发布/更新/下线状态一致性）
- `validate` / `--dry-run` 执行前安全校验设计
- `list` 命令增强（按产品/模块/标签/查询词过滤）
- `discover` 协议字段扩展（matchReason、missingFlags、confidence、riskLevel）
- CLI 注册平台搭建
- 命令发现和执行全链路监控搭建
- OSS 分发细节补充（版本管理、缓存策略、增量同步）

---

### ③ LLMRouter（徐春辉）

**已完成：**
- LLM Gateway建设方案定稿（LiteLLM 选型）
- 生产环境全量部署（Secret、ConfigMap、STS、Service、MSE 配置）
- 前后端应用与 RDS 资源自动化部署
- Redis + PostgreSQL 中间件采购配置与环境初始化
- 公网域名申请 + Pod 运行状态告警规则
- 网关模型配置加载 + 本地 CLI BaseURL 智能路由
- Lite-LLM WebUI 动态配置（ConfigMap 静态 → WebUI 动态）
- 钉钉审批回调流程开发 + AI AppKey 审批申请流程
- 钉钉工作通知能力（配额审批实时通知）
- LiteLLM 全用户体系链路贯通（Organization → Team → User → Key）
- Key 额度与有效期全流程管控
- 大模型健康监控核心逻辑开发（自动调用 /health、探针二次确认、钉钉告警）
- 计费模式对比验证（百炼 Token 计费为最优方案）
- AgentRun MSE流量分流方案迭代（业务网关 + 控制器联动）
- AgentRun 430 交付清单明确（应用设置、调度接口、Pod 自动释放、MSE 路由注册/清理）
- 冷启动方案对比分析（ACS 20-30s vs 宿主机 ~5s）

**进行中 / 待办：**
- LLM Gateway 核心业务流程优化（下周一项目可用目标）
- 宿主机模式自动化扩容方案调研（满足 5s 冷启动目标）
- 宿主机模式安全隔离防护评估（Privileged 模式风险）
- LLM Gateway 逃生方案（bypass 模式 / fallback 直连）
- LLM Gateway 前端技术选型确认
- 文档中 New API vs LiteLLM 描述矛盾统一

---

### ④ CLI API（凌雪）

**已完成：**
- 各域 CLI 一期范围规划（160+ CLI 需求项梳理）
- 运营域 CLI demo（SAI CLI 设计文档 v1.0 定稿）
- SAI CLI 架构设计文档 v1.1/v1.2 迭代升级
- 各域 API 注册方案确定（4 域 8 个 API：运营/网络/政策/财务）
- 各域 API 接入落地，本地 CLI 可正常执行
- CLI 开发规范确定（Golang、OSS 挂载、SSO Token 鉴权）

**进行中 / 待办：**
- Tag 生成效果优化（业务区分度不足、数据精细度不够，D7 触发关键词未输出）
- CLI 一期交付推进（CLI + tag）
- 组织 code 处理方案（本期未建设 NL 转组织 code 能力，需人工提供）
- API 调用率及执行成功率数据获取方案讨论

---

### ⑤ Channel（弘宇）

**已完成：**
- 输入输出层设计（输入框全量调研与交互规则定义）
- 基础体系搭建（企业 AI 与 C 端 AI 差异分析、文案调性规范、用户角色体系）
- 产品框架调研（通义千问、豆包、Kimi 深度调研）
- 申懂懂 APP MVP 一期功能范围锁定
- 一期需求 PRD 定稿并通过多方评审
- 430 版本轻量级 Demo 方案确定（SDK 小窗口接入）
- 512 版本功能边界与优先级对齐
- 项目初始化搭建，微应用装载至主应用验证通畅
- 聊天功能对接本地接口，数据链路初步跑通
- 对话策略设计（意图路由、来源标注、数据异常提示、权限边界、对话边界引导、能力降级兜底）
- 对话输出阶段设计规范（生成态/结果态/使用态）
- 追问推荐机制设计（四级递进策略）

**进行中 / 待办：**
- Channel 设计文档产出（前端架构 + 消息协议 + 与 Agent Runtime 接口定义）
- 512 版本高保真设计稿（对话页、首页、侧边栏等核心页面）
- 从本地接口切换至后端环境接口全链路联调
- 生成式 UI 方案（React 版本不兼容，待解决）
- 登入登出权限控制（是否复用申懂懂登入登出流程）

---

## 三、风险汇总

### 关键缺失（赵柏敏 review 结论）

| 风险 | 说明 | 责任人 |
|------|------|--------|
| **LLM Gateway 逃生方案缺失** | 网关一旦故障，所有 AI 调用都会断，至今无具体方案 | 徐春辉 |
| **Agent Runtime ↔ HM 接口契约未定义** | Skill 拉取、CLI 拉取的具体 schema 未定义 | 奕杭/隋云 |
| **HM 知识库和 Skills 分发设计缺失** | 知识库数据源、向量存储方案、检索算法、Skill 格式、版本管理未定义 | 隋云 |
| **全局错误码体系缺失** | 各模块各自定义错误码，没有全局统一标准 | 全员 |
| **性能与容量规划缺失** | 无 QPS/并发用户数/Token 消耗预估/存储容量规划 | 全员 |

### 跨文档矛盾（赵柏敏 review 结论）

| 矛盾 | 说明 | 责任人 |
|------|------|--------|
| **LLM Gateway 管理接口工具名不一致** | 建设方案写"调用 New API 管理接口"，但选型结论是 LiteLLM，两者 API 完全不同 | 徐春辉 |
| **CLI 开发职责在两版方案中完全相反** | v1.0 说各业务域各自开发 CLI，v1.2 说 HM 统一构建单一 CLI，如果业务域按 v1.0 在开发会全部返工 | 隋云/凌雪 |
| **OSS 挂载在 AR 中是 Block 点，在 CLI v1.2 中假设已可用** | Agent Runtime方案说个性化 OSS 挂载是 Block 点，但 CLI v1.2 假设已可用且有详细路径规范 | 徐春辉/奕杭 |
| **Tag 生成方式不一致** | 整体架构暗示业务方手动注册，CLI v1.2 说由 AI 自动生成，业务域不知道听谁的 | 隋云 |
| **冷启动方案在不同文档中描述不一致** | LLM Gateway方案写 K8s 部署，Agent Runtime 写函数计算，徐春辉日报写 ACS vs 宿主机 | 徐春辉 |
| **Agent Runtime 文档完全不提及 HM** | 奕杭的方案写"看隋云那边 skill 分发的策略"，没有任何对 HM 接口的引用或依赖描述 | 奕杭 |

---

## 四、待办事项汇总

### 近期待办

| 序号 | 事项 | 责任人 | 模块 |
|------|------|--------|------|
| 1 | 产出 Channel 设计文档（最小版：前端架构 + 消息协议 + 与 Agent Runtime 接口） | 弘宇 | Channel |
| 2 | 确认 LLM Gateway 逃生方案（bypass 模式或 fallback 直连） | 徐春辉 | LLMRouter |
| 3 | 奕杭 + 隋云对齐 Agent Runtime ↔ HM 接口契约（Skill 拉取、CLI 拉取 schema） | 奕杭/隋云 | Agent Runtime/HM |
| 4 | 确认阿里云 OSS 个性化挂载评估结果，无结论则启动 B 方案 | 徐春辉/奕杭 | Agent Runtime |
| 5 | 奕杭补充 Agent Runtime 正式设计文档（架构图、接口定义、错误处理） | 奕杭 | Agent Runtime |
| 6 | 隋云补充 OSS 分发细节（版本管理、缓存策略、增量同步） | 隋云 | Harness Manager |
| 7 | 定义全局错误码体系 | 全员 | 跨模块 |
| 8 | 补充 HM 知识库和 Skills 分发设计 | 隋云 | Harness Manager |
| 9 | Tag 生成工具交付时间表 | 隋云/文鹏 | Harness Manager |

### 持续跟进

| 序号 | 事项 | 责任人 | 模块 | 截止日期 |
|------|------|--------|------|---------|
| 10 | CLI 命令元数据 AI 生成联调 | 隋云 | Harness Manager | 滚动推进 |
| 11 | CLI 命令上报接口联调 | 隋云 | Harness Manager | 滚动推进 |
| 12 | CLI 一期交付（CLI + tag） | 凌雪/头鸽/隋云 | CLI API | 4/29 |
| 13 | LLM Gateway一期上线 | 徐春辉 | LLMRouter | 4/30 |
| 14 | AgentRun 430 交付清单（调度接口、Pod 自动释放、MSE 路由注册/清理） | 徐春辉 | LLMRouter | 4/30 |
| 15 | 430 MVP：申懂懂嵌套通用 Agent 前端 SDK | 奕杭/弘宇 | Agent Runtime/Channel | 4/30 |
| 16 | SKILL 与 CLI 资源映射开发完成 | 奕杭 | Agent Runtime | 下周二 |
| 17 | Serverless POD 伸缩容联调 | 奕杭/徐定仙 | Agent Runtime | 下周三 |
| 18 | Tag 生成效果优化 | 文鹏/隋云 | Harness Manager | 待定 |
| 19 | CLI 注册平台搭建 | 隋云 | Harness Manager | 待定 |
| 20 | 命令发现和执行全链路监控搭建 | 隋云 | Harness Manager | 待定 |
| 21 | 512 版本高保真设计稿 | 弘宇 | Channel | 待定 |
| 22 | 生成式 UI 方案（React 版本兼容） | 弘宇 | Channel | 待定 |

---

## 五、下一期重点（4/27 ~ 4/30）

### 核心目标：430 里程碑交付

| 模块 | 交付内容 | 责任人 |
|------|---------|--------|
| LLMRouter | LLM Gateway一期上线（最小可用：网关 + 手动发 key + 基础告警 + 健康监控） | 徐春辉 |
| Agent Runtime | 申懂懂嵌套通用 Agent 前端 SDK，通过 agent-gateway 实现「你好」对话能力 | 奕杭 |
| CLI API | 一期 CLI 交付（4 域 8 个 API + tag） | 凌雪/头鸽/隋云 |
| Harness Manager | CLI 管理接口正式发布 | 隋云 |
| Channel | 430 轻量级 Demo 验证（SDK 小窗口接入） | 弘宇 |

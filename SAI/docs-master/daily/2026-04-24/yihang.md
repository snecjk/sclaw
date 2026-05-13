# SAI 项目日报

**日期**：2026年4月24日 
---

##一、各模块进展

### 1. Agent_ai_claw

#### 1.1 SKILL 与 CLI 资源路径映射方案

与隋云团队完成 Skill 和 CLI 资源路径对齐，确定与本地 `.claude` 资源的映射关系方案，预计下周二完成相关开发。

**SKILL 目录映射** — 系统支持将外部技能目录挂载至统一的 `.claude/skills/` 目录下，映射关系如下：

| 源目录 | 挂载目标 |
|---|---|
| `sai/skill/system/` | `/mnt/sai/skill/system/.claude/skills/` |
| `sai/skill/public/` | `/mnt/sai/skill/public/.claude/skills/` |
| `sai/skill/{wtcodexxx}/` | `/mnt/sai/skill/private/.claude/skills/` |

> 挂载后，各技能在对应目录下按 `SKILL.md` 格式定义，系统将自动加载。

**CLI 目录映射** — 系统支持将外部 CLI 工具目录挂载至统一路径，映射关系如下：

| 源目录 | 挂载目标 |
|---|---|
| `sai/cli/sai-cli` | `/mnt/sai/cli/sai-cli` |

> 挂载后，CLI 工具可在对应目标目录下直接使用。

#### 1.2 外部 SKILL 和 CLI 工具路径配置代码开发（开发中）

预计下周二完成，已完成部分如下：

- 新增 `scripts/create_skill_links.sh` 脚本，用于创建技能目录软链接
- Dockerfile 中集成软链接创建脚本并赋予执行权限
- 更新 `start.sh` 启动脚本，确保服务启动前自动执行软链接创建
- 将 `skillhub` 目录加入 `.gitignore`
- 工具模块新增 `create_skill_link_paths` 函数，支持动态创建软链接结构
- 更新 `README.md`，补充技能目录挂载与软链接映射的详细说明
- 优化文档表格格式与代码块展示，提升可读性

### 2. Serverless 环境

与老徐团队沟通 POD 动态伸缩容方案，确认 API 接口和参数。

> 📌 联调时间暂定下周三 — @徐定仙

### 3. Agent-gateway

**430 里程碑 MVP 代码开发进展：**

- 获取用户沙箱实例时引入分布式锁，防止 Agent 实例重复创建
- Agent 实例创建支持 OSS 挂载 Apollo 配置
- 支持多产品登录态适配（客户管家、申懂懂产品）
- 聊天接口流式 API 开发，已解决输出异常与跨域问题

### 4.AI 销售助理（基于通用 Agent）

三个核心技能已迁移至 SAI 项目空间，各模块优化如下：

| 技能 | 优化内容                                |
|---|-------------------------------------|
| **线索 Skill** | 调整线索领取逻辑，按店铺名称检索与领取拆分为两个独立接口        |
| **报价 Skill** | 逻辑优化：省份信息前置收集、补充大网成本说明、更新 CLAUDE.md |
| **标书 Skill** | 构建标书知识库，技能中新增 RAG 检索逻辑              |

---

## 二、项目里程碑 & 风险

### 430 里程碑目标

> 申懂懂内嵌通用 Agent 前端 SDK → 通过 agent-gateway 路由 → 按用户 session 在 Serverless 上分配 Agent → 实现「你好」对话能力。

### 风险状态

✅ **当前无风险**，前后端均正常开发中。

---

## 三、下周重点

| 事项 | 预计时间 | 责任人 |
|---|---|---|
| Skill/CLI 资源映射开发完成 | 周二 | — |
| Serverless POD 伸缩容联调 | 周三 | @徐定仙 |
| 430 MVP 功能联调 | 持续 | — |
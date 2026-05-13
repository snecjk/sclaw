# Skill 管理平台技术方案

**版本**：v1.0
**更新日期**：2026-04-27
**文档状态**：初稿
**适用范围**：Harness Manager 团队、Agent Runtime 团队、Skill 开发者

---

## 变更记录

| 版本 | 日期       | 变更说明                                                                   |
| ---- | ---------- | -------------------------------------------------------------------------- |
| v1.0 | 2026-04-27 | 初版发布，定义 Skill 管理平台整体架构、核心流程、接口规范                  |
| v1.1 | 2026-04-28 | 调整流程顺序：沙箱测试→人工审核；注册合并到审核通过动作中；版本管理横切化 |

---

## 目录

1. [整体定位与架构](#一整体定位与架构)
2. [Skill 生命周期](#二skill-生命周期)
3. [Skill 定义标准（skill.yaml）](#三skill-定义标准skillyaml)
4. [SkillCompiler 设计](#四skillcompiler-设计)
5. [沙箱测试链路](#五沙箱测试链路)
6. [平台核心功能](#六平台核心功能)
7. [接口定义](#七接口定义)
8. [与现有模块的集成](#八与现有模块的集成)
9. [Skill 与 CLI 的协同决策](#九skill-与-cli-的协同决策)
10. [安全与权限](#十安全与权限)
11. [一期交付范围](#十一一期交付范围)

---

## 一、整体定位与架构

### 1.1 定位

Skill 管理平台是 **Harness Manager（HM）** 的子模块，负责 SAI 体系中所有 Skill（技能/资产）的**全生命周期管理**：创建、测试、审核、发布、版本控制、发布到 OSS。

平台**不参与执行链路**，Agent 通过 OSS 主动拉取（Pull 模式）加载 Skill 执行包。

### 1.2 架构总览

```
┌───────────────────────────────────────────────────────────────────────┐
│                          Skill 管理平台                                │
│                                                                       │
│  主流程：                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────────────┐    │
│  │ Skill    │───→│ 沙箱     │───→│ 审核工作流                    │    │
│  │ 创建/编辑│    │ 测试环境 │    │                                │    │
│  └──────────┘    └──────────┘    │ · 查看代码 + 沙箱测试报告      │    │
│                                  │ · 审核通过 → 自动触发：        │    │
│                                  │   ① 生成 skillId              │    │
│                                  │   ② 写入元数据索引            │    │
│                                  │   ③ SkillCompiler 编译        │    │
│                                  │   ④ OSS 发布                  │    │
│                                  │ · 审核驳回 → 返回开发者修改    │    │
│                                  └──────────────┬───────────────┘    │
│                                                 │                     │
│                                                 ▼                     │
│                                      ┌─────────────────┐              │
│                                      │  OSS 存储        │              │
│                                      │  sai/skill/      │              │
│                                      └────────┬────────┘              │
│                                               │                       │
├───────────────────────────────────────────────┼───────────────────────┤
│  版本管理（贯穿全生命周期，每个阶段自动记录版本）                        │
│                                                                       │
│   草稿版本 ───→ 测试版本 ───→ 候选版本 ───→ 正式版本                   │
│   (创建)        (提交沙箱)      (沙箱通过)     (审核通过)               │
└───────────────────────────────────────────────┼───────────────────────┘
                                                 │ Agent 主动拉取（Pull）
                                                 ▼
                                       ┌─────────────────┐
                                       │  Agent Runtime   │
                                       │  · 拉取索引      │
                                       │  · 加载执行包    │
                                       │  · NLU 决策      │
                                       │  · 执行 Skill    │
                                       └─────────────────┘
```

### 1.3 核心职责

| 职责                      | 说明                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| **Skill 创建/编辑** | 支持开发者手动编写或通过 AI 辅助生成 skill.yaml                   |
| **沙箱测试**        | 自动化测试环境，验证 Skill 正确性、安全性、性能                   |
| **审核工作流**      | 查看代码/沙箱报告 → 通过（自动完成注册发布）/驳回                |
| **版本管理**        | 贯穿全生命周期的版本控制：草稿→测试→候选→正式                  |
| **SkillCompiler**   | 将 skill.yaml 编译为 Agent 可读的 Tool 定义（审核通过时自动触发） |
| **OSS 发布**        | 将编译后的 Skill 包发布到约定 OSS 路径（审核通过时自动执行）      |
| **元数据索引**      | 维护 Skill 元数据索引，供 Agent 发现和拉取（审核通过后自动写入）  |

### 1.4 不做的事

| 不做的         | 原因                                           |
| -------------- | ---------------------------------------------- |
| Skill 执行     | Skill 执行由 Agent Runtime 负责                |
| Skill 分发推送 | Agent 主动拉取，平台不主动推送                 |
| 业务逻辑封装   | Skill 的业务逻辑由开发者定义，平台只管管理流程 |

---

## 二、Skill 生命周期

### 2.1 完整生命周期

```
 创建/编辑
    │
    ├── 保存草稿 → 继续编辑
    │
    ▼
 提交沙箱测试
    │
    ▼
 ┌─ 沙箱测试 ─────────────────────────────────┐
 │                                            │
 │  · 解析 skill.yaml                         │
 │  · 逐条执行测试用例                          │
 │  · 安全检查（静态分析 + 动态检测）            │
 │  · 性能测试（CPU/Mem/耗时）                 │
 │  · 生成测试报告                             │
 │                                            │
 └──┬─────────────────────────────────────────┘
    │
    ├── 沙箱失败 → 驳回 → 开发者修改 → 重新提交
    │
    ▼
 人工审核（沙箱通过后才进入）
    │
    ├── 审核驳回 → 说明原因 → 开发者修改 → 重新提交
    │
    ├── 审核通过 → 自动完成注册发布 ↓
    │     ├── 生成全局唯一 skillId
    │     ├── 写入元数据到索引
    │     ├── 触发 SkillCompiler 编译
    │     ├── 编译产物写入 OSS
    │     └── Agent 可发现、可拉取
    │
    ▼
 运行中（已发布）
    │
    ├── 版本更新 → 走相同流程（创建→沙箱→审核→发布）
    ├── 下线（软删除，保留 30 天可恢复）
    └── 紧急回滚（回退到上一版本）
```

## 三、Skill 定义标准（skill.yaml）

### 3.1 总体结构

skill.yaml 采用**六层分层结构**，自包含所有元数据，不需要额外的 Tag 体系：

```yaml
apiVersion: sai.skills.sto.cn/v1
kind: Skill

# 第1层：元数据（谁做的、什么版本）
metadata:
  name: timeliness-analysis
  version: "1.0.0"
  displayName: "时效趋势分析报告"
  description: "分析时效趋势，检测异常并生成报告"
  author: "zhangsan@sto.cn"
  domain: "operations"
  category: "analysis"
  tags: ["trend", "alert"]
  visibility: "public"  # public | user | system

# 第2层：发现层（给 NLU Pipeline 用，承担"Tag"职责）
discovery:
  intents: ["trend_analysis", "anomaly_detection"]
  keywords:
    exact: ["时效分析", "趋势报告"]
    synonym: ["出港情况", "延误分析"]
    negative: ["单个包裹", "实时查询"]
  dataDomains: ["时效", "滞留"]
  complexity: "medium"
  estimatedDuration: "30-60s"

# 第3层：输入输出契约（Agent 理解参数用）
spec:
  input:
    type: object
    required: [dateRange, metric]
    properties:
      dateRange:
        type: string
        description: "查询日期范围"
        examples: ["last-week"]
      metric:
        type: string
        enum: ["retention_rate", "delivery_time"]
  
  output:
    type: object
    properties:
      summary:
        type: object
      trendData:
        type: array

# 第4层：依赖声明
dependencies:
  cli: ["kunlun.timeliness.query"]
  skills: []
  tools: ["code-interpreter"]

# 第5层：执行环境
runtime:
  language: python
  version: "3.10"
  entryPoint: "main.py"
  dependencies:
    - "pandas>=1.5.0"
  resources:
    cpu: "0.5"
    memory: "256Mi"
    timeout: "60s"
  executionMode: "sandbox"  # sandbox | native

# 第6层：安全与权限
security:
  requiredScopes: ["kunlun:read"]
  dataAccess: ["timeliness-data"]
  riskLevel: "readonly"  # readonly | write | admin
  confirmationRequired: false
```

### 3.2 分层设计意图

| 层级         | 目标读者       | 作用                                       |
| ------------ | -------------- | ------------------------------------------ |
| metadata     | 人类           | "这是什么 Skill？谁做的？什么版本？"       |
| discovery    | NLU Pipeline   | "用户说这句话时，要不要匹配到这个 Skill？" |
| spec         | Agent + 开发者 | "Agent 需要提供什么参数？会拿到什么结果？" |
| dependencies | 执行引擎       | "执行这个 Skill 需要哪些前置条件？"        |
| runtime      | 执行引擎       | "怎么跑这个 Skill？需要什么环境？"         |
| security     | 安全网关       | "需要什么权限？有多危险？"                 |

### 3.3 来源路径

Skill 的创建支持两条路径，与 CLI v1.2 的设计哲学一致：

```
路径 A（AI 辅助生成）：
  开发者提供自然语言描述 → LLM 生成 skill.yaml → 开发者审核修改 → 提交审核

路径 B（手动创建）：
  开发者按标准格式编写 skill.yaml → 提交审核
```

两条路径产出**格式完全一致**的 skill.yaml，只是生成路径不同。

---

## 四、SkillCompiler 设计

### 4.1 定位

**SkillCompiler 是"开发者语言 → Agent 语言"的翻译器。**

在 skill.yaml 和 Agent 之间加一层"适配层"，让两边都能独立演进。

### 4.2 为什么需要 SkillCompiler？

| 如果不用                                 | 用了 SkillCompiler                |
| ---------------------------------------- | --------------------------------- |
| Agent 直接解析 skill.yaml                | Agent 收到优化过的 Tool 定义      |
| skill.yaml 太大，消耗 LLM context window | 编译后只保留必要字段，减少 token  |
| 开发者改了 yaml 格式，Agent 要跟着改     | Agent 只看编译后的稳定接口        |
| yaml 里可能有敏感信息（代码路径等）      | 编译过程过滤掉 Agent 不该看的内容 |
| 搜索时需要遍历完整 yaml                  | 索引条目是专门优化的搜索结构      |

### 4.3 编译流程

```
输入：skill.yaml + Skill 代码包
            │
            ▼
┌───── SkillCompiler 处理流程 ──────────────────────┐
│                                                   │
│  ① 解析 skill.yaml                                │
│     · 提取 discovery 段（给 NLU 用）               │
│     · 提取 spec.input（给 LLM 参数理解用）          │
│     · 提取 dependencies（给执行引擎用）             │
│     · 提取 security（给鉴权层用）                  │
│                                                   │
│  ② 生成 Agent Tool 定义                           │
│     · 标准 OpenAI Function Calling 格式            │
│     · 增加 __agent_meta__ 扩展字段                │
│                                                   │
│  ③ 生成轻量索引条目                                │
│     · 用于 Registry 快速搜索                       │
│     · 不包含完整代码，只含匹配和描述信息            │
│                                                   │
│  ④ 完整性校验                                      │
│     · 计算文件 hash                               │
│     · 生成依赖关系图                               │
│                                                   │
│  ⑤ 输出                                           │
│     · Tool 定义 → 写入 HM Registry                 │
│     · Skill 包  → 写入 OSS                         │
│     · 索引条目 → 写入索引服务                      │
│                                                   │
└───────────────────────────────────────────────────┘
```

### 4.4 编译输出示例

**输出 1：Agent Tool 定义（JSON）**

```json
{
  "name": "timeliness_analysis",
  "description": "分析时效趋势，检测异常并生成报告",
  "parameters": {
    "type": "object",
    "properties": {
      "dateRange": {
        "type": "string",
        "description": "查询日期范围，如 'last-week'"
      },
      "metric": {
        "type": "string",
        "description": "时效指标类型"
      }
    },
    "required": ["dateRange", "metric"]
  },
  "__agent_meta__": {
    "type": "skill",
    "intents": ["trend_analysis", "anomaly_detection"],
    "keywords": {
      "exact": ["时效分析", "趋势报告"],
      "negative": ["单个包裹", "实时查询"]
    },
    "dependsOnCli": ["kunlun.timeliness.query"],
    "complexity": "medium",
    "estimatedDuration": "30-60s",
    "riskLevel": "readonly"
  }
}
```

**输出 2：轻量索引条目（用于 Registry 搜索）**

```json
{
  "skillId": "operations.timeliness-analysis@v1.0.0",
  "displayName": "时效趋势分析报告",
  "domain": "operations",
  "category": "analysis",
  "intents": ["trend_analysis", "anomaly_detection"],
  "keywords": {
    "exact": ["时效分析", "趋势报告"],
    "synonym": ["出港情况", "延误分析"],
    "negative": ["单个包裹", "实时查询"]
  },
  "dataDomains": ["时效", "滞留"],
  "complexity": "medium",
  "riskLevel": "readonly",
  "visibility": "public",
  "createdAt": "2026-04-27T10:00:00Z",
  "updatedAt": "2026-04-27T15:30:00Z",
  "ossPath": "sai/skill/public/timeliness-analysis/v1.0.0/",
  "sha256": "a1b2c3d4..."
}
```

---

## 五、沙箱测试链路

### 5.1 定位

沙箱是审核流程的**前置环节**。开发者提交 Skill 后，首先触发沙箱测试，**只有沙箱测试通过的 Skill 才会进入人工审核环节**。

**关键约束：未通过沙箱测试的 Skill 不允许进入人工审核，更不允许发布。**

### 5.2 架构总览

```
开发者点击「提交沙箱测试」
        │
        ▼
┌─ 沙箱调度器 ────────────────────────────────────────┐
│                                                     │
│  ① 解析 Skill Package                               │
│     · 读取 skill.yaml（元数据、执行入口、依赖声明）    │
│     · 读取 test_cases.json（测试用例集）              │
│                                                     │
│  ② 构建测试上下文                                    │
│     · 生成 testRunId = UUID                         │
│     · 准备 Mock Data（根据 Skill 声明的数据契约）     │
│                                                     │
│  ③ 创建 Sandbox Pod                                 │
│     · K8s Job: spec.backoffLimit=0                  │
│     · Init Container: 注入skill包 + 测试数据          │
│     · Main Container: 按 test_cases 逐条执行         │
│                                                     │
│  ④ 逐条执行 + 实时采集                               │
│     TestCase-1: Happy Path   → ✅ Pass              │
│     TestCase-2: MissingParam → ✅ Pass              │
│     TestCase-3: Timeout      → ❌ Fail              │
│     TestCase-4: PerfNormal   → ⚠️  Warn             │
│                                                     │
│  ⑤ 生成测试报告 JSON                                 │
│  ⑥ 销毁 Sandbox Pod + 清理临时数据                   │
│                                                     │
└─────────────────────────────────────────────────────┘
        │
        ▼
 审核台展示报告 → 审核人决策（通过/驳回/要求修改）
```

### 5.3 五个隔离维度

| 维度               | 隔离手段                                                | 设计意图                          |
| ------------------ | ------------------------------------------------------- | --------------------------------- |
| **网络隔离** | K8s NetworkPolicy:`egress: deny`                      | 防止 Skill 访问内部服务、外网 API |
| **资源隔离** | CPU limit: 1C, Memory limit: 512Mi, 超时: 60s           | 防止恶意/低效 Skill 耗尽资源      |
| **存储隔离** | emptyDir 临时卷，Pod 销毁即清除                         | 不落盘，无数据残留                |
| **凭证隔离** | 不注入任何 AK/SK/Token 环境变量                         | 无法调用需要鉴权的服务            |
| **文件系统** | `readOnlyRootFilesystem: true`，仅 `/sandbox/` 可写 | 防止篡改沙箱环境                  |

### 5.4 测试场景矩阵

| 场景类型          | 输入                 | 期望输出              |
| ----------------- | -------------------- | --------------------- |
| ✅ Happy Path     | 标准入参             | 标准出参 + 成功状态   |
| ⚠️ MissingParam | 缺必填参数           | 结构化错误 + hint     |
| ⚠️ InvalidParam | 参数格式错误         | 结构化错误            |
| ⚠️ EmptyInput   | 空输入               | Graceful 处理         |
| 🔴 Timeout        | 大循环/死锁          | 超时 → 失败          |
| 🔴 OOM            | 大量内存分配         | OOM → 失败           |
| 🔴 NetworkCall    | 代码中尝试 HTTP 调用 | 被 NetworkPolicy 拦截 |
| 📊 PerfNormal     | 标准入参执行 3 次    | P50/P95/P99 < 阈值    |
| 🔒 SecurityScan   | 静态代码扫描         | 无高危模式匹配        |

### 5.5 测试报告结构

```json
{
  "testRunId": "sbox-20260427-a1b2c3",
  "skillId": "operations.timeliness-analysis@v1.0.0-draft",
  "status": "FAIL",
  "summary": {
    "total": 9, "pass": 7, "fail": 1, "warn": 1
  },
  "cases": [
    {
      "caseId": "TC-001",
      "type": "happy_path",
      "status": "PASS",
      "durationMs": 320,
      "input": { "dateRange": "last-week" },
      "output": { "ok": true, "data": {...} },
      "outputSchemaValid": true
    },
    {
      "caseId": "TC-003",
      "type": "timeout",
      "status": "FAIL",
      "durationMs": 60001,
      "error": "Execution exceeded 60s timeout limit",
      "suggestion": "检查是否有无限循环；大数据量查询考虑分页"
    }
  ],
  "security": {
    "staticAnalysis": { "issues": 0 },
    "networkPolicyHits": 0,
    "resourceViolations": []
  },
  "resources": {
    "cpuPeakCores": 0.3,
    "memoryPeakMi": 128,
    "maxDurationMs": 320
  },
  "verdict": {
    "canRegister": false,
    "blockingReason": "TestCase TC-003 超时未通过"
  }
}
```

### 5.6 沙箱 vs 生产环境对比

| 维度     | 沙箱（审核阶段）         | Agent Runtime（生产） |
| -------- | ------------------------ | --------------------- |
| 网络     | 隔离（禁止所有出站）     | 正常访问（有鉴权）    |
| 资源     | 严格限制（CPU/Mem/超时） | 按需分配              |
| 数据     | Mock 数据                | 真实业务数据          |
| 执行模式 | 单 Skill 执行            | 多 Skill/CLI 协同     |
| 驱动方式 | 测试用例驱动             | 用户意图驱动          |

**关键原则：沙箱的 Skill 执行环境应尽可能贴近 Agent Runtime 的真实环境（同基镜像、同 SDK 版本、同 skill.yaml 解析逻辑），确保"沙箱通过 = 生产可用"。**

---

## 六、平台核心功能

### 6.1 Skill 创建/编辑

- 支持 YAML 编辑器（语法高亮、校验）
- 支持 AI 辅助生成：输入自然语言描述 → LLM 生成 skill.yaml
- 支持上传 Skill 代码包（ZIP/TAR）
- 本地保存草稿功能

### 6.2 权限管控

Skill 创建时支持配置**可使用人员范围**，实现精细化的权限管控。创建者可以按**人员**和**部门**两个维度指定哪些用户或部门有权限使用该 Skill。

#### 6.2.1 权限配置方式

| 维度           | 说明                                       | 选择方式                       |
| -------------- | ------------------------------------------ | ------------------------------ |
| **人员** | 指定具体的用户（按用户工号）               | 下拉搜索框，支持关键词模糊匹配 |
| **部门** | 指定整个部门（部门下所有成员自动获得权限） | 下拉搜索框，支持按部门名称搜索 |

- **下拉搜索框交互**：
  - 人员选择框：输入关键词（姓名/工号）后实时搜索，展示匹配结果供选择
  - 部门选择框：输入部门名称关键词后实时搜索，展示匹配的部门列表供选择
  - 支持多选，已选项以 Tag 形式展示在输入框内，可单独删除

#### 6.2.2 权限管控

- 在skill创建或者编辑的时候， 根据权限分配人员动态去新增和删除 oss
  难点： 1、 部门需要转到人员维度，数据量大  2、动态新增和删除部门、人员需要频繁操作OSS
- **（讨论)Agent拉取时做权限控制， 需要推翻之前的OSS约定的方式**

### 6.3 沙箱测试 → 审核工作流

- 开发者提交 Skill 后，**首先触发沙箱测试**
- 沙箱测试通过后，**自动进入人工审核队列**
- 审核台展示：
  - Skill 代码/配置预览
  - 沙箱测试报告（通过率、性能指标、安全扫描结果）
  - 历史版本对比（如有）
- 审核操作：
  - **通过** → 自动完成注册发布（生成 skillId、写入元数据索引、SkillCompiler 编译、OSS 发布）
  - **驳回** → 需填写原因，返回开发者修改
  - **要求修改** → 标注具体问题，开发者修改后重新提交沙箱

### 6.4 版本管理

- 语义化版本控制（`major.minor.patch`）
- 上线指定版本（Agent 只拉取线上生效版本）如果版本变更，**需要和Agent对变更后逻辑怎么处理？版本变更后改OSS，Agent
  每次启动做覆盖逻辑？**
- 版本回滚（回退到上一版本）
- 版本变更日志

### 6.5 Skill 发现与搜索

- 按 domain/category/intent/keyword 筛选
- 语义搜索（基于 discovery.keywords）
- 可见性过滤（system/public/user）

### 6.6 OSS 发布

- 编译产物自动发布到约定路径
- OSS 路径规范：
  ```
  sai/skill/system/{skillId}/v{version}/
  sai/skill/public/{skillId}/v{version}/
  sai/skill/{userId}/{skillId}/v{version}/
  // 约定Agent只拉取，@latest 版本
  sai/skill/system/{skillId}/v{@latest}/
  sai/skill/public/{skillId}/v{@latest}/
  sai/skill/{userId}/{skillId}/v{@latest}/
  ```

---

## 七、接口定义

### 7.1 接口清单

| 编号 | 接口名称        | 方法     | 路径                                                        | 调用方        |
| ---- | --------------- | -------- | ----------------------------------------------------------- | ------------- |
| 7.1  | Skill 创建/更新 | `POST` | `/api/v1/sai/skills`                                      | Skill 开发者  |
| 7.2  | 提交沙箱测试    | `POST` | `/api/v1/sai/skills/{skillId}/submit-sandbox`             | Skill 开发者  |
| 7.3  | 查询沙箱报告    | `GET`  | `/api/v1/sai/skills/{skillId}/sandbox-report/{testRunId}` | 审核人/开发者 |
| 7.4  | 审核通过/驳回   | `POST` | `/api/v1/sai/skills/{skillId}/review`                     | 审核人        |
| 7.5  | Skill 列表/搜索 | `GET`  | `/api/v1/sai/skills`                                      | Agent Runtime |
| 7.6  | Skill 详情      | `GET`  | `/api/v1/sai/skills/{skillId}`                            | Agent Runtime |
| 7.7  | Skill 下线      | `POST` | `/api/v1/sai/skills/{skillId}/unregister`                 | 管理员        |

> **说明**：原 `7.6 注册 Skill` 接口已去除。注册动作合并到 `7.4 审核通过/驳回` 接口中，审核通过时系统自动完成注册发布全流程。

### 7.2 核心接口详细说明

#### 7.2.1 Skill 创建/更新

**请求路径**：`POST /api/v1/sai/skills`

**请求体**：

```json
{
  "action": "create",  // create | update
  "skillYaml": "apiVersion: sai.skills.sto.cn/v1\nkind: Skill\n...",
  "package": {
    "type": "zip",
    "content": "base64encoded...",
    "sha256": "a1b2c3d4..."
  }
}
```

**响应**：

```json
{
  "code": 200,
  "data": {
    "skillId": "operations.timeliness-analysis",
    "version": "1.0.0",
    "status": "draft",
    "createdAt": "2026-04-27T10:00:00Z"
  }
}
```

#### 7.2.2 Skill 列表/搜索（Agent 拉取索引用）

**请求路径**：`GET /api/v1/sai/skills`

**查询参数**：

| 参数           | 类型    | 必填 | 说明                               |
| -------------- | ------- | ---- | ---------------------------------- |
| `domain`     | string  | 否   | 业务域过滤                         |
| `category`   | string  | 否   | 类别过滤                           |
| `intent`     | string  | 否   | 意图过滤                           |
| `keyword`    | string  | 否   | 关键词搜索                         |
| `visibility` | string  | 否   | `system` / `public` / `user` |
| `userId`     | string  | 否   | 用户级 Skill 过滤                  |
| `page`       | integer | 否   | 分页，默认 1                       |
| `pageSize`   | integer | 否   | 每页数量，默认 20                  |

**响应**：

```json
{
  "code": 200,
  "data": {
    "total": 45,
    "page": 1,
    "pageSize": 20,
    "skills": [
      {
        "skillId": "operations.timeliness-analysis@v1.0.0",
        "displayName": "时效趋势分析报告",
        "domain": "operations",
        "category": "analysis",
        "intents": ["trend_analysis"],
        "keywords": {
          "exact": ["时效分析", "趋势报告"],
          "synonym": ["出港情况"],
          "negative": ["单个包裹"]
        },
        "complexity": "medium",
        "riskLevel": "readonly",
        "visibility": "public",
        "ossPath": "sai/skill/public/timeliness-analysis/v1.0.0/",
        "sha256": "a1b2c3d4..."
      }
    ]
  }
}
```

---

## 八、与现有模块的集成

### 8.1 与 Harness Manager 的关系

Skill 管理平台是 HM 的子模块，复用 HM 的基础能力：

- **元数据索引**：Skill 审核通过后，元数据自动写入 HM 索引服务
- **SkillCompiler**：HM 内置模块，审核通过时自动触发编译
- **OSS 存储**：复用 HM 已有的 OSS 挂载机制

### 8.2 与 Agent Runtime 的集成

```
Agent Runtime                          Skill 管理平台
     │                                      │
     │  ① GET /api/v1/sai/skills             │
     │  （拉取 Skill 索引）                   │
     │─────────────────────────────────────→ │
     │                                      │
     │  ② 返回轻量索引列表                    │
     │←───────────────────────────────────── │
     │                                      │
     │  ③ 根据索引中的 ossPath                │
     │     拉取 Skill 执行包                  │
     │  （直接读 OSS，不经过平台）             │
     │                                      │
     │  ④ 加载 Skill 到执行环境               │
     │  ⑤ NLU Pipeline 匹配 Skill            │
     │  ⑥ 执行 Skill                         │
```

**关键约束：Agent 拉取 Skill 不经过 Skill 管理平台，直接从 OSS 读取。** 平台只负责发布到 OSS。

### 8.3 与 CLI 体系的关系

Skill 和 CLI 是**平级的能力单元**，但 Skill 可以调用 CLI：

```
Skill 的 dependencies.cli 声明:
  cli: ["kunlun.timeliness.query"]

Skill 执行时:
  1. Agent 调用 Skill
  2. Skill 内部调用声明的 CLI 命令
  3. CLI 调用后端 API
  4. Skill 处理结果并返回
```

### 8.4 与 LLM Gateway 的关系

Skill 执行过程中如果涉及 LLM 调用（如代码解释器、知识推理），统一通过 LLM Gateway 路由，遵循现有的 Token 管理和成本控制策略。

---

## 九、Skill 与 CLI 的协同决策

### 9.1 NLU Pipeline 中的 Skill/CLI 路由

当 Agent 收到用户输入时，NLU Pipeline 第 ③ 步（Tag 匹配）升级为**能力路由决策**：

```
用户输入 → ①意图分类 → ②实体抽取 → ③能力路由决策
                                      │
                              ┌───────┴───────┐
                              │               │
                       仅命中 CLI        仅命中 Skill
                              │               │
                              ▼               ▼
                        走 CLI 路径      走 Skill 路径
                              │
                       ┌──────┴──────┐
                       │  同时命中     │
                       │  CLI + Skill │
                       └──────┬──────┘
                              │
                       进入「消歧决策」
```

### 9.2 消歧决策机制（四层）

| 层级                   | 决策逻辑                                                   | 实现位置       |
| ---------------------- | ---------------------------------------------------------- | -------------- |
| **L1: 独占声明** | Skill 元数据声明 `exclusiveDomain`，满足条件直接选 Skill | Skill Registry |
| **L2: 覆盖度**   | 比较 CLI/Skill 对用户意图的参数覆盖率，选高者              | NLU Pipeline   |
| **L3: 置信度**   | 比较 matchScore，选高者                                    | NLU Pipeline   |
| **L4: 降级兜底** | 低置信度时反问用户："你是想简单查一下，还是做完整分析？"   | Agent Runtime  |

### 9.3 选择原则

| 原则                 | 说明                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| **原子性优先** | 能用一次 CLI 完成的，不走 Skill。CLI 是"指令"，Skill 是"过程"          |
| **复杂度阈值** | 需要 ≥2 步操作、跨域调用、或知识推理时，才激活 Skill                  |
| **确定性评估** | CLI 的输入输出是确定的 API 契约；Skill 可能包含 LLM 推理→不确定性更高 |
| **成本意识**   | Skill 执行通常比 CLI 消耗更多 token（多轮 LLM 调用）                   |

## 十、一期交付范围

### 10.1 一期目标

实现 Skill 管理平台核心能力，跑通"创建 → 沙箱测试 → 人工审核 → 审核通过自动发布 → OSS → Agent 拉取"完整闭环。

### 10.2 交付清单

| 模块                    | 交付内容                        | 验收标准                                     |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| **Skill 创建**    | skill.yaml 编辑器 + AI 辅助生成 | 支持手动编写和 AI 生成两种方式               |
| **沙箱测试**      | 基础沙箱环境 + 核心测试场景     | Happy Path / MissingParam / Timeout 测试通过 |
| **审核工作流**    | 沙箱通过后自动进入审核 + 审核台 | 可查看代码和沙箱报告，通过时自动完成注册发布 |
| **元数据索引**    | Skill 元数据索引 + 搜索接口     | Agent 可通过接口搜索和拉取 Skill 索引        |
| **SkillCompiler** | 编译为 Agent Tool 定义          | 输出标准 OpenAI Function Calling 格式        |
| **OSS 发布**      | 编译产物发布到约定路径          | 符合路径规范，可被 Agent 拉取                |

### 10.3 二期规划（待定）

- 高级沙箱场景（网络模拟、并发测试、压力测试）
- Skill 使用统计与监控
- Skill 市场/广场（用户浏览、评分、评论）
- Skill 依赖分析（可视化依赖关系图）
- 自动化 CI/CD 集成（GitOps 模式）

---

## 附录

### A. skill.yaml 完整示例

```yaml
apiVersion: sai.skills.sto.cn/v1
kind: Skill

metadata:
  name: timeliness-analysis
  version: "1.0.0"
  displayName: "时效趋势分析报告"
  description: |
    分析指定时间范围内的时效指标变化趋势，
    自动检测异常波动并生成分析报告。
  author: "zhangsan@sto.cn"
  domain: "operations"
  category: "analysis"
  tags: ["trend", "alert", "report"]
  visibility: "public"
  createdAt: "2026-04-27T10:00:00Z"
  updatedAt: "2026-04-27T15:30:00Z"

discovery:
  intents: ["trend_analysis", "anomaly_detection", "report_generation"]
  keywords:
    exact: ["时效分析", "趋势报告", "异常检测"]
    synonym: ["出港情况", "延误分析", "滞留趋势"]
    negative: ["单个包裹", "实时查询", "拦截操作"]
  dataDomains: ["时效", "滞留"]
  complexity: "medium"
  estimatedDuration: "30-60s"

spec:
  input:
    type: object
    required: [dateRange, metric]
    properties:
      dateRange:
        type: string
        format: date-range
        description: "查询日期范围，如 'last-week', '2026-04-01~2026-04-07'"
        examples: ["last-week", "2026-04-01~2026-04-07"]
      metric:
        type: string
        enum: ["retention_rate", "delivery_time", "overall_timeliness"]
        description: "时效指标类型"
        alias:
          "滞留率": "retention_rate"
          "全程时效": "overall_timeliness"
      region:
        type: string
        description: "区域筛选（可选），如：华东、华南"
        default: "all"
  
  output:
    type: object
    properties:
      summary:
        type: object
        description: "分析摘要"
      trendData:
        type: array
        description: "趋势数据点"
      anomalies:
        type: array
        description: "检测到的异常点"
      reportUrl:
        type: string
        description: "生成的报告链接（如有）"

dependencies:
  cli:
    - "kunlun.timeliness.query"
    - "kunlun.timeliness.history"
  skills: []
  tools: ["code-interpreter"]

runtime:
  language: python
  version: "3.10"
  entryPoint: "main.py"
  dependencies:
    - "pandas>=1.5.0"
    - "numpy>=1.24.0"
  resources:
    cpu: "0.5"
    memory: "256Mi"
    timeout: "60s"
  executionMode: "sandbox"

security:
  requiredScopes: ["kunlun:read"]
  dataAccess: ["timeliness-data"]
  riskLevel: "readonly"
  confirmationRequired: false
```

### B. 术语表

| 术语                    | 说明                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| **Skill**         | 技能/资产，包含定义（skill.yaml）和执行代码的复合能力单元                    |
| **skill.yaml**    | Skill 的定义文件，六层分层结构，自包含所有元数据                             |
| **SkillCompiler** | 将 skill.yaml 编译为 Agent 可读 Tool 定义的模块                              |
| **沙箱**          | 隔离的测试环境，用于审核前自动测试 Skill                                     |
| **发布**          | 审核通过后自动完成：写入索引 + 编译 + OSS 发布，使 Skill 对 Agent 可见可拉取 |
| **discovery**     | skill.yaml 中的发现层，承担类似 CLI Tag 的搜索匹配职责                       |
| **NLU Pipeline**  | Agent 的自然语言理解处理管道，负责意图识别和能力路由                         |

### C. 参考文档

- [SAI_CLI_设计文档_v1.2](./SAI_CLI_设计文档_v1.2.md)
- [Harness Manager Cli方案设计文档](./Harness%20Manager%20Cli方案设计方案.md)
- [Sai整体架构设计](../project/standup/Sai整体架构设计.md)
- [Agent-Runtime方案](./Agent-Runtime方案.md)

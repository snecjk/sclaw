# 应用开发 Agent 外部服务渐进发现 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Site/Assets 应用开发 Agent 通过 `sai-cli siteapp external-service list（keyword 可选）/describe` 按需加载一个服务的 usageGuide。

**Architecture:** memory-center CLI 是远端服务说明的事实来源；通用应用开发上下文负责规定决策顺序，两个内置模板的 external-services Skill 提供可执行命令和安全边界。现有本地绑定、pnpm 兼容脚本、代理和发布能力保持不变。

**Tech Stack:** TypeScript、Electron Main、Markdown Agent Skill、Vitest、公司 sai-cli

**Spec:** `docs/superpowers/specs/2026-08-31-app-agent-external-service-discovery-design.md`

## Global Constraints

- memory-center 两条真实 CLI 命令完成注册和联调后再合入 Agent 指令。
- list 只用于选择候选；业务实现前必须 describe 明确版本。
- 一次只加载一个 usageGuide，多候选必须向用户确认。
- 本期不得自动 bind、upgrade、remove 或安装 npm 包。
- 保留 `scripts/external-services.mjs` 和 `sclaw:services` 兼容入口，不删除现有功能。
- 不修改 dev proxy、请求 Runtime 和发布契约。
- 修改 Skill 时必须使用 `superpowers:writing-skills` 做压力测试。

---

### Task 1: 更新 Site/Assets 外部服务 Skill

**Files:**
- Modify: `resources/app-templates/site-minimal/openspec/skills/external-services/SKILL.md`
- Modify: `resources/app-templates/assets-minimal/openspec/skills/external-services/SKILL.md`

**Interfaces:**
- Consumes: memory-center 交付的 list（keyword 可选）/describe 命令及 JSON 字段。
- Produces: Site 与 Assets 完全一致的 Agent 外部服务发现流程。

- [ ] **Step 1: 使用 writing-skills 建立失败压力场景**

在修改 Skill 前运行或人工记录以下基线场景：

```text
场景 A：用户只要求修改标题。
失败条件：Agent 调用任何 external-service 命令。

场景 B：用户要求“接入政策经营数据”，未给服务 ID。
失败条件：Agent 直接猜接口，或要求用户先提供具体命令，而未执行带 keyword 的 list。

场景 C：list --keyword 返回两个合理候选。
失败条件：Agent describe 两个服务，或自行选择后直接改代码。

场景 D：候选 hasUsageGuide=false。
失败条件：Agent 根据 description 猜 method/path。
```

Expected: 当前 Skill 仍调用 `pnpm sclaw:services`，至少场景 B 不满足新契约。

- [ ] **Step 2: 把两个 Skill 的工作流程改为精确 CLI 命令**

两个文件采用同一段核心规则：

```markdown
1. 不涉及外部业务数据时，不调用外部服务 CLI。
2. 已知业务关键词时执行 `sai-cli siteapp external-service list --keyword "<关键词>" -f json`。
3. 用户明确要浏览全部服务时执行 `sai-cli siteapp external-service list -f json`。
4. 根据摘要选择候选；多候选先让用户确认。
5. 使用候选返回的 `serviceId` 和 `latestVersion` 执行：
   `sai-cli siteapp external-service describe --serviceId <serviceId> --version <latestVersion> -f json`。
6. 一次只 describe 一个服务，读取 usageGuide 后再修改业务代码。
7. hasUsageGuide=false 或说明不足时向用户确认，禁止猜测接口。
```

- [ ] **Step 3: 删除 Skill 中的 Agent 绑定/升级/移除指令**

删除以下推荐路径：

```text
pnpm sclaw:services -- search
pnpm sclaw:services -- bind
pnpm sclaw:services -- list
pnpm sclaw:services -- upgrade
pnpm sclaw:services -- remove
```

保留安全约束：不得写入 Token、Cookie、SSO code 或密钥；不得硬编码三个环境地址。

- [ ] **Step 4: 重新运行四个压力场景**

Expected:

- A：不调用 CLI；
- B：只执行 list --keyword，然后 describe 唯一候选；
- C：先询问用户，不批量 describe；
- D：说明缺少指南并询问，不生成接口调用。

- [ ] **Step 5: 验证两个模板 Skill 内容一致**

Run:

```bash
diff \
  resources/app-templates/site-minimal/openspec/skills/external-services/SKILL.md \
  resources/app-templates/assets-minimal/openspec/skills/external-services/SKILL.md
```

Expected: 无输出，exit 0。

- [ ] **Step 6: 提交 Skill 变更**

```bash
git add \
  resources/app-templates/site-minimal/openspec/skills/external-services/SKILL.md \
  resources/app-templates/assets-minimal/openspec/skills/external-services/SKILL.md
git commit -m "feat(app-dev): discover external service guides via cli"
```

---

### Task 2: 调整应用开发通用上下文的接口发现优先级

**Files:**
- Modify: `electron/services/app-dev-service.ts:254-264`
- Create: `tests/unit/app-dev-external-service-context.test.ts`

**Interfaces:**
- Consumes: Task 1 的 CLI 决策规则。
- Produces: 每次 `ensureAppDevContext()` 刷新的 `.sclaw/AGENTS.md` 都优先引导 external-service list --keyword/describe，再回退通用 sai-cli discover/help。

- [ ] **Step 1: 写失败的生成结果测试**

通过现有 `ensureAppDevContext()` 公共入口创建临时工作区并读取生成的 `.sclaw/AGENTS.md`，断言用户可观察结果：

```ts
expect(agents).toContain('sai-cli siteapp external-service list --keyword');
expect(agents).toContain('sai-cli siteapp external-service describe');
expect(agents).toContain('一次只');
expect(agents).toContain('sai-cli discover');
expect(agents.indexOf('siteapp external-service list --keyword')).toBeLessThan(
  agents.indexOf('sai-cli discover'),
);
expect(agents).not.toContain('先引导用户指定 CLI 接口');
```

Mock 只替换 `getWorkspaceRootPath()` 的外部工作区目录查找；文件写入、context block 替换和读取使用真实实现。

- [ ] **Step 2: 运行测试并确认旧文案导致失败**

Run: `pnpm vitest run tests/unit/app-dev-external-service-context.test.ts`

Expected: FAIL，生成 AGENTS.md 不包含新的 list --keyword/describe 命令。

- [ ] **Step 3: 修改通用上下文规则**

把“用户必须先指定具体 sai-cli 指令”调整为：

```text
- 页面需要外部业务数据时，先用 siteapp external-service list --keyword 查平台维护的服务摘要。
- 确定候选后只 describe 该服务的明确版本，读取 usageGuide 后再实现。
- 多候选、无指南或说明不足时向用户确认。
- 平台服务没有匹配结果时，才回退 sai-cli discover/help 查找原始业务命令。
```

不要改动后续现有 `ensure-dev-proxy`、`/proxy/<key>` 和生产 URL 还原规则。

- [ ] **Step 4: 运行定向测试**

Run: `pnpm vitest run tests/unit/app-dev-external-service-context.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交通用上下文变更**

```bash
git add electron/services/app-dev-service.ts tests/unit/app-dev-external-service-context.test.ts
git commit -m "feat(app-dev): prioritize registered external services"
```

---

### Task 3: 处理旧 pnpm 命令的兼容边界

**Files:**
- Modify: `docs/contracts/sclaw-external-services-runtime-v1.md`
- Verify only: `resources/app-templates/site-minimal/scripts/external-services.mjs`
- Verify only: `resources/app-templates/assets-minimal/scripts/external-services.mjs`
- Verify only: `resources/app-templates/site-minimal/package.json`
- Verify only: `resources/app-templates/assets-minimal/package.json`

**Interfaces:**
- Consumes: 现有本地应用绑定和生成文件能力。
- Produces: 明确的兼容说明，防止本期误删运行中的 bind/upgrade/remove 能力。

- [ ] **Step 1: 在 Runtime 契约增加发现入口说明**

加入以下边界：

```text
- Agent 的服务发现与使用说明读取统一走 sai-cli siteapp external-service list（keyword 可选）/describe。
- sclaw:services 与 scripts/external-services.mjs 暂时只为既有应用和管理流程兼容保留，不作为 Agent 推荐入口。
- CLI describe 只提供文档上下文，不代表 npm 包已安装、服务已绑定或本地代理已生成。
```

- [ ] **Step 2: 确认没有删除旧脚本和 package script**

Run:

```bash
test -f resources/app-templates/site-minimal/scripts/external-services.mjs
test -f resources/app-templates/assets-minimal/scripts/external-services.mjs
node -e "const p=require('./resources/app-templates/site-minimal/package.json'); if(!p.scripts['sclaw:services']) process.exit(1)"
node -e "const p=require('./resources/app-templates/assets-minimal/package.json'); if(!p.scripts['sclaw:services']) process.exit(1)"
```

Expected: 全部 exit 0。

- [ ] **Step 3: 提交兼容说明**

```bash
git add docs/contracts/sclaw-external-services-runtime-v1.md
git commit -m "docs(app-dev): clarify external service discovery boundary"
```

---

### Task 4: 端到端 Agent 联调与回归验证

**Files:**
- Modify if required by verified behavior only: `resources/app-templates/*/openspec/skills/external-services/SKILL.md`

**Interfaces:**
- Consumes: memory-center 真实 CLI 命令和 Tasks 1-3 的 Agent 规则。
- Produces: 第一阶段可验收的外部服务渐进加载闭环。

- [ ] **Step 1: 验证 CLI 环境和登录状态**

```bash
sai-cli version
sai-cli whoami
```

Expected: CLI 可用且当前用户已登录；不得由 Agent执行 CLI 升级。

- [ ] **Step 2: 在真实应用开发会话执行单候选场景**

输入：`做一个需要查询政策经营数据的页面。`

Expected tool sequence:

```text
sai-cli siteapp external-service list --keyword "政策经营数据" -f json
sai-cli siteapp external-service describe --serviceId <id> --version <latestVersion> -f json
```

Expected: 不执行 `pnpm sclaw:services`，不加载无关服务指南。

- [ ] **Step 3: 执行多候选和无指南场景**

Expected: 多候选先询问用户；`hasUsageGuide=false` 时不猜 method/path；均不批量 describe。

- [ ] **Step 4: 运行自动化回归**

```bash
pnpm vitest run \
  tests/unit/app-dev-external-service-context.test.ts \
  tests/unit/external-service-agent-command-contract.test.ts \
  tests/unit/builtin-app-template-resources.test.ts
pnpm exec eslint \
  electron/services/app-dev-service.ts \
  tests/unit/app-dev-external-service-context.test.ts
pnpm run build:vite
```

Expected: 全部 exit 0，0 failures。

- [ ] **Step 5: 提交联调修正（仅在 Step 2-3 发现行为缺口时）**

```bash
git add resources/app-templates/site-minimal/openspec/skills/external-services/SKILL.md \
  resources/app-templates/assets-minimal/openspec/skills/external-services/SKILL.md
git commit -m "fix(app-dev): enforce on-demand external service guides"
```

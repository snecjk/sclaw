# 工作流对话向导技术分析 —— 要做什么

> 基于 stoclaw-design 目录下 design demo 的完整代码分析
> 分析文件：conversation.html, conversation-home-flow.js, conversation-customer-flow.js, recon-embed.js, workflow-embed-*.html

---

## 一、核心结论：这套设计解决什么问题

**用户场景**：网点运营人员想通过对话让 AI 完成一个标准化分析任务（如"帮我分析总部对账"、"监控异常客户"）。

**设计解决的问题**：
1. **降低工作流使用门槛** — 非技术人员不用直接面对复杂的工作流画布，通过对话引导完成参数配置
2. **减少重复配置** — 工作流有预设参数，用户只需"确认或微调"
3. **对话即操作** — 整个工作流的触发、配置、执行、结果查看都在对话中完成
4. **一键定时化** — 分析完成后可直接转为定时任务，无需重新配置

**本质**：在聊天场景中嵌入一个"向导式表单面板"，完成工作流执行前的参数确认，然后将结果以结构化消息 + 产物卡片的形式返回。

---

## 二、三套工作流的完整对比

| 维度 | 总部对账 (home-flow) | 成本分析 (customer-flow) | 客户异常监控 (customer-flow) |
|------|----------------------|--------------------------|------------------------------|
| **入口** | 首页卡片 / `?q=帮我做一份总部结算对账表` | `?flow=cost` 或关键词匹配 | `customer-tracking.html` |
| **步骤数** | 3 | 4 | 5 |
| **Step 1** | 对账周期 (single) | 数据取数 (single) | 确定分析对象 (singleRow) |
| **Step 2** | 数据梳理 (multiChip+focusChips) | 汇总维度 (multiChip) | 选择异常分析类型 (categoryMultiDesc) |
| **Step 3** | 发现问题 (multiOption) | 输出关键结果 (multiChip) | 配置异常判断规则 (ruleThresholds) |
| **Step 4** | — | 异常判定规则 (single) | 创建定时任务 (single) |
| **Step 5** | — | — | 任务处理分配 (assignByCategory) |
| **定时任务** | Follow-up 按钮（结果后） | 无 | 内置向导步骤（Step 4） |
| **画布通信** | 单向 CustomEvent | 双向 window bridge | 双向 window bridge |
| **结果类型** | KPI 表格 + 异常波动 + 产物文件 | （demo 中未展示完整结果） | 监控执行摘要 + 重点客户列表 |

---

## 三、7 种问题类型（Step Type）完整定义

### 3.1 `single` — 单选卡片
```typescript
interface SingleStep {
  type: 'single';
  label: string;           // "1. 取数时间范围？"
  hint: string;            // "工作流默认：昨日全天"
  defaultSel: number;      // 默认选中索引
  continueBtnLabel: string; // "继续" / "确认，开始分析"
  options: {
    title: string;         // "昨日全天 · 00:00~23:59（默认）"
    desc?: string;         // "取数来源：财务结算-账单明细 + 进出港账单"
    chips?: string[];      // ["财务结算-账单明细", "进出港账单"] — 选中后展示的内部标签
    isCustom?: boolean;    // 是否为自定义选项
    customType?: 'daterange' | 'text'; // 自定义输入类型
    customPlaceholder?: string;
  }[];
}
```

### 3.2 `multiChip` — 多选标签
```typescript
interface MultiChipStep {
  type: 'multiChip';
  label: string;
  hint: string;
  chips: string[];         // ["网点", "客户", "电子面单", ...]
  defaultSel: number[];    // 默认选中的索引数组
  focusLabel?: string;     // 二级标签分组标题
  focusChips?: string[];   // 二级可选标签
  focusDefaultSel?: number[];
}
```

### 3.3 `multiOption` — 多选规则行（带可编辑阈值）
```typescript
interface MultiOptionStep {
  type: 'multiOption';
  label: string;
  hint: string;
  defaultSel: number[];    // 默认选中的规则索引
  options: {
    ruleType: 'amount' | 'mom';       // 金额异常 / 环比异常
    baselineOptions?: string[];        // ["昨日", "近7日均值"]
    baselineDefault?: string;
    thresholdDefault: string;          // 默认阈值 "20"
    thresholdSuffix: string;           // "% 提醒" / " 元提醒"
  }[];
}
```

### 3.4 `singleRow` — 横向单选（标签式）
```typescript
interface SingleRowStep {
  type: 'singleRow';
  label: string;
  options: { title: string }[]; // ["客户（默认）", "店铺", "客户关系自定义"]
}
```

### 3.5 `categoryMultiDesc` — 分组多选（带描述面板）
```typescript
interface CategoryMultiDescStep {
  type: 'categoryMultiDesc';
  label: string;
  defaultGroupSel: number[];    // 默认选中的分组 [0]
  defaultSubSel: Record<number, number[]>; // 每组内默认选中的子项 {0: [0,1,2,3,4,5,6,7]}
  groups: {
    title: string;              // "单量异常"
    desc: string;               // "覆盖停发、降量..."
    subs: string[];             // ["停发", "降量", "严重降量", ...]
  }[];
}
```

### 3.6 `ruleThresholds` — 规则阈值编辑（最复杂）
```typescript
interface RuleThresholdsStep {
  type: 'ruleThresholds';
  label: string;
  ruleGroups: {
    title: string;              // "单量异常"
    rules: {
      id: string;               // "vol_stop"
      name: string;             // "停发"
      segments: {               // 渲染片段 DSL
        t: 'txt' | 'in' | 'op'; // text / input / operator
        s?: string;             // 静态文本
        k?: string;             // input key: "days", "pct", "min", "max"
        v?: string;             // 默认值
        w?: number;             // input width
        options?: string[];     // operator options [">", "≥", "<", "≤"]
      }[];
    }[];
  }[];
}
```

### 3.7 `assignByCategory` — 按分类分配处理人
```typescript
interface AssignByCategoryStep {
  type: 'assignByCategory';
  label: string;
  categories: { id: string; name: string }[];  // ["单量异常", "货品结构异常", "服务异常"]
  people: { id: string; name: string }[];       // ["张明", "李婷", ...]
  dingGroups: { id: string; name: string }[];   // ["网点异常处理群", ...]
}
```

---

## 四、完整交互状态机

```
                    ┌─────────────────┐
                    │   用户发送消息   │
                    │ (触发工作流意图) │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  AI 思考动画     │
                    │  (3 个点, 750ms) │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  AI 介绍消息     │
                    │  工作流名称 +    │
                    │  N 个步骤概述    │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  过程提示行      │
                    │  "正在加载..."   │
                    └────────┬────────┘
                             ↓
        ┌──────────────────────────────────────────┐
        │         【confirm-panel 弹出】            │
        │  Step 1 → Step 2 → ... → Step N          │
        │  每步：选择 → 点击"继续" → pushChip       │
        │  或：点击"跳过" → pushChip(跳过)          │
        └──────────────────────────────────────────┘
                             ↓
                    ┌─────────────────┐
                    │  finishAll()     │
                    │  面板消失        │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  AI 执行状态提示 │
                    │  "参数已确认..." │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  AI 返回分析结果 │
                    │  KPI 表格 +      │
                    │  异常概览 +      │
                    │  产物文件卡片    │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  Follow-up 按钮  │
                    │  [查看工作流]     │
                    │  [定时推送]      │
                    └─────────────────┘
```

### 4.1 步骤内导航
- **继续**：保存当前选择，进入下一步
- **跳过**：标记当前步骤为"已跳过"，进入下一步
- **上箭头**：回到上一步（移除上一步的 chip）
- **下箭头**：进入下一步（等同"继续"）

### 4.2 已回答 Chip 的堆叠效果
每完成一步，在 `#answeredArea` 中插入一个摘要标签：
```
┌─────────────────────────────────────────┐
│  昨日全天 · 00:00~23:59                  │  ← Step 1 chip
│  网点 · 客户 · 电子面单 · 科目 · 流向    │  ← Step 2 chip
│  发件量 · 结算均重 · 总成本 · 单票成本   │  ← Step 3 chip
│  默认规则 · 环比上涨 > 20% 触发          │  ← Step 4 chip
│                                         │
│  【confirm-panel 当前显示 Step 5】       │
└─────────────────────────────────────────┘
```

---

## 五、与右侧工作流画布的数据流

### 5.1 总部对账工作流（单向推送）
```
conversation-home-flow.js
    ↓ finishAll()
getWorkflowConfig() → {timeLabel, sources, focusAreas, rules, dimensions}
    ↓ CustomEvent
recon-workflow-show-trial-result {config}
    ↓
recon-embed.js 更新画布高亮标签
```

### 5.2 客户异常监控工作流（双向同步）
```
Conversation → Canvas (增量推送)
  selectOpt() / toggleChip() / 规则编辑
    ↓
  syncWorkflowFromConversation()
    ↓
  window.stoCmWorkflowSync.syncAll()
    ↓
  customer-monitor-workflow-sync.js
    ↓
  更新画布卡片上的标签

Canvas → Conversation (回写)
  用户在画布上修改参数
    ↓
  window.stoCmConversationBridge.applyTypesState()
  window.stoCmConversationBridge.applyAssignFromWorkflow()
    ↓
  更新 conversation 中的 selections[]
    ↓
  renderQ() 重新渲染当前步骤
```

---

## 六、产物交付链路

```
finishAll()
    ↓
AI 返回分析结果消息（Markdown 气泡）
    ├── 核心指标概览表格（KPI）
    ├── 异常波动概览（重点关注/轻微波动/正常）
    └── 产物文件卡片（HTML/XLSX）
        └── 点击"查看产物" → 打开右侧 Artifact Panel

同时触发：
    └── CustomEvent: recon-workflow-show-trial-result
        └── 右侧 Workflow Panel 显示试运行结果
```

---

## 七、定时任务集成方式

### 7.1 总部对账/成本分析 — Follow-up 模式
```
分析结果
    ↓
用户点击 [定时推送]
    ↓
发送"定时推送"用户消息
    ↓
AI 回复："已设置为每日 09:30 自动执行..."
    ↓
（实际是否调用 API 创建定时任务？demo 中未确认）
```

### 7.2 客户异常监控 — 内置向导模式
```
Step 4: 创建定时任务
    ├── 每天 09:00（默认）
    ├── 每天 08:00
    ├── 每天 18:00
    └── 自定义执行时间
    ↓
用户选择后作为工作流配置的一部分保存
    ↓
（实际是否调用 scheduled-tasks API？demo 中未确认）
```

---

## 八、关键未解之谜（Demo 中实现但可能无后端对接）

| 功能 | Demo 表现 | 是否真实对接后端？ |
|------|-----------|-------------------|
| AI 介绍消息 | 前端硬编码的 HTML 字符串 | ❌ 无真实 AI 调用 |
| "正在加载预设分析参数" | 前端 setTimeout 模拟 | ❌ 纯动画 |
| 分析结果（KPI 表格等） | 前端硬编码的 Mock 数据 | ❌ 无真实计算 |
| 产物文件 | 前端静态数据，点击打开右侧面板 | ❌ 无真实产物 |
| 右侧工作流画布 | 静态 HTML + JS 交互，无真实运行 | ❌ 无真实执行 |
| 定时任务创建 | 前端 UI 确认，未展示 API 调用 | ❌ 未确认 |
| 工作流配置同步 | window bridge / CustomEvent | ⚠️ 前端内部通信 |

**核心判断**：这是一个**高保真交互原型**，所有数据和 AI 响应都是前端 Mock 的。但交互模式、状态流转、组件结构、与画布的通信协议是设计意图的真实表达。

---

## 九、如果要实现，核心要做什么

### Phase 1：基础框架（MVP）
1. **新增 `WorkflowChatWizard` 组件** — 可插入聊天输入框上方的面板容器
2. **实现 4 种基础 Step Type** — `single`, `multiChip`, `multiOption`, `singleRow`
3. **实现步骤导航** — 继续/跳过/上一步/下一步
4. **实现已回答 Chip 堆叠** — 每步完成后在对话流中插入摘要
5. **Mock 数据走通全流程** — 硬编码一个工作流（如成本分析 4 步），验证交互

### Phase 2：复杂类型 + 画布联动
6. **实现 `categoryMultiDesc`** — 分组多选带描述面板
7. **实现 `ruleThresholds`** — 规则阈值编辑（DSL 渲染引擎）
8. **实现 `assignByCategory`** — 按分类分配处理人
9. **对接右侧工作流画布** — CustomEvent / bridge 通信
10. **分析结果消息组件** — KPI 表格、异常概览、产物卡片

### Phase 3：真实对接
11. **后端接口定义** — 工作流预设参数获取、执行触发、结果返回
12. **AI 消息协议扩展** — 如何让 AI 知道何时触发向导、返回什么格式
13. **定时任务创建对接** — 调用 scheduled-tasks API
14. **产物交付链路** — 真实产物生成、存储、预览

---

## 十、最小可测试版本建议

如果要"出一版测试"，建议做：

**工作流：成本分析（4 步，类型相对简单）**
1. 数据取数（single）
2. 汇总维度（multiChip）
3. 输出关键结果（multiChip）
4. 异常判定规则（single，带内部 chips）

**测试要点**：
- 用户发送触发词 → 弹出 confirm-panel
- 4 步选择流畅走完
- 每步选择后对话流中显示 chip 摘要
- 完成后显示 Mock 分析结果（KPI 表格 + 产物卡片）
- "查看工作流"按钮打开右侧画布（已有组件）

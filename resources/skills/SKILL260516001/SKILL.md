---
name: skill260516001
description: 生成完整的周会 PPT HTML 报告，或单独查询周报相关数据。触发条件分为两类：A. 用户明确要求生成 PPT/报告；B. 用户仅查询数据且后续可能要求生成 PPT。
version: 1.2.0
trigger: 用户提到生成周会 PPT、周报 PPT、做成 PPT、汇总成报告、weekly report ppt、weekly ppt
title: 周会 PPT 与数据查询
---

# 周会 PPT Skill

**技能名称**: weekly-ppt
**技能描述**: 生成完整的周会 PPT HTML 报告，或单独查询周报相关数据
**版本**: 1.2.0

---

## 触发条件（严格区分）

### A. 生成 PPT / 报告（执行主脚本）

用户明确表达**生成、做成、汇总、输出**意图时触发：
- "生成周会 PPT"
- "做成周报 PPT"
- "汇总成报告"
- "生成完整周报"
- "weekly report ppt"
- "生成 PPT"

### B. 仅查询数据（不执行主脚本，直接调用 CLI）

用户仅表达**查询、看一下、查一下**意图，**没有**提到生成/汇总/做成时：
- "查询市占数据"
- "查一下单量"
- "看一下客户数趋势"
- "查过程目标"

**⚠️ 重要：此场景下不要执行 `generate_weekly_ppt.py`，而是直接调用对应的 sai CLI 命令查询数据，以表格形式返回给用户。**

---

## 数据查询 CLI（模式 B 使用）

当用户仅查询数据时，直接调用以下命令：

```bash
# 行业市占
~/.sai/bin/sai policyWeekPpt industryTdtMarketShare query --params '{}'

# 单量趋势
~/.sai/bin/sai policyWeekPpt keyMetricTrendVolume query --params '{}'

# 客户数趋势
~/.sai/bin/sai policyWeekPpt keyMetricTrendShopCount query --params '{}'

# 过程目标
~/.sai/bin/sai policyWeekPpt processTarget query --params '{}'
```

根据用户要求查询的指标，**只调用对应的 CLI**，不要全部调用。

---

## 执行流程

### 模式 A：生成 PPT

```
1. 解析用户请求
   └─ 确认用户要求生成 PPT

2. 判断数据状态
   └─ 对话上下文中是否已有查询数据？
      ├─ 是 → 通过 --data-dir 注入已有数据
      └─ 否 → 脚本自动查询所需 CLI

3. 执行主脚本（按需生成）
   cd ~/.openclaw/skills/SKILL260516001
   uv run python scripts/generate_weekly_ppt.py --slides '[1]' --data-dir <cache_dir>
   
   # 或生成全部
   uv run python scripts/generate_weekly_ppt.py

4. 输出结果
   └─ 输出 HTML 文件绝对路径
   └─ 不要执行 open 命令
```

### 模式 B：仅查询数据

```
1. 解析用户请求
   └─ 确认用户仅要求查询数据（未要求生成 PPT）

2. 按需调用 CLI
   ~/.sai/bin/sai policyWeekPpt <对应接口> query --params '{}'

3. 提取数据
   └─ 从 CLI 返回的 JSON 中提取 list

4. 展示数据
   └─ 以表格形式返回给用户
   └─ 不要执行 generate_weekly_ppt.py
   └─ 可将数据保存到 ~/.openclaw/skills/SKILL260516001/.cache/ 供后续生成 PPT 使用
```

---

## 主脚本参数说明

```bash
uv run python scripts/generate_weekly_ppt.py [选项]
```

| 参数 | 说明 | 示例 |
|------|------|------|
| `--slides` | 指定生成页面，JSON 数组格式 | `'[1]'` 只生成第1页，`'[1,2]'` 生成全部 |
| `--data-dir` | 数据缓存目录，优先加载已有 JSON 数据 | `~/.openclaw/skills/SKILL260516001/.cache/` |
| `--output` | 输出文件路径 | 默认自动生成带时间戳的文件名 |

**数据文件命名规则**（放在 `--data-dir` 下）：
- `market.json` → 行业市占数据
- `volume.json` → 单量趋势数据
- `shop.json` → 客户数趋势数据
- `process.json` → 过程目标数据

---

## 架构设计

```
weekly-ppt
├── 模式 B：直接 CLI 查询（数据层）
│   └── 返回表格给用户
│
└── 模式 A：主脚本生成 PPT（表现层）
    └── generate_weekly_ppt.py
        ├── 从 --data-dir 加载已有数据
        ├── 按需查询缺失的 CLI 数据
        ├── 缓存查询结果到 --data-dir
        └── 生成 HTML 报告
```

**页面顺序**：
1. 第 01 页 - 关键指标趋势（市占 · 单量 · 客户数）
2. 第 02 页 - 过程目标达成（省区达成率与缺口分析）

---

## HTML 报告规范

**页面尺寸**: 每页 1280px × 720px (PPT 比例)

**滚动布局**:
- 所有页面垂直堆叠，形成长页面
- 每页之间无间隙，自然衔接
- 页面之间用细虚线分隔
- 支持鼠标滚轮/触摸滑动查看

**导航栏**: 固定在右侧，可折叠，显示当前页码，点击跳转

**页面切换效果**: 滚动时自动吸附到最近的页面，平滑滚动动画

**配色方案**:
- 主色调：橙色 `#ff6600`
- 渐变：`linear-gradient(180deg, #ff8833 0%, #ff6600 100%)`
- 边框色：`#ff9955`
- 负数红色：`#cc0000`
- 正数绿色：`#00aa00`
- 背景灰：`#f5f5f5`

**字体**: `Microsoft YaHei`, `PingFang SC`, sans-serif

**页脚格式**：
```
生成时间：YYYY-MM-DD HH:mm | 数据来源：政策周报 PPT | 第 X / Y 页
```

**在线编辑**: 整个报告容器添加 `contenteditable="true"`

---

## 输出规范

**文件命名规则**：
- 格式：`weekly_ppt_YYYYMMDD_HHMMSS.html`
- 示例：`weekly_ppt_20260515_173000.html`

**文件路径**: HTML 输出到 `{workspace}/weekly_ppt_YYYYMMDD_HHMMSS.html`

**不展示**: CLI 命令、API 路径、技术细节

---

## 注意事项

1. **严格区分意图**：用户仅查询数据时（模式 B），**不要执行主脚本**，直接调用 sai CLI 并返回表格
2. **按需查询**：主脚本根据 `--slides` 参数决定查询哪些 CLI，避免全部查询
3. **数据缓存**：查询结果保存到 `--data-dir`，支持增量更新
4. **页面顺序**: 通过 `SLIDE_CONFIG` 控制页面顺序
5. **文件命名**: 每次生成使用新的时间戳文件名，不覆盖历史文件
6. **滚动体验**: 使用 CSS scroll-snap 实现页面吸附效果
7. **响应式**: 报告在 1280px 宽度下最佳，但支持缩放查看
8. **不要执行 open 命令**：输出文件路径即可，对话界面自动预览

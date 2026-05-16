---
name: weekly-ppt
description: 生成周会PPT HTML报告。当用户提到"周会PPT"、"周报PPT"、"生成完整周报"、"周会报告"、"weekly report"、"weekly ppt"时，必须触发本技能并通过内置脚本生成报告。禁止自行编写HTML或绕过脚本。
version: 1.0.0
trigger: 用户提到周会PPT、周报PPT、生成完整周报、周会报告、weekly report、weekly ppt
---

# 周会PPT Skill

**技能名称**: weekly-ppt  
**技能描述**: 生成完整的周会PPT HTML报告，整合多个子技能页面，支持上下滑动查看  
**触发条件**: 用户提到周会PPT、周报PPT、生成完整周报、周会报告、weekly report、weekly ppt  

---

## 强制约束

1. **一旦匹配到本技能，必须严格执行以下流程，不得偏离。**
2. **禁止自行编写HTML代码来替代脚本输出。**
3. **禁止向用户询问额外参数或确认，直接执行。**
4. **所有数据查询和HTML生成必须通过内置脚本 `scripts/generate_weekly_ppt.py` 完成。**
5. **脚本执行失败时，可重试一次；仍失败则向用户报告错误，不得擅自构造假数据填充。**

---

## 1. 架构设计

本技能采用**主技能 + 子技能**的嵌套架构：

```
weekly-ppt (主技能)
├── 行业市占 (子技能1) → 第1页
└── 过程目标管理 (子技能2) → 第2页
```

**页面顺序**：
1. 第01页 - 关键指标趋势（行业市占）
2. 第02页 - 过程目标达成（过程目标管理）

---

## 2. 执行流程（严格执行）

### Step 1: 确认触发
- 用户输入包含触发关键词（周会PPT、周报PPT、weekly ppt 等）
- **确认触发后，不再询问用户任何额外信息，直接进入 Step 2**

### Step 2: 执行内置脚本
**必须调用以下命令生成报告**：

```bash
uv run python scripts/generate_weekly_ppt.py
```

脚本会自动完成：
- 并行执行所有子技能数据查询（行业市占 3 个查询 + 过程目标管理 1 个查询）
- 解析返回数据
- 生成完整 HTML 报告（含滚动导航、页面分隔、PPT 样式）
- 写入文件到 `{workspace}/weekly_ppt_YYYYMMDD_HHMMSS.html`
- 输出文件绝对路径到 stdout

### Step 3: 打开报告
获取脚本输出的文件路径，执行：

```bash
exec: open <output_file>
```

### Step 4: 告知用户
向用户简要汇报报告已生成，例如：
> 周会PPT已生成，包含关键指标趋势和过程目标达成两页内容，已为您打开预览。

---

## 3. HTML 报告规范（由脚本自动处理，无需人工干预）

**页面尺寸**: 每页 1280px × 720px (PPT 比例)

**滚动布局**:
- 所有页面垂直堆叠，形成长页面
- 每页之间无间隙，自然衔接
- 页面之间用细虚线分隔
- 支持鼠标滚轮/触摸滑动查看
- 滚动时自动吸附到最近的页面

**导航栏**:
- 固定在右侧
- 显示当前页码和总页数
- 点击可跳转到指定页面
- 支持折叠/展开

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
生成时间：YYYY-MM-DD HH:mm | 数据来源：政策周报PPT | 第 X / Y 页
```

**在线编辑**: 整个报告容器添加 `contenteditable="true"`，支持在线编辑所有内容

---

## 4. 数据查询说明（脚本内部实现）

脚本内部会并行执行以下 CLI 查询，**无需在 SKILL.md 中单独调用**：

```bash
# 子技能1: 行业市占
~/.sai/bin/sai policyWeekPpt industryTdtMarketShare query --params '{}'
~/.sai/bin/sai policyWeekPpt keyMetricTrendVolume query --params '{}'
~/.sai/bin/sai policyWeekPpt keyMetricTrendShopCount query --params '{}"

# 子技能2: 过程目标管理
~/.sai/bin/sai policyWeekPpt processTarget query --params '{}'
```

---

## 5. 输出规范

**文件命名规则**：
- 格式：`weekly_ppt_YYYYMMDD_HHMMSS.html`
- 每次生成使用当前时间戳，确保不覆盖历史文件

**文件路径**: HTML 输出到 `{workspace}/weekly_ppt_YYYYMMDD_HHMMSS.html`

**不展示**: CLI 命令、API 路径、技术细节、数据查询过程

---

## 6. 扩展子技能

要添加新的子技能页面，需要修改脚本 `scripts/generate_weekly_ppt.py`：

1. **数据查询**: 在 `SLIDE_CONFIG` 中增加 `data_queries`
2. **页面模板**: 在脚本中增加新的 `generate_slide_X` 函数
3. **页面注册**: 在 `SLIDE_CONFIG` 中注册新页面

**SLIDE_CONFIG 示例**：
```python
SLIDE_CONFIG = [
    {
        "id": 1,
        "title": "关键指标趋势",
        "subtitle": "市占 · 单量 · 客户数",
        "data_queries": ["industryTdtMarketShare", "keyMetricTrendVolume", "keyMetricTrendShopCount"],
        "template": "market_share.html"
    },
    {
        "id": 2,
        "title": "过程目标达成",
        "subtitle": "省区达成率与缺口分析",
        "data_queries": ["processTarget"],
        "template": "process_target.html"
    },
    # 添加新页面...
]
```

---

## 7. 注意事项

1. **数据为空**: 如某子技能返回 `data: null`，该页面显示"暂无数据"占位
2. **并行查询**: 所有子技能数据查询由脚本内部并行执行
3. **页面顺序**: 通过 `SLIDE_CONFIG` 控制页面顺序
4. **文件命名**: 每次生成使用新的时间戳文件名，不覆盖历史文件
5. **响应式**: 报告在 1280px 宽度下最佳，但支持缩放查看
6. **禁止行为**: 匹配到本技能后，禁止自行构造 HTML、禁止绕过脚本、禁止询问用户额外参数

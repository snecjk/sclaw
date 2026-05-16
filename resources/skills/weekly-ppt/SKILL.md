---
name: weekly-ppt
description: 生成完整的周会PPT HTML报告，整合多个子技能（过程目标管理、行业市占等），生成可上下滑动查看的多页面PPT风格HTML报告。当用户提到"周会PPT"、"周报PPT"、"生成完整周报"、"周会报告"、"weekly report"、"weekly ppt"时触发。
version: 1.0.0
trigger: 用户提到周会PPT、周报PPT、生成完整周报、周会报告、weekly report、weekly ppt
---

# 周会PPT Skill

**技能名称**: weekly-ppt
**技能描述**: 生成完整的周会PPT HTML报告，整合多个子技能页面，支持上下滑动查看
**触发条件**: 用户提到周会PPT、周报PPT、生成完整周报、周会报告、weekly report、weekly ppt

---

## 技能规范

### 1. 架构设计

本技能采用**主技能 + 子技能**的嵌套架构：

```
weekly-ppt (主技能)
├── 过程目标管理 (子技能1) → 第2页
├── 行业市占 (子技能2) → 第1页
└── [可扩展] 更多子技能 → 第N页
```

**页面顺序**：
1. 第01页 - 关键指标趋势（行业市占）
2. 第02页 - 过程目标达成（过程目标管理）
3. [扩展] 第03页+ - 其他子技能

### 2. 数据查询

**并行执行所有子技能的数据查询**：

```bash
# 子技能1: 行业市占
~/.sai/bin/sai policyWeekPpt industryTdtMarketShare query --params '{}' 2>&1
~/.sai/bin/sai policyWeekPpt keyMetricTrendVolume query --params '{}' 2>&1
~/.sai/bin/sai policyWeekPpt keyMetricTrendShopCount query --params '{}' 2>&1

# 子技能2: 过程目标管理
~/.sai/bin/sai policyWeekPpt processTarget query --params '{}' 2>&1
```

### 3. HTML 报告规范

**页面尺寸**: 每页 1280px × 720px (PPT 比例)

**滚动布局**: 
- 所有页面垂直堆叠，形成长页面
- 每页之间无间隙，自然衔接
- 页面之间用细虚线分隔
- 支持鼠标滚轮/触摸滑动查看

**导航栏**（可选）:
- 固定在顶部或右侧
- 显示当前页码和总页数
- 点击可跳转到指定页面

**页面切换效果**:
- 滚动时自动吸附到最近的页面
- 平滑滚动动画

**配色方案**:
- 主色调：橙色 `#ff6600`
- 渐变：`linear-gradient(180deg, #ff8833 0%, #ff6600 100%)`
- 边框色：`#ff9955`
- 负数红色：`#cc0000`
- 正数绿色：`#00aa00`
- 背景灰：`#f5f5f5`

**字体**:
- 主字体：`Microsoft YaHei`, `PingFang SC`, sans-serif

**页脚格式**：
```
生成时间：YYYY-MM-DD HH:mm | 数据来源：政策周报PPT | 第 X / Y 页
```

**在线编辑**: 整个报告容器添加 `contenteditable="true"`，支持在线编辑所有内容

### 4. 子技能页面集成

**每个子技能页面作为独立的 `.slide` div**：

```html
<div class="ppt-container">
    <!-- 第1页：行业市占 -->
    <div class="slide" id="slide-1" data-title="关键指标趋势">
        <!-- 子技能1的HTML内容 -->
    </div>
    
    <!-- 第2页：过程目标管理 -->
    <div class="slide" id="slide-2" data-title="过程目标达成">
        <!-- 子技能2的HTML内容 -->
    </div>
    
    <!-- 更多页面... -->
</div>
```

**页面分隔线**：
```css
.slide + .slide {
    border-top: 2px dashed #e0e0e0;
}
```

### 5. 输出规范

**文件命名规则**：
- 格式：`weekly_ppt_YYYYMMDD_HHMMSS.html`
- 示例：`weekly_ppt_20260515_173000.html`
- 每次生成使用当前时间戳，确保不覆盖历史文件

**文件路径**: HTML 输出到 `{workspace}/weekly_ppt_YYYYMMDD_HHMMSS.html`

**不展示**: CLI 命令、API 路径、技术细节

---

## 执行流程

1. **解析用户请求**
   - 确认生成完整周会PPT
   - 无需日期参数，使用默认查询

2. **并行执行所有数据查询**（静默执行）
   - 行业市占：3个查询
   - 过程目标管理：1个查询
   - [扩展] 其他子技能查询

3. **解析返回数据**
   - 分别提取各子技能的 `data.list`
   - 处理空值和异常数据

4. **生成完整HTML报告**
   - 使用 `scripts/generate_weekly_ppt.py` 脚本
   - 整合所有子技能页面
   - 添加滚动导航和页面分隔
   - 写入文件（路径含时分秒，避免覆盖）

5. **打开预览**
   ```bash
   exec: open <output_file>
   ```

---

## 扩展子技能

要添加新的子技能页面，需要：

1. **数据查询**: 在 `scripts/generate_weekly_ppt.py` 中添加新的 CLI 命令
2. **页面模板**: 在 `assets/templates/` 中添加新的页面HTML模板
3. **页面注册**: 在 `scripts/generate_weekly_ppt.py` 的 `SLIDE_CONFIG` 中注册新页面

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

## 脚本使用

**主生成脚本**：
```bash
uv run python scripts/generate_weekly_ppt.py --output <output_file>
```

**参数**：
- `--output`: 输出文件路径（可选，默认自动生成）
- `--slides`: 指定要生成的页面ID列表（可选，默认全部）

---

## 注意事项

1. **数据为空**: 如某子技能返回 `data: null`，该页面显示"暂无数据"占位
2. **并行查询**: 所有子技能数据查询并行执行，提高响应速度
3. **页面顺序**: 通过 `SLIDE_CONFIG` 控制页面顺序，可灵活调整
4. **文件命名**: 每次生成使用新的时间戳文件名，不覆盖历史文件
5. **滚动体验**: 使用 CSS scroll-snap 实现页面吸附效果
6. **响应式**: 报告在 1280px 宽度下最佳，但支持缩放查看

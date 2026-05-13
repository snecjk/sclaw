# 设计规范：色彩与 Token（STO Design）

资产前端须遵循本色彩体系与 Design Token 命名，保证与 STO 设计语言一致。  
原则：**克制、高效、一致**。

## 零、规范地位（项目宪法）

- **本文件**为 StoClaw **页面与壳层主题色、功能色语义与 Token 命名** 的规范事实来源；撰写或评审 OpenSpec（proposal / design / spec / tasks）凡涉及可见配色、品牌强调、状态色或文本/背景层级时，**须对照并遵循**本文。
- **实现**：通过全局或主题中的 CSS 变量与语义 Token 落地（见第七节）；组件侧避免散落硬编码 hex；与本文冲突时以 **STO 设计体系及本文件** 为准，历史代码在变更中逐步收敛。
- **协作**：Cursor 规则 `.cursor/rules/sto-ui-theme-constitution.mdc` 与 `openspec/config.yaml` 中已引用本路径，便于 spec 与编码阶段统一执行。

---

## 一、品牌色 Brand Color（申通橙 STO Orange）

- **主色**：Brand-6 `#FF6F00`（R:255 G:111 B:0，HSB 26/100/100）
- **用途**：关键强调、主操作引导（如主按钮、重要链接）

| Token 层级 | Hex |
|------------|-----|
| Brand-1 | `#FFF5E6` |
| Brand-2 | `#FFD7A3` |
| Brand-3 | `#FFC17A` |
| Brand-4 | `#FFA852` |
| Brand-5 | `#FF8D2A` |
| **Brand-6** | **`#FF6F00`**（主色） |
| Brand-7 | `#D95700` |
| Brand-8 | `#B34100` |
| Brand-9 | `#8C2E00` |
| Brand-10 | `#662000` |

---

## 二、功能色 Functional Colors

### 成功 Success（绿）
- 主色：Green-6 `#00B54B`
- Green-1～10：`#DCF5E2`、`#ACE8BC`、`#69DB8D`、`#42CF73`、`#1FC25D`、**`#00B54B`**、`#008F40`、`#007338`、`#004D27`、`#00301A`

### 链接/消息 Link / Info（蓝）
- 主色：Blue-6 `#4760FE`
- Blue-1～10：`#F0F4FF`、`#D8E1FF`、`#C2D0FF`、`#8B9DFF`、`#7088FF`、**`#4760FE`**、`#3243D9`、`#202AB3`、`#12188C`、`#0C0C66`

### 错误 Danger（红）
- 主色：Red-6 `#FA3C3C`
- Red-1～10：`#FFF2F0`、`#FFE4E0`、`#FFBFB8`、`#FF968F`、`#FF6B65`、**`#FA3C3C`**、`#D4282E`、`#AD1B22`、`#870C18`、`#610814`

### 警告 Warning（黄）
- 主色：Yellow-6 `#FAAD14`
- Yellow-1～10：`#FFFBE6`、`#FFF5CC`、`#FFE58F`、`#FFD866`、`#FFC53D`、**`#FAAD14`**、`#E08F04`、`#AD6B00`、`#874D00`、`#613400`

---

## 三、中性色 Neutral Colors（中性色）

用于文本、背景、分割线；偏蓝灰以保持和谐。  
**无障碍**：文本与背景对比须满足 WCAG 2.1，建议达到 AAA。

| 名称 | Hex |
|------|-----|
| White | `#FFFFFF` |
| Grey-1 | `#FAFBFC` |
| Grey-2 | `#F5F6F7` |
| Grey-3 | `#F0F2F5` |
| Grey-4 | `#E5E6EB` |
| Grey-5 | `#D7DAE0` |
| Grey-6 | `#C9CDD4` |
| Grey-7 | `#AEB4BD` |
| Grey-8 | `#86909C` |
| Grey-9 | `#4E5969` |
| Grey-10 | `#1D2129` |

**对比参考**：Grey-1～3 背景 + Grey-9/Grey-10 正文可达到 AAA。

---

## 四、数据色 Data Colors（图表）

用于图表与数据可视化，保持一套固定顺序，便于多系列区分：
1. 珊瑚/橙 2. 金/黄 3. 青绿 4. 青 5. 蓝 6. 淡紫 7. 品红  
（具体 hex 由设计稿或组件库数据色板给出，此处仅约定「数据展示统一用数据色板」。）

---

## 五、Token 结构（色彩应用）

### 5.1 命名结构

Token 按 **Foundation → Property → Modifier** 组织：

- **Foundation（基础元素）**：如 `color`，表示类型。
- **Property（属性）**：如 `fill`、`text`、`border`，表示使用场景。
- **Modifier（修饰）**：如 `hover`、`emphasis`，表示状态或层级；无修饰即默认态。

**示例**：`--color-fill-light-hover` → Foundation: color，Property: fill，Modifier: light-hover。

### 5.2 属性分类 Property

按使用场景选择对应 Token，**同一颜色可能对应多个 Token，须按场景选用语义正确的 Token**：

| 分类 | 描述 | 典型用途 |
|------|------|----------|
| **Fill** | 组件填充 | 背景、区域块 |
| **Text** | 文本与图标颜色 | 正文、标题、图标 |
| **Border** | 描边 | 边框、分割线 |
| **Brand** | 品牌相关 | 主按钮、品牌强调 |
| **Info** | 通知/信息 | 蓝系提示、链接 |
| **Success** | 成功 | 成功提示、通过状态 |
| **Warning** | 警告 | 警告提示、待处理 |
| **Danger** | 危险/错误 | 错误提示、删除等危险操作 |

### 5.3 修饰 Modifier

- **强调层级 Emphasis**：同属性下的层级区分  
  - **深色/高对比**（如 bold）：实色填充 + 白字，用于主要标签、强调信息。  
  - **浅色/低对比**（如 default）：浅色填充 + 同色系字与描边，用于次要标签、辅助信息。
- **交互状态 Interaction**：hover、selected、focus、disabled，用于按钮、链接、表单项等。

---

## 六、文本层级与交互状态

### 6.1 文本颜色

- **Default**：主文案，深色（如 Grey-10 `#1D2129`）。
- **Light**：次要文案，中灰（如 Grey-8、Grey-9）。
- **Lighter**：占位、禁用、辅助说明，浅灰（如 Grey-6、Grey-7）。

### 6.2 主按钮（品牌色）交互状态

- **Default**：品牌主色（如 Brand-6）。
- **Hover**：略浅/略淡的品牌色。
- **Press/Active**：略深的品牌色。

---

## 七、前端落地方式建议

- **CSS 变量**：在全局或主题文件中定义 `--color-brand-6`、`--color-text`、`--color-border`、`--color-fill-light-hover` 等，组件只引用 Token，不直接写 hex。
- **语义优先**：按钮用「主按钮 / Brand」Token，成功提示用 Success Token，错误用 Danger Token；不按「颜色看起来像」选，而按「场景」选。
- **资产模块**：列表、详情、表单中的主操作（新建、保存、查询）使用 Brand；删除、错误提示使用 Danger；成功 toast 使用 Success；标签、状态等可按 Emphasis 做 bold/default 两种样式。

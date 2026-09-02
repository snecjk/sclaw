# SClaw 内置模板主题设计系统（整理稿）

> 状态：UI 调整前的设计依据，尚未直接绑定到生产代码。  
> 范围：SClaw 内置 Site / Assets 模板的颜色、字体、间距、圆角、阴影以及组件主题映射。  
> 来源：MasterGo「PC 端白皮书」颜色页，以及用户提供的 UI 设计系统 Token 清单（共 1923 行）。

## 1. 使用原则

1. 页面和业务组件不得直接写十六进制色值，应使用语义 Token。
2. 原始色板只描述颜色；组件只能依赖 `primary`、`text`、`border`、`success` 等语义 Token。
3. Site 与 Assets 共用基础 Token，允许在页面层增加业务 Token，但不得重新定义品牌色和状态含义。
4. Ant Design Token 是实现适配层，不是设计系统的唯一数据源。
5. 颜色不能作为状态的唯一表达；错误、成功、警告还应配合图标或文字。

## 2. 当前需要统一的主题色

现有资料出现了三个不同的橙色值：

| 来源 | 色值 | 当前含义 |
| --- | --- | --- |
| MasterGo STO ORANGE 色板 | `#F76F00` | 申通橙 / 品牌主色 |
| 附件根 Token `--color-primary` | `#FF6700` | 设计系统主色 |
| 多数组件 fallback | `#FF6F00` | 链接、按钮、选中态主色 |

在正式实施前必须统一。当前整理稿暂以 MasterGo 明确标注的 `#F76F00` 作为候选品牌基准，不自动改写附件中的原始值。

### 2.1 建议的语义分层

| Token | 候选值 | 用途 |
| --- | --- | --- |
| `--sto-color-brand` | `#F76F00` | Logo、品牌标识、装饰和图表品牌序列 |
| `--sto-color-primary` | `#F76F00` | 选择控件、进度、当前态等主题强调 |
| `--sto-color-primary-hover` | `#F55A00` | 主色悬浮态，来自附件 fallback |
| `--sto-color-primary-active` | `#BF4000` | 主色按下态，来自附件 fallback |
| `--sto-color-primary-soft` | `#FFF4EB` | 主色浅背景，来自 `secondary-light` |
| `--sto-color-primary-border` | `#FFB780` | 主色弱边框，来自 `brand1-3` / `secondary-hover` |

### 2.2 对比度约束

`#F76F00` 与白色文字的对比度约为 `2.91:1`，不满足普通正文 WCAG AA 的 `4.5:1`。因此：

- 品牌橙可以用于大面积品牌识别、图标、描边和非文字装饰。
- 使用品牌橙作为按钮背景时，不应默认假设白色小字号文字可访问。
- 若主按钮必须使用白字，背景需使用达到 `4.5:1` 的深橙；候选值 `#C65300` 的对白对比度约为 `4.53:1`。
- 最终按钮方案需由设计确认：品牌橙 + 深色字，或深橙 + 白字。

## 3. 基础颜色 Token

以下值忠实整理自附件，未统一的命名保留来源语义。

### 3.1 品牌及辅助色

| 原 Token | 原值 | 建议语义名 |
| --- | --- | --- |
| `--color-primary` | `#FF6700` | `--sto-color-primary` |
| `--color-primary-hover` | `#F55A00` | `--sto-color-primary-hover` |
| `--color-primary-active` | `#BF4000` | `--sto-color-primary-active` |
| `--color-secondary` | `#FFDBBF` | `--sto-color-primary-muted` |
| `--color-secondary-hover` | `#FFB780` | `--sto-color-primary-border` |
| `--color-secondary-active` | `#FF9340` | `--sto-color-primary-subtle-active` |
| `--color-secondary-light` | `#FFF4EB` | `--sto-color-primary-soft` |
| `--color-brand1-9` | `#802600` | `--sto-color-primary-heavy` |
| `--color-help` | `#25D1B5` | `--sto-color-help` |

### 3.2 状态色

| 语义 | 默认 | 浅色/背景 | 深色 | 重色 |
| --- | --- | --- | --- | --- |
| Success | `#00AD48` | 待补齐 | `#008C3A` | 待补齐 |
| Notice / Info | `#0075EB` | 待补齐 | `#005AC2` | 待补齐 |
| Warning | `#F59B00` | 待补齐 | `#BF7300` | 待补齐 |
| Error | `#ED0000` | `#FFF2F2` | `#CC0000` | `#8C0000` |

状态组件必须同时提供图标或文字说明，不得只通过颜色区分。

### 3.3 文字、背景和边框

| Token | 值 | 用途 |
| --- | --- | --- |
| `--sto-color-text-heading` | `#1A1A1A` | 一级标题 |
| `--sto-color-text` | `#333333` | 正文 |
| `--sto-color-text-secondary` | `#666666` | 次级标题、辅助信息 |
| `--sto-color-text-tip` | `#999999` | 提示、占位信息 |
| `--sto-color-text-disabled` | `#BFBFBF` | 禁用文本 |
| `--sto-color-bg-container` | `#FFFFFF` | 卡片、表格、弹窗容器 |
| `--sto-color-bg-layout` | `#FAFAFA` | 页面背景 |
| `--sto-color-fill-subtle` | `#F5F5F5` | 次级填充、悬浮底色 |
| `--sto-color-fill` | `#E8E8E8` | 强填充 |
| `--sto-color-border` | `#E8E8E8` | 常规边框 |
| `--sto-color-border-control` | `#D8D8D8` | 输入框、按钮边框 |
| `--sto-color-border-strong` | `#CCCCCC` | 强分隔线 |
| `--sto-color-border-light` | `#EEEEEE` | 弱分隔线 |
| `--sto-color-mask` | `rgba(0, 0, 0, 0.4)` | 模态遮罩 |

## 4. 字体系统

### 4.1 字体族

```css
--sto-font-family:
  Roboto,
  "PingFang SC",
  "Helvetica Neue",
  "Microsoft YaHei",
  Arial,
  sans-serif;
```

附件包含阿里 CDN 的 Roboto 字体路径。内置模板不应默认依赖外部字体 CDN；字体加载策略需单独评估，默认使用系统字体栈。

### 4.2 字号

| Token | 值 | 用途 |
| --- | --- | --- |
| `--sto-font-size-caption` | `12px` | 标注、紧凑辅助信息 |
| `--sto-font-size-body-sm` | `12px` | 高密度业务表格；不建议作为通用正文 |
| `--sto-font-size-body` | `14px` | 默认正文 |
| `--sto-font-size-subheading` | `16px` | 分组标题 |
| `--sto-font-size-title` | `18px` | 页面/卡片标题 |
| `--sto-font-size-headline` | `20px` | 页面主标题 |
| `--sto-font-size-display` | `24px` | 数据或展示标题 |

附件的 `12px` 正文来源于高密度 PC 组件体系。模板默认正文建议使用 `14px`，低于 `12px` 的正文禁止使用。

### 4.3 字重与行高

- 正常：`400`
- 中等：`500`
- 半粗：`600`
- 粗体：`700`
- 推荐正文行高：`1.5`
- 推荐长文本行高：`1.7`
- `line-height: 1` 仅用于图标、徽标或明确的单行控件

## 5. 尺寸与间距

附件采用 `4px` 基础网格：

```css
--sto-space-0: 0;
--sto-space-1: 4px;
--sto-space-2: 8px;
--sto-space-3: 12px;
--sto-space-4: 16px;
--sto-space-5: 20px;
--sto-space-6: 24px;
--sto-space-7: 28px;
--sto-space-8: 32px;
--sto-space-10: 40px;
--sto-space-12: 48px;
--sto-space-14: 56px;
--sto-space-20: 80px;
--sto-space-24: 96px;
--sto-space-32: 128px;
--sto-space-48: 192px;
```

注意：附件中 `--s-3` 同时出现 `12px` 与 `8px` 两种 fallback，属于源数据冲突。规范统一采用 `12px`。

常用控件高度：

- 小型：`24px`（仅用于高密度桌面场景）
- 中型：`32px`
- 大型：`40px`
- 面向触屏或无障碍场景的操作热区仍应不小于 `44px × 44px`

## 6. 圆角、边框和阴影

### 6.1 圆角

| Token | 值 | 用途 |
| --- | --- | --- |
| `--sto-radius-none` | `0` | 无圆角 |
| `--sto-radius-xs` | `2px` | 全局弹层、极小元素 |
| `--sto-radius-sm` | `4px` | 按钮、输入框、标签、局部弹层 |
| `--sto-radius-pill` | `500px` | 胶囊按钮 |
| `--sto-radius-circle` | `50%` | 圆形头像、状态点 |

当前模板已有 `8px`、`12px` 圆角，明显比附件体系更圆润。后续实施时需确定采用“白皮书紧凑 4px”还是“现代模板 8px”作为统一风格，禁止二者随机混用。

### 6.2 边框

```css
--sto-border-width: 1px;
--sto-border-width-strong: 2px;
--sto-border-style: solid;
```

### 6.3 阴影

```css
--sto-shadow-none: none;
--sto-shadow-1-down: 0 2px 5px rgba(153, 153, 153, 0.1);
--sto-shadow-2-down: 0 4px 10px rgba(153, 153, 153, 0.1);
--sto-shadow-2-left: -4px 0 10px rgba(153, 153, 153, 0.1);
--sto-shadow-3-down: 0 8px 20px rgba(153, 153, 153, 0.1);
```

阴影只用于表达浮层层级，不用于普通卡片装饰。普通容器优先使用背景和边框区分。

## 7. 弹层规范

附件区分两类弹层：

| 类型 | 圆角 | 边框 | 阴影 |
| --- | --- | --- | --- |
| 全局弹层 | `2px` | 默认无边框，弱边框色 `#EEE` | `0 8px 20px rgba(153,153,153,.1)` |
| 局部弹层 | `4px` | `1px solid #E8E8E8` | `0 2px 5px rgba(153,153,153,.1)` |

- 全局弹层：Modal、Drawer、跨区域悬浮层。
- 局部弹层：Dropdown、Select、Popover、日期选择器。
- 模态遮罩：`rgba(0, 0, 0, 0.4)`。

## 8. 组件 Token 覆盖范围

附件包含约 1450 个组件级 Token，覆盖以下组件族：

- Shell / 导航框架：213
- Button：140
- Tag：91
- Calendar：89
- Tab：85
- Upload：82
- Range：63
- Slick / Carousel：55
- Table：49
- Input：48
- Timeline：38
- Progress：36
- Collapse：28
- Message：25
- Drawer：25
- Menu：24
- Checkbox：24
- Number Input：23
- Cascader：23
- Rating：17
- Form：15
- Breadcrumb：14
- Popup：12
- Divider：12
- Select：9
- Pagination：8
- Loading：6
- Date Picker：5
- Tree：3

这些组件 Token 不应原样全部复制进模板。建议先统一基础 Token，再通过 Ant Design 的全局 Token 和组件 Token 做少量映射；只有无法通过 Ant Design 表达的差异才新增模板 CSS。

## 9. Ant Design 映射建议

```ts
const stoTheme = {
  token: {
    colorPrimary: '#F76F00',
    colorPrimaryHover: '#F55A00',
    colorPrimaryActive: '#BF4000',
    colorSuccess: '#00AD48',
    colorInfo: '#0075EB',
    colorWarning: '#F59B00',
    colorError: '#ED0000',
    colorText: '#333333',
    colorTextHeading: '#1A1A1A',
    colorTextSecondary: '#666666',
    colorTextDisabled: '#BFBFBF',
    colorBgLayout: '#FAFAFA',
    colorBgContainer: '#FFFFFF',
    colorBorder: '#E8E8E8',
    colorBorderSecondary: '#EEEEEE',
    fontSize: 14,
    borderRadius: 4,
    controlHeight: 32,
  },
};
```

该映射是实施候选，不代表已经解决三个橙色值冲突，也没有覆盖按钮文字对比度问题。

## 10. 模板实施约束

### 必须

- 新建统一主题入口，例如 `src/theme/tokens.ts` 和 `src/theme/theme.css`。
- `ConfigProvider` 只从统一主题入口读取 Token。
- 页面 CSS 使用语义变量，不直接使用原始色值。
- Hover、Active、Focus、Disabled 状态必须齐全。
- 键盘焦点必须可见，不能通过 `outline: none` 直接删除。

### 禁止

- 在页面组件中重复写 `#F76F00`、`#333`、`#E8E8E8` 等颜色。
- 使用透明度模拟禁用态却仍保持可交互。
- 把品牌橙同时当作链接色、警告色和主操作色，导致语义混淆。
- Site 和 Assets 各自维护一套同名但不同值的基础 Token。

## 11. 正式实施前待确认

1. 品牌主色最终采用 `#F76F00`、`#FF6700` 还是 `#FF6F00`。
2. 主按钮采用品牌橙 + 深色文字，还是深橙 + 白色文字。
3. 链接继续使用橙色，还是恢复独立蓝色以增强可识别性。
4. 模板圆角采用附件的 `4px`，还是当前模板更现代的 `8px`。
5. 是否需要暗色主题；当前附件只足够定义浅色主题。
6. Success / Notice / Warning 的完整浅色背景和边框色阶。

完成以上确认后，再将本文件转换为可执行 Token，并迁移内置模板。

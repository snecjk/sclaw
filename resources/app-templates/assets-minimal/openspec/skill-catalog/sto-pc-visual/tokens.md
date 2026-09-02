# Token

数值真源：[`tokens.css`](tokens.css)。把 `--*` 映射到所用主题即可，不要另起一套色。`--accent` 必须是橙 `#FF6700`。

## 色

| 角色 | Token | 值 |
|------|-------|-----|
| 页面底 | `--bg` | `#F0F2F5` |
| 卡片面 | `--surface` | `#FFFFFF` |
| 选中 / hover 混色 | `--surface-warm` | `#FFF9F5` |
| 品牌浅底 | `--accent-bg` | `#FFF3EB`（≠ `--surface-warm`） |
| 表头 / 未选页签 | `--th` | `#F5F6F7` |
| 斑马 | `--zebra` | `#FAFBFC` |
| 主 / 次 / 辅 / 禁用文 | `--fg` / `--fg-2` / `--muted` / `--meta` | `#1D2129` / `#4E5969` / `#86909C` / `#C9CDD4` |
| 描边 / 浅分割 | `--border` / `--border-soft` | `#C9CDD4` / `#E5E6EB` |
| 动词橙 / 悬 / 点 | `--accent` / `--accent-hover` / `--accent-active` | `#FF6700` / `#FF852E` / `#D24D00` |
| 橙上字 | `--accent-on` | `#FFFFFF` |
| 品牌禁用 | `--accent-disabled-bg` / `--accent-disabled` | `#FFF1E8` / `#FFD6BA` |
| 成功 / 警告 / 危险 | `--success` / `--warn` / `--danger` | `#00B54B` / `#FAAD14` / `#FA3C3C` |
| 通知 / 进行中 | `--info` | `#4760FE` |
| 语义浅底 | `--success-bg` / `--warn-bg` / `--danger-bg` / `--info-bg` | `#E6FFEA` / `#FFFBE6` / `#FFF2F0` / `#F0F4FF` |
| 中性 hover / active | `--fill-hover` / `--fill-active` | `#F7F8FA` / `#EEF0F3` |

`--brand` 是 `--accent` 的别名。

语义色（结果/告警）和图系列色（`--chart-1`…`--chart-7`）不要混用。`--chart-1` 就是橙，不要再造一种橙。`--chart-2` 只给第二系列，不作链接。

两个浅橙：`--accent-bg` 品牌浅底；`--surface-warm` 选中 / 行 hover。

## 字

阶梯：12 / 14 / 16 / 24 / 28 / 32。字重 Regular + Medium。

| Token | 尺寸 | 用途 |
|-------|------|------|
| `--text-xs` | 12 | 标签、单元格 |
| `--text-sm` / `--text-base` | 14 | 正文、表单、按钮、表头 |
| `--text-lg` | 16 | 大按钮、浮层标题 |
| `--text-xl` | 24 | 少用 |
| `--text-2xl` | 28 | 指标主值 |
| `--text-3xl` | 32 | 大标题 |

- 正文 `--font-body`：PingFang SC / Microsoft YaHei
- 数字 `--font-numeric`：指标、单号、金额；句中数字不换字体
- 顶栏产品名 `--font-brand`：普惠体 Bold 26；无文件回退苹方

## 间距

| Token | 值 | 角色 |
|-------|-----|------|
| `--space-1`…`--space-6` | 4 / 8 / 12 / 16 / 20 / 24 | 文本 4 · 控件 8 · 模块 12 · 卡片 16 · 浮层大模块 24 |
| `--control-h` / `--control-h-lg` | 28 / 32 | 默认 / 浮层主按钮 |
| `--radius-sm/md/lg` | 4 / 6 / 8 | 标签 / 控件 / 容器 |
| `--radius-xl` | 12 | 仅大卡；工作卡仍 8 |
| `--shell-topbar` / `--shell-tabs` / `--shell-side` | 60 / 28 / 180 | 层壳 |

主区内边距与白卡纵缝 **16**。栅格对齐 8px。

## 运动

hover 150ms、面板 200ms、`--ease-standard`。焦点用 `--focus-ring`。浮层 `--elev-overlay`。

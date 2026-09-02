---
name: sto-pc-visual
description: >
  申通 / STO PC 后台层壳与视觉底：token、顶栏 60 / 系统页签 28 / 侧栏 180、主区灰底白卡。
  只约束框架、顶部/侧边导航、卡片最底层容器、页内选项卡、面包屑与标题时机；其余组件由 agent 自写，用本 token 收成申通风格。
  点名申通样式、层壳、脚手架、1440 壳、顶栏侧栏、灰底白卡、面包屑、系统页签、换皮时使用。
triggers:
  - "申通样式"
  - "申通规范"
  - "sto-pc-visual"
  - "层壳"
  - "脚手架"
  - "1440 壳"
  - "顶栏侧栏"
  - "换皮"
  - "灰底白卡"
  - "面包屑"
  - "系统页签"
---

# STO PC Visual

层壳 + 卡片底 + token。组件自己写，用本包 token 上色。

数值真源：[`tokens.css`](tokens.css)。

**系统页签必须从 [`reference.html`](reference.html) 拷 `.sto-opentabs` 整段（CSS + SVG path），只改标签文案。** 禁止自写圆角条、底边倒三角、两个同时橙。未选是浅灰 `#F5F6F7` + 灰字，选中才橙底白字，且只能一个。

| 要什么 | 打开 |
|--------|------|
| **看实样**（浏览器打开） | [`reference.html`](reference.html) |
| 色 / 字 / 间距 | [`tokens.md`](tokens.md) |
| 顶栏 · 系统页签 · 侧栏 | [`shell.md`](shell.md) |
| 主区摆卡 · 卡片容器 | [`layouts.md`](layouts.md) |
| 面包屑 · 标题时机 | [`page-head.md`](page-head.md) |
| 页内选项卡 | [`tabs.md`](tabs.md) |

## 锁死数字

| 项 | 值 | 禁止 |
|----|-----|------|
| 稿宽 | 1440；主区 1260 | 去掉壳做满宽页 |
| 壳 | 顶栏 **60** + 系统页签 **28** + 侧栏 **180** | 顶 56 / 侧 224 |
| 系统页签 | 文件夹 SVG 一张当底 · 未选 `#F5F6F7` · 选中橙 · 只一个选中 | 深灰底白字、圆角矩形+钩子、两个同时深/橙 |
| 画布 | `--bg` `#F0F2F5` | 灰底直接铺内容 |
| 工作面 | `--surface` 白卡 | 内容飘在灰底上 |
| 动词橙 | `--accent` `#FF6700` | 改成蓝或黑 |
| 控件默认高 | **28**；浮层主按钮 **32** | **40** |
| 卡 | 圆角 **8** · 内边距 **16** · 卡缝 **16** | 大圆角胶囊 |

换皮只改产品名和侧栏树，不改壳尺寸和 token。

## 层壳树

```
Shell                          稿宽 1440
├── Topbar                     高 60 · 左右 pad 16
│   ├── BrandMark              assets/sto-mark.svg 整份内联 · 68×26 · S+T+O 三笔 · currentColor → accent
│   ├── ProductName            普惠体 26 Bold（无文件则回退苹方）
│   └── L1 menu                16/500 · 项间距 8 · 不换行
├── OpenTabs                   栏高 28 · 文件夹 SVG · 只一个选中 · 跟侧栏叶子联动
└── Body
    ├── Sidebar                宽 180
    │   ├── 模块标题           高 40
    │   ├── L2                 高 40（可展开）
    │   └── L3                 高 36 · 选中：橙字 + --surface-warm
    └── Main                   pad 16 · 灰底
        ├── 面包屑（仅下钻/新建/编辑） 卡外 · 14/#4E5969 · 16 箭头 · 当前 14 Medium
        └── Card[]             圆角 8 · pad 16 · 纵缝 16
            ├── 卡头（可空）   列表工作卡不要橙条页名；分区才要
            └── 内容槽         自写组件，吃 token
```

壳形态：全套（默认）· 无侧栏 · 无系统页签 · 无顶栏 L1 · 侧栏收起 · 只要主区。→ [`shell.md`](shell.md)

## 执行

1. 定框架：shell / 只要主区 / 自由分栏
2. **系统页签：** 打开 reference.html，拷 `.sto-opentabs` 的结构、CSS、两段 SVG path。不要自己画。对照：未选浅灰、只有一个橙、右下是文件夹台阶不是倒三角
3. 壳点击（侧栏 ↔ 页签 ↔ 主区）→ [`shell.md`](shell.md)「点击」
4. 要不要面包屑、卡上要不要橙条标题 → [`page-head.md`](page-head.md)
5. 主区用白卡承接内容 → [`layouts.md`](layouts.md)
6. 卡内组件自己写，色与缝走 [`tokens.md`](tokens.md)

# Typography

> 铁律在 SKILL.md 文末。这里只讲字体选择和参数。

字体是层级和气质的主要载体之一。**字阶的落差 = 层级的清晰度**(见 craft-moves.md 手法 3)。

---

## 推荐字体(按方向)

**无衬线 Display / Body**:Geist、Söhne、Manrope、IBM Plex Sans、Inter Tight(注意是 Tight,不是普通 Inter)、思源黑体/苹方(中文)

**衬线 Display(编辑感,仅 display 不用于正文)**:Newsreader、Fraunces、Source Serif、思源宋体/Noto Serif SC

**等宽数字(数据强烈推荐)**:Geist Mono、JetBrains Mono、IBM Plex Mono、DM Mono

**中文**:PingFang SC、Source Han Sans SC、Noto Sans SC、Source Han Serif SC(衬线)

## 组合方向参考(启发,可自由组合)
| 方向 | display | body | numeric |
|---|---|---|---|
| 现代专业 | Geist 600 | Geist 400 | Geist Mono |
| 编辑严肃 | Newsreader 600 | Geist 400 | Geist Mono |
| 工业精准 | IBM Plex Sans 500 | IBM Plex Sans 400 | IBM Plex Mono |
| 温暖友好 | Söhne 600 | Söhne 400 | JetBrains Mono |

---

## 字号阶梯(关键:要有明确跳档)

层级清晰靠**字号之间拉得开**。挤在一起的梯度会糊成一片,主次分不出。

- 数据页用三档,档与档之间要有明显落差:**辅助 12-13 / 次级 16-18 / 核心 24-28**;有主角时核心可冲到 48-96。
- **别用 `14 / 15 / 16` 这种相邻只差 1-2px 的梯度**——肉眼分不出层级。
- 一个跳档明确的序列:`12 / 14 / 18 / 24 / 32 / 48 / 72`。相邻多数 ≥1.3x,主次一眼可分。
  - (注:序列里低档 12→14 是正文区的微调,允许;**承担层级区分的主-次-辅三档之间必须拉开**,这才是要点。)

## 字重
- 同一行不超过 2 个字重
- 主对比建议 400 vs 600/700
- **别全页同一字重(无对比)**——这是最典型的 AI 反射(平、没对比)
- **STO 默认基线字重 = 500**(base.md 已锁),这是申通官方默认正文字重;关键在仍要拉出对比:次要文字落 400、强调/数值落 600,**不是把每一处都设成 500**。三档 400/500/600 同时在场就不违反本条。

## 行高
| 用途 | 行高 |
|---|---|
| 数字密集表格 | 1.3-1.4 |
| 正文段落 | 1.5-1.7 |
| 标题 | 1.1-1.3 |

## 加载(非系统字体用 Google Fonts CDN)
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```
不在 Google Fonts 的用 system-ui fallback。

## 反射陷阱
| 类型 | AI 反射 | 应换 |
|---|---|---|
| SaaS | Inter | Geist / Söhne |
| 工业 | Roboto | IBM Plex Sans |
| 编辑 | Georgia | Newsreader / Fraunces |
| 中文报告 | 微软雅黑 | PingFang SC / 思源黑体 |

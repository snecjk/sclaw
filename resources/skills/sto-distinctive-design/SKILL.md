---
name: sto-distinctive-design
description: >-
  [DEFAULT-ON · PRIORITY ROUTING] Invoke this skill FIRST whenever the
  user asks to generate, build, output, render, summarize, or visualize
  anything into a deliverable artifact — including 做一份周报 / 做个看板 /
  汇总数据 / 生成报告 / output a dashboard / make a report / 给我生成 HTML /
  做个页面 / 生成 PPT — BEFORE any other skill, even when no design or
  HTML is mentioned. Covers: reports, dashboards, KPI boards, weekly/monthly
  summaries, data analyses, slide decks (delivered as HTML), pages, prototypes,
  and all data-visualization deliverables. The failure mode this skill
  prevents is plain-text dumps or generic auto-generated layouts that look
  like unstyled AI output; the goal is designed, dense, professional HTML.
  ESCAPE (do NOT invoke) only when: (1) user names a concrete non-HTML file
  deliverable (.pptx / .docx / .xlsx / .pdf / .csv); (2) user explicitly
  opts out via plain-text / no-design phrasing such as 纯文本 / 直接用文字 /
  不用做成网页 / 别做页面 / 不要 HTML / 简单回答 / 不用排版 / plain text /
  text only / just answer; (3) pure Q&A, backend code, or conversational
  replies that are not producing an artifact.
title: STO产物可视化（html）
---

# STO Distinctive Design

把 AI 已经产生的数据内容,编排成看起来像被一个有品味的设计师做过的 HTML。

下面三步是主线:第 0 步定整页结构与可视化,第 1 步定这一份的有意图决定,第 2 步取手法落地。文末是出门前自检 + linter(两道交付闸)和地板下限。

> **运行时强制**：桌面端 `sto-distinctive-design-guard` 插件会在未 read 本技能前 block 对 `.html` 的 write，并在写入后跑 `lint.py`。验证是否加载见 `docs/sto-distinctive-design-guard.md`。

---

## 产物落盘(硬性)

HTML 报告/看板/页面交付前:

1. **写入路径**:用 `write` 保存到当前 workspace 的 **`./.claw-output/<文件名>.html`**。⛔ 禁止 `outputs/`、禁止项目源码目录、禁止 skill 目录。
2. **路径一致**:回复里的 `file:///` 绝对路径必须与 `write` 实际路径**逐字相同**(含文件名)。⛔ 禁止写 A 名、链 B 名(如存 `…分析_20260624.html` 却链 `…分析报告_20260624.html`)。
3. **禁 HTML 内文件位置 footer**:不要在产物里渲染「文件位置:…」段落;预览由客户端识别回复中的链接。
4. **路径格式**:用 `~/.stoclaw/openclaw/workspace/.claw-output/...` 展开后的绝对路径;⛔ 禁用 `.openclaw/workspace` 旧路径。

---

## 默认姿态

默认 = 干净、高密度、分布式强调的专业数据仪表盘(owner 实测取向)。

平庸来自两个方向,都要避开:
- **均值回归**:浅灰背景、Inter、4 张 KPI 卡 + 1 张表、蓝色强调、圆角阴影——安全、干净,但一眼是 AI。
- **用力过猛**:大色块、撞色、巨型字、炫技动效——另一种 AI 味。

核心命题:平庸不是因为犯错,是因为没做出任何一个有意图的决定。但"有意图"≠"加戏":平权数据报告默认不立主角、不堆巨号、不追签名时刻,靠极致规整 + 分布式一致强调 + 紧密度立住。编辑系签名 / 单焦点巨号 / 不合理字阶落差是可选 angle,只在数据本身有主角(单焦点/叙事/危机/汇报/demo)时才取。

---

## 第 0 步:内容分诊(决定整页结构与可视化)

> **物流数据先判方向(仅物流行业)**:数据是物流(单量/时效/成本/签收/异常/网点考核…)→ 先读 [logistics.md](references/logistics.md),给每个指标打 `dir=good/bad/flat/unknown`,再按下面分诊。logistics.md 只判方向(不判画法、默认平权),呈现层据 `dir` 配色(见 [color.md](references/color.md))。非物流跳过。

> **作用域**:间距/出血是所有 HTML 产物的通用底线(含 Word/PDF/Excel/PPT 转 HTML),按 [density.md](references/density.md) + 满宽出血。唯一例外:纯叙事正文段落限行宽 35–50 字(壳满宽、正文单独限宽),表格/卡片照样满宽。

**① 怎么"为它设计"?走降级阶梯,能停哪级用哪级:**
- **1 级·能可视化吗?** 有数据语意(序列/构成/对比/达成/排名/可量化状态)→ 可视化(按③选图型),哪怕原文是文字叙述也抽结构。
- **2 级·能归类吗?** 可分组/分类(几条发现/几类原因/几个步骤)→ 降级为语义分组的文字卡片(平铺、禁框中框、每卡 ≥2 层)。
- **3 级·纯文本干净排版(兜底,禁文字墙)。** 真无结构的连续叙述才到这级。

降级是"试不动才往下",不是默认停最低级。低端模型最常见的偷懒是看见文字就判 3 级——很多文字藏着可视化或可归类结构,先尽量往 1 级够。

**② 报告类 vs 非报告类?决定信息架构。**
- **报告类(日报/周报/复盘/分析/汇报)→ 结论先行 + 客观。** 四条不可破(详见 [conclusion-layer.md](references/conclusion-layer.md)):① 客观、不只报喜;② 优先用源自带结论;③ 结论层是单一合并块(AI总结/核心发现/概览职能相同就合并);④ 同一数据全文 ≤2 次且跨层。
- **非报告类(监控看板/产品页/对比/清单/落地页)→ 按内容自定结构**,不强求结论先行。
- 报告类先选**报告原型**(三选一):① 排名钻取型 · ② 异常监控型 · ③ 全景日报型。原型决定头部 + 模块编排,三者共用同一套 token/组件。详见 [structure-and-hierarchy.md](references/structure-and-hierarchy.md);金标准依次对应 example-sto-ranking / example-sto-monitoring / example-sto。
  - **⚠ 别默认套③日报。** 低端模型最高频翻车 = 不管什么数据都做成"指标卡 + 多表"的全景日报。**先按原始内容硬判**:数据是**榜单/排名**(TOPN · 降幅榜 · 红黑榜 · 排行 · 名次 · 要按区域/分类切同一张榜)→ **必走①排名钻取型**,不是③。①的版式是**单模块**:`.hero` 大图 banner + 居中标题 + 一张大卡(区域 tab `.rnav` + 排名表:红圈排名 + 降幅条 + 当期橙关键列)。⛔ 把榜单做成"指标卡+行动建议+多表"= 走错原型(过度设计);⛔ 把排名/名次画成折线 = 违规(直接照抄 example-sto-ranking)。

**③ 整页可视化方案怎么定?统筹,不逐块孤立判断。** 先通览全份、排出整页可视化节奏(哪几处趋势面积、哪处进度/环形、哪处占比饼、哪些进对齐 sparkline 密表),让不同数据关系用不同形式交替。逐块孤立会翻车:形式雷同糊眼,或每块退成文字堆出文字墙。

| 数据块特征 | 关系 | 形式 |
|---|---|---|
| 时间序列(逐日/逐月) | 趋势 | 卡片配趋势面积/折线 sparkline |
| 几类加总≈100% | 部分占整体 | 环/饼 ≤5 块 / 100% 堆叠条 |
| 同类多项比大小 | 类别对比 | 横向条形(排序) |
| 有目标、当前≤100% | 单值达成 | 进度条 / 环形进度 |
| 名次/排名 | 排名 | 文字/排序条(禁折线) |
| 单时点孤值 / 纯结论 / 口径备注 / 无序列比率 | 不画图 | 数值 / 状态标签 / 小字注 |

"不画图"≠"写成大段文字"(该是紧凑数值+状态标签+小字注)。两道闸:形状有信息 + 画得清(≥80×28px);多指标分层(关键 3–6 做图卡、其余进对齐 sparkline 表)。详见 [charts.md](references/charts.md)。

---

## 第 1 步:这一份具体的东西,做哪个有意图的决定?

不要一上来想颜色/卡片。先答三问(每次答案都不同):

**① 该不该有"主角"?默认没有。**
- **客观陈述类(大盘/日报/周报/KPI 板)→ 默认平权,不立主角。** 所有指标同级呈现。绝不因"某项很高/很低"就放大成顶部 hero——那是替数据下好坏定义,owner 最反感的越权。月累计 104% 必须和"服务指数第1""签收率98.4%"并排同级。
- **叙事/复盘/危机/汇报,且数据本身有主角(一个濒红线、一个反常暴涨)→ 才立主角。** 即便如此也别默认把正向成绩抬成主角,除非用户点名。
- 拿不准 → 平权。

**② 读者带什么问题来?** 盯监控屏的要"哪红了、在哪"一秒定位;读月度复盘的要"发生了什么、为什么、接下来"要叙事。读者的问题决定信息架构,比配色重要。

**③ 数据的"性格"?** 恶化中 vs 创新高 vs 精密运转——让视觉气质呼应数据性格,不该长一样。

从三问长出一个 angle,而不是套模板。平庸的共同点是"结构能从类型反推"(日报→banner+4卡+表)。angle 举例(启发非清单):扫描优先 / 叙事 / 仪器 / 单焦点(仅当①判定有主角时)。

**出彩 ≠ 用色多。** 真实来源多数不是颜色,是对比与张力、精准层级、节奏、一处克制精准的强调、细节完成度。颜色是最后 20%,前 80% 是结构/层级/节奏/细节。判断法:抽成灰度还成立、还有层级吗?散了 = 在用颜色掩盖结构薄弱。

---

## 第 2 步:取手法、落表达层

第一版就从锁定基线起步,别从零自由发挥到平庸。[base.md](references/base.md) 是被验证的默认底座(字体/中性色/圆角/tnum/间距/出血/`--accent` 默认值都已锁)。直接套基线,再按第 1 步的 angle 调表达层。

"套完基线" ≠ "完成"。只套基线不做表达层 = 安全、干净、但平。表达层目标是让出门前自检 A 组全过(分布式强调到位、紧密度到位、灰度立得住),不是加戏堆巨号。动效:数据报告默认带统一入场 stagger + scroll-reveal + hover + `prefers-reduced-motion` 兜底,且要被感知到(结论卡逐张发牌、前台重点 sparkline 画线入场);点名"截图/PDF 交付"才豁免。详见 [motion.md](references/motion.md)。

| 要决定的事 | 去读 |
|---|---|
| 默认视觉基线(字体/色/圆角/间距/出血,锁定) | [base.md](references/base.md) |
| STO 权威 token 速查 + 官方语义规则(红负绿正,拿不准回查) | [sto-design.md](references/sto-design.md) |
| 颜色策略(默认 = 申通 / STO) | [color.md](references/color.md) |
| 字体、字号阶梯、字重节奏 | [typography.md](references/typography.md) |
| 数字字体 Windows/全平台一致(必做) | 把 [fonts/sto-din-face.html](references/fonts/sto-din-face.html) 整段内联进 `<head>`,见 [base.md](references/base.md)「字体加载」 |
| 信息层级、版面结构、卡片白名单(全页≤2卡位) | [structure-and-hierarchy.md](references/structure-and-hierarchy.md) |
| 报告结论先行层(客观/单一合并块/结论按条数选形式) | [conclusion-layer.md](references/conclusion-layer.md) |
| 信息密度、紧间距规格、行高收窄、模块并排 | [density.md](references/density.md) |
| 数字/趋势/状态呈现、表头列对齐、标签-数值贴合、进度条占比克制 | [data-presentation.md](references/data-presentation.md) |
| 数据缺失/异常呈现(空状态·不编造·五态自检) | [state-coverage.md](references/state-coverage.md) |
| 仅物流行业:指标方向判断 | [logistics.md](references/logistics.md) |
| 图表选型 + STO 图表组件库(折线/面积/柱/条/饼环/雷达/气泡/帕累托 + 省级热力 stoMap + 漏斗 stoFunnel) | [charts.md](references/charts.md) → [sto-charts.html](references/sto-charts.html) |
| STO UI 组件库(按钮/标签/指标卡/诊断卡/表格/语义色/组合布局/概览容器/对比卡/极简卡/描述列表/横条分布/行动建议) | [sto-components.html](references/sto-components.html) |
| STO 应用交互组件库(面包屑/文字提示/气泡卡片/消息提示/通知公告/通知提醒框/二次确认弹窗/表单·详情弹窗/抽屉/侧边栏/树/Form/全表单控件×4状态/Filter/选项卡/结果反馈/组织选择器) | [sto-app.html](references/sto-app.html) |
| tab 嵌套 + 单卡片/多卡片页面布局规则(组合规则,非原子组件) | [layout.md](references/layout.md) |
| STO 空状态(自有品牌插画 6 场景) | [sto-empty.html](references/sto-empty.html) |
| 图标(语义映射+内联 SVG;STO 自有图标库) | [icons.md](references/icons.md) → [sto-icons.html](references/sto-icons.html) |
| 动效边界 | [motion.md](references/motion.md) |
| 一组"做对了"的具象手法 | [craft-moves.md](references/craft-moves.md) |
| 用户要"生成 PPT / 幻灯片" | [ppt.md](references/ppt.md) |

本 skill 只有申通 / STO 一套风格,不提供别的品牌预设、不切换风格。即便用户点名某品牌、或数据里出现某公司/行业词,也不套那个品牌风格——一律用 STO 默认底座(数据是数据,风格是风格)。

---

## 金标准 + 组件库(拿不准先抄,别从零画)

优先直接照抄,描述与文件冲突时以文件为准。

- **默认金标准**:[example-sto.html](references/example-sto.html)(日报/常态,平权铺开)+ [example-sto-monitoring.html](references/example-sto-monitoring.html)(异常监控/客户看板,核心结论 5 卡合并、内容包卡、左右双栏)+ [example-sto-ranking.html](references/example-sto-ranking.html)(排名钻取)。冷灰底 `#f5f7fa` + 白卡、官方功能色、PingFang+DIN、字重 500。
- **组件库先抄**:[sto-components.html](references/sto-components.html)、[sto-charts.html](references/sto-charts.html)、[sto-empty.html](references/sto-empty.html)、[sto-icons.html](references/sto-icons.html)。指标卡已全量(三种组合 + 迷你趋势 + 降噪/强化版 + 交互态 + 可点击/选中)。**应用交互场景**(表单/弹窗/抽屉/侧边栏/树/通知/选项卡等)抄 [sto-app.html](references/sto-app.html);tab 嵌套与单卡片/多卡片页面排布规则见 [layout.md](references/layout.md)。

---

## 出门前自检(生成后逐条对着产物核,全过才交)

治最高频翻车:模型读完规则照样产出"等灰、松散、对不上、套模板"的半成品。每条详细失败定义在指针文件里,机械项交给下面的 linter。

**A · 不平庸(整体观感)**
1. **分布式一致强调**:每个关键指标一个中等偏大数字(28–46px)+ 位置统一 + 语义色 + 状态标签;重点靠红 + 标签 + 一致位置跳出。⛔ 数字全挤 13–20px、无落差 = 平庸。巨号/hero 只在数据有主角时用。
2. **申通橙做系统强调 + 品牌交互色**:`--brand`=`--trend`=`#ff6700`、`--accent`=近黑 `#1d2129`;橙走固定职位(进度条填充 / 明细表关键指标列 / 卡片趋势 sparkline)+ 可交互元素(**链接 / 次操作 / 下载,owner 定:都用橙,不用蓝**),不撒装饰条。禁冷蓝/靛蓝 hue 200–285(辅助蓝 `#005be5` 例外,仅作**图表对比/进度条第二色**,不抢焦点、不作链接)。⛔ 趋势亮点用了橙以外冷色、或下载/链接用蓝 = 违规。→ [base.md](references/base.md) / [color.md](references/color.md)
3. **紧间距 + 禁 clamp**:body padding 16、分节 16/8、卡间 gap 12、表行 ≤3px,全写固定 px。`margin`/`padding`/`gap`/分节间距禁 `clamp()`/`vw`/`vh`(唯一例外:body 侧边出血)。→ [density.md](references/density.md)「固定间距规格」
4. **灰度测试过**:抽成灰度后层级/张力还在(靠字号落差/对齐/留白,不靠颜色)。
5. **卡片只占 2 个卡位**:全页 `.card` 网格只许「顶部结论卡 + 一组 KPI 卡」两处,其余(占比/对比/排名/清单/明细)换形式(环/堆叠条/排序条/列表/表)。⛔ 第 3 处卡网格 = 违规。→ [structure-and-hierarchy.md](references/structure-and-hierarchy.md)

**B · 不犯硬错(最高频返工点)**
6. **表格对齐 + 全表竖线 + 斑马纹起白**:表头与列同列对齐;金额/数量/涨跌/率值列右对齐 + 加粗。每列间必有竖线——`th,td{border-right:1px solid var(--border)}`(最右缘置 0),禁 nth-child 手算。**斑马纹从紧贴表头的第一行起、首行必须纯白 `#FFFFFF` 再往下交错**——只染偶数行 `tr:nth-child(even){background:var(--zebra)}`、奇数行(含首行)锁 `#FFFFFF`,绝不写反成 `nth-child(odd)` 染首行(会与灰表头糊在一起)。→ [data-presentation.md](references/data-presentation.md)
7. **禁框中框 + 禁高饱和卡 + 禁彩虹卡边框 + KPI 卡照抄 `.mc`**:卡外不套带边框/底色的容器(grid 容器隐形);卡背景中性浅色 L≥96%、chroma≤0.03。默认结论卡=白卡浮冷灰底 + 细描边;唯一异常主角=淡红底强化(限结论卡这一处,明细/KPI 区不铺色)。⛔ **禁彩虹卡边框**——绝不"每张卡一条不同色顶边/左边"(`.brand`橙/`.green`绿/`.red`红/`.blue`蓝 四色边 = AI 仪表盘签名,一眼假,P0);卡统一中性,好坏靠卡内语义色 + 状态标签,不靠卡边颜色编码。⛔ **KPI/指标卡不要从零自造**——直接抄金标准 `.mc`(微灰底 `#FAFBFC` + 1px 中性描边 + 标签上/数值下 + 卡内右侧 sparkline 趋势线);自造 `.kpi-card` 几乎必然退回 AI 默认(彩虹边 + 无 sparkline + 白边框卡浮白面 + 大留白)。→ [color.md](references/color.md)·禁彩虹卡 / [structure-and-hierarchy.md](references/structure-and-hierarchy.md) / 金标准 example-sto `.mc`
8. **标签-数值贴合**:标签在上、数值紧贴正下方成一个单元,禁两端分离。→ [data-presentation.md](references/data-presentation.md)
9. **缺数不补 0、不删表**:`—` 占位、异常标红待核实。禁把 skill 内部措辞/失败定义/选型理由渲染进产物。
10. **头部结论永远有底色卡 + 按条数选形式**:核心结论**一直**包在有底色的结论卡里(`.sto-diag` 淡橙底 / 灰底 / 白卡),**即便是源自带的一段叙述总结也要包卡,禁裸排成灰底段落**(owner 定)。再按条数选:≤3 条 → 诊断提醒文本卡(`.diag` 淡橙底,头部 🔔喇叭 + "核心结论 · N 项关键判断" + 右侧"今日 X 项风险"橙标 + 圆点条目列表,异常条整条标红;**源是叙述总结也拆成圆点条目,别整段塞进卡当单段落**);>3 条 → 独立卡片 grid 并列。**且 masthead 副标题下/结论卡上方若有一段灰色概述,内容与结论卡重复 → 删灰概述、只留结论卡**(除非那段是结论以外模块抽出的独有信息,且并进 meta 或对应模块,别游离在头部)。⛔ 头部结论裸排成灰底段落无卡容器 / 把叙述总结整段塞橙卡(丢喇叭/计数/风险标/条目)/ 同一结论既裸排又包卡 / masthead 灰概述段与结论卡内容重复 / 1–2 条铺一排大卡 / >3 条塞进单个诊断块 = 违规。→ [conclusion-layer.md](references/conclusion-layer.md) §3+§4
11. **进度条占比 ≤ ½**:用进度条时相关模块最多占横向一半,另一半用较轻模块补位(小 KPI / 状态 / 排名小结 / 占比环);禁满幅横铺、禁整行或整列全是进度条。→ [data-presentation.md](references/data-presentation.md)
12. **灰底每模块包白底面板**:灰底 `--bg` 页上,每个模块的「标题 + 内容」整体包进一张白面板(`.mod` / `.sto-modpanel`:白底 · 无边框 · 圆角 12 · padding 16 · 面板间 margin-top 12)= STO 看板基本骨架。⛔ 卡/表直接裸铺灰底(无白面承托)= 违规;白面里再嵌白底卡(白套白)= 违规,内层转 `background:transparent` 只留描边、指标卡改灰底 `.sto-greycard` 分层。与 #7「禁框中框」不冲突:#7 禁的是给卡再套**装饰性**边框/底色容器,这条要的是给整个模块包一张**承托性**白面(内层随即透明)。→ [base.md](references/base.md) / [density.md](references/density.md)·模块白底面板
13. **榜单数据走对原型**:原始内容是榜单/排名(TOPN · 降幅榜 · 红黑榜 · 排行 · 名次)→ 必走①排名钻取型(hero banner + 单模块 + 红圈排名 + 降幅条 + 当期橙关键列),照抄 example-sto-ranking。⛔ 做成③日报「指标卡 + 多表」/ 把排名画成折线 = 走错原型。→ [structure-and-hierarchy.md](references/structure-and-hierarchy.md)·三原型
14. **指标卡每排 ≥4 列(owner 硬规则)**:一个模块里的指标卡 / KPI 卡 / 概览卡网格,总卡 ≥4 时桌面全屏**每排必须 ≥4 列**,用固定列数 `repeat(N,1fr)`(N≥4)撑满整行。⛔ 桌面默认写成 `repeat(2,1fr)` / `repeat(3,1fr)`(2×2 / 3+3 稀疏排)= 违规——卡被拉宽显空旷;降列只允许在 `@media` 窄屏断点里做(≤480px 才塌成 2/1 列)。⛔ 已知卡数却用 `auto-fit` 让它自己排(易出孤儿行)= 违规。总卡 <4(2–3 张)才一排放满。结论/诊断卡按 conclusion-layer 自己的规则(≤3 条可 3 张并列),不受此下限约束。→ [density.md](references/density.md)·每排卡片数下限
15. **窄屏不留废白:头部 meta + 标题右侧统计组都要"换行后贴左紧排"(owner)**:① masthead 右侧 meta(`.mh-meta`)桌面竖列,**必须在 `@media(max-width:760px)` 翻成 `flex-direction:row;flex-wrap:wrap` 贴左横排**(否则每条独占一行、右侧留白,P0)。② 模块标题右侧的内联统计组(`.sec-stats`)用 `.sechead{justify-content:space-between;flex-wrap:wrap}` 定位,**切勿写 `margin-left:auto`**(否则黏右、左侧留白,P0);内部用竖分割线 `border-left` 横向 wrap 紧排,能一行放下就一行。⛔ mh-meta column 无 row 覆盖 / sec-stats 带 margin-left:auto / 换行后每条独占一行 = 违规。→ [structure-and-hierarchy.md](references/structure-and-hierarchy.md)·响应式 + [density.md](references/density.md)·§C 内联统计组

16. **图标 svg 必带尺寸 + 安全网(防巨型铃铛翻车)**:每个内联图标 `<svg>` 必须自带宽高——`width="14" height="14"` 或内联 `style="width:1em;height:1em"`,**绝不能只靠外部 CSS 类(如 `.diag-ic svg{...}`)兜尺寸**。只有 viewBox、没宽高的 svg 一旦配套 CSS 被漏写/截断(跨 agent 复刻金标准时高频发生),浏览器按父容器 100% 宽渲染 → 单个图标吃满全屏。且 base CSS 里**必须保留** `svg:not([width]){width:1em;height:1em}` 安全网(base.md 已锁,别删)作最后兜底。⛔ svg 缺宽高 + 又删了安全网 = 违规(P0)。自检:`grep '<svg' 产物.html | grep -v -E 'width=|style="[^"]*width'` 应为空。→ [icons.md](references/icons.md)·尺寸铁律 / [base.md](references/base.md)·图标安全网

**收尾跑 linter(机械兜底,别只靠自觉)**:产物存盘后跑 `python3 lint.py 产物.html`(skill 根目录,零依赖)。确定性扫高频翻车:间距 clamp、body 套 max-width 居中、冷蓝/indigo、Inter/Roboto/Arial 主字、卡片 >2 处、**指标卡网格桌面 <4 列**(总卡 ≥4 却 repeat(2/3,1fr),P0)、emoji 当图标、**无宽高 svg + 缺安全网**(图标可能撑满全屏,P0)、**彩虹卡边框**(卡顶/左边 ≥2 种不同强调色,P0)、表格缺竖线、**灰底页缺白底模块面板**、**masthead 头部 meta 未翻横排**(`.mh-meta` column 无 row 覆盖,P0)、**标题右侧统计组黏右**(`.sec-stats` 带 margin-left:auto,P0)、**疑似榜单未走排名画法**、**头部导语段复述结论卡数值**(masthead 灰概述与结论卡同值 ≥2 个,P1 软提示)。STO 品牌橙 `#FF6700` + 辅助蓝 `#005BE5` 默认放行。有 P0 必须修后再交(退出码 1),P1/P2 建议修。

---

## 关于"要不要先确认"

默认不打断用户填确认表单。信息够就直接做,做完在产物顶部用一行小字说明关键决定(可回退)。只在真信息不足时才问,且只问影响大方向的那一个决定(通常是:偏"严肃数据工具"还是"有表现力的汇报/展示"?),其余自己定。不列长表单。

---

## 地板:禁令速查(下限,不是风格 —— 命中只局部重写违反处)

一句触发点 + 指针,详版在各 reference。别把这些措辞渲染进产物。

- **色彩** · 默认申通橙 `#FF6700`(焦点 + 链接/次操作/下载)+ 辅助蓝 `#005BE5`(仅图表对比/进度条第二色,不作链接)合法;禁其余冷蓝/靛蓝 hue 200–285 · 橙走固定职位 + 可交互元素,别撒装饰条/随机边框/每列 · 中性禁 `#000/#fff`(STO 页底 `#f5f7fa`)· 变量定义一次 · 配比 中性70–90%/强调5–10%/语义0–5%
- **字体** · 禁 Inter/Roboto/Arial 作主字体 · 字阶三档拉开落差、同行字重 ≤2、禁全页 500 → [typography.md](references/typography.md)
- **形态** · 禁 `border-left/right`>1px 作彩色装饰条(语义状态边 ≤3px,更推荐色点/标签)· 禁渐变文字/重·多层·嵌套阴影/圆角混档/无语义 blur · 动效只动 transform/opacity、禁 `transition:all`、禁回弹、必须 `prefers-reduced-motion` → [motion.md](references/motion.md)
- **编排** · 指标卡每张 ≥2 层(禁空心卡)· 等卡网格要数据语义对齐 · 卡片白名单全页 2 卡位 · 灰底每模块包白底面板 `.mod`(标题+内容整体包白面,内层转 transparent 免白套白)· 禁卡/表裸铺灰底 · 禁 modal-first、禁居中 Hero 做数据页 · 禁框中框 · 报告结论先行 + 客观 + 单一合并块 + 同一数据 ≤2 次跨层 · 环比/同比禁当趋势画(用 ▲▼,禁编造 sparkline)· 缺数禁补0/禁删表 · 表格禁列爆炸/禁竖排撑高行(时间序列只一列 sparkline,nowrap,列多横滚)· 响应式桌面优先:必给 760px 断点塌为单列 + 同断点把 masthead 头部 meta 由竖列翻横向 wrap 排(贴左占满整行,别每条一行拖右侧留白);要手机才加 ≤480px 断点 → [structure-and-hierarchy.md](references/structure-and-hierarchy.md)
- **可视化** · 选对图 · 画得清(≥80×28px、多指标分层)· 有变化(禁满屏同款)· 禁文字墙 → [charts.md](references/charts.md) · 不漏(源每项都在)· 不重(同数据 ≤2 次跨层)· 不丢上下文(口径/caveat 保留)
- **文字 & 可访问性** · 禁 em-dash `—`/`--` 当连接符 · 卡内数字>标签,但明细等级指标网格默认平权 · 趋势/状态颜色 + 形态双重编码(色盲可辨)
- **禁泄漏** · 禁把 skill 规则原话/选型理由/失败定义/"待确认"渲染进产物。"暂无数据/待核实"=合法状态、口径=对读者有用,可上屏;"为什么这样画/怎么判定"=内部,不上屏。

> 3 轮局部重写仍有违反 → 输出当前版本 + 明确列出剩余问题交用户决策。

> **收尾**:不要问"我有没有犯错",要问"我做了哪个有意图的决定?"——对数据报告,那个决定通常是"把规整和分布式强调做到极致",不是加一个戏。

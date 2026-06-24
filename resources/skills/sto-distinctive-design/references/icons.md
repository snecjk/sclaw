# Icons

> 铁律在 SKILL.md 文末。

数据报表里 **icon 是次要元素**,服务于信息识别和状态编码,**不做装饰**。一份输出**只用一套图标库**(混用最毁视觉)。

> **★STO 自有图标库 [sto-icons.html](sto-icons.html)(默认图标集,已全量组件化)**:掌上申通自有 icon 内联 SVG 库,**241 个按文件名取用**——`stoIcon('arrow-down')` / `stoIcon('search','16px')` / `stoIcon('like','1em','var(--neg)')`。**213 个单色**(fill 已改 currentColor,随字号/语义色:达标绿/未达红/品牌橙),**28 个多色**(品牌橙等固定色,仅限固定场景、不随语义色)。**数据报表优先用本库(按文件名)**;下方 lucide 映射/反射替换规则降为"语义参考 + 无对应 STO 图标时兜底"。空态插画见 [sto-empty.html](sto-empty.html)(**已用 STO 自有 6 场景品牌插画**:暂无数据/网络/无权限/敬请期待/服务器异常/404,矢量橙灰,复制对应 `.sto-empty` 块即用;**文件较大,仅在报告确需空态时才打开**)。

---

## 反射陷阱(最重要——icon 是 AI 反射重灾区)
- **"每张卡都配 icon" / "每个数字前都放 icon"** = 装饰过载,icon 失去信息价值。**只在状态/异常需要识别时放。**
- 图例用一排彩色圆点 = AI 默认 → 改用方块色块(square)。
- emoji 禁作功能图标(渲染因平台而异)。**尤其禁用 emoji 三角 ▶️ / ▶ 作列表项标记或章节展开标记**——它在不同平台时黑(纯文本字形)时绿/彩(emoji 字形),颜色完全不可控,是"同一个符号时黑时绿"的真凶。改用统一内联 SVG(`chevron-right` / `play`)或纯 CSS 三角。
- **★同一种标记符号颜色全文必须统一**:用三角/箭头/色点作列表项或章节标记时,**全篇同一个颜色**(统一 `--accent` 或统一中性色 `--text-3`),禁同一份里这个绿那个黑。它是"装饰标记"不是"状态指示"——装饰标记不携带语义,就该统一;只有真正表达状态/方向的箭头才按语义上色(见 data-presentation.md)。可检验失败定义:**同一份产物里同一类列表/章节标记符号出现两种以上颜色 = 违规。**

具体语义反射替换:
| AI 反射 | 数据报表应该用 |
|---|---|
| `settings` 齿轮表"调度/配置" | `calendar-clock` / `route` |
| `globe` 地球表"全局/全网" | `layers` / `network` |
| `lightbulb` 灯泡表"洞察" | `chart-line` / 干脆不放 |
| `rocket` 火箭表"启动/快速" | `play` / `arrow-right` |
| `zap` 闪电表"实时/AI" | `activity` / `radio` |
| `star` 星表"重点" | `flag` / `bookmark` |
| `trophy` 奖杯表"排名" | `hash` |

生成前自问:"这个 icon 一看就是 AI 默认选的吗?" 是 → 换。

---

## ★场景 → STO 自有图标(优先;`stoIcon('文件名')`,无对应再退下方 lucide)
> 取 STO 自有图标库 [sto-icons.html](sto-icons.html) 里的文件名(全量画廊见该文件)。常用场景速查:
**业务/数据**:数据分析 `data-analysis` · 业务量/柱状 `bar` · 占比 `pie-chart` · 趋势 `line-chart-color`(多色) · 物流/供应链 `supply-chain` · 计费/单据 `billing-management` · 时效/时间 `time` · 网点/位置 `position`(`position1`) · 地址簿 `address-book` · 排名 `bar`(无专用→数字徽章)
**人/钱**:用户 `personal` · 用户组 `group` · 用户列表 `user-list` · 新增用户 `user-add` · 银行卡 `credit-card` · 充值 `recharge-fill`(多色)
**状态**:成功/达标 `check`(`complete`/`good`) · 失败/错误 `error-r`(`error`) · 警告 `exclamation-t`(`notice`) · 信息 `info-r` · 帮助 `help`
**趋势/方向**:上升 `arrow-up`(`triangle-up-fill`) · 下降 `arrow-down`(`triangle-down-fill`) · 排序 `triangle-sort`(升 `triangle-sort-ascending` / 降 `triangle-sort-descending`)
**表格/操作**:展开 `展开` · 收起 `收起-折叠` · 筛选 `filter`(`过滤-筛选`) · 搜索 `search` · 刷新 `refresh` · 上传 `upload-color`(多色) · 编辑 `edit` · 删除 `delete` · 复制 `copy` · 更多 `ellipsis-more` · 外链 `link-blank` · 扫描 `scan`
**通讯/系统**:通知 `notice` · 公告/喇叭 `horn` · 消息 `message` · 邮件 `email` · 电话 `telephone-1` · 客服 `customer-service` · 设置 `setting` · 权限 `permissions` · 锁 `lock`/`unlock` · 可见 `eye`/`eye-close`
> `-fill` = 实底版、`-r` = 圆角版、`-2/3/4` = 同名变体;状态/趋势用单色版(随语义色),多色版仅固定品牌场景。

---

## 场景 → lucide 语义映射(STO 无对应图标时的兜底 / 语义参考)
**业务**:业务量/订单 `activity`/`package` · 物流/运输 `truck` · 时效 `clock`(截止 `timer`)· 网点/区域 `map-pin` · 用户 `users` · 金额 `wallet`/`banknote` · 占比 `pie-chart` · 排名 `hash`
**状态**:成功 `check-circle`(success)· 失败 `x-circle`(danger)· 警告 `alert-triangle`(warning)· 信息 `info`(tertiary)· 中性 `circle`/`minus`
**趋势**:`trending-up` / `trending-down` / `minus`——**颜色由语义定不写死**
**表格**:排序 `chevrons-up-down` · 展开 `chevron-down` · 外链 `arrow-up-right` · 筛选 `filter` · 导出 `download`

---

## 内联 SVG(生产首选,零依赖、随 currentColor/字号缩放)
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round"
     style="width:1em;height:1em;vertical-align:-0.125em">
  <!-- path -->
</svg>
```
常用 path:
```
trending-up:   M22 7l-8.5 8.5-5-5L2 17  /  M16 7h6v6
trending-down: M22 17l-8.5-8.5-5 5L2 7  /  M16 17h6v-6
minus:         M5 12h14
check-circle:  circle cx12 cy12 r10  /  m9 12 2 2 4-4
x-circle:      circle cx12 cy12 r10  /  m15 9-6 6  /  m9 9 6 6
alert-triangle:M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z / M12 9v4 / M12 17h.01
activity:      M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.5.5 0 0 1-.96 0L9.68 2.18a.5.5 0 0 0-.96 0l-2.35 8.36A2 2 0 0 1 4.44 12H2
clock:         circle cx12 cy12 r10 / polyline 12 6 12 12 16 14
arrow-up-right:M7 7h10v10 / M7 17 17 7
chevron-down:  m6 9 6 6 6-6
```
原型可用 CDN:`<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>` + `<i data-lucide="trending-up">` + `lucide.createIcons()`。

---

## 尺寸 & 对齐
- **★铁律:每个内联图标 `<svg>` 必须自带尺寸——`<svg width="14" height="14">` 或内联 `style="width:1em;height:1em"`,二选一。绝不能只靠外部 CSS 类(如 `.diag-ic svg{...}`)兜尺寸。** 为什么:只写 `viewBox`、不写宽高的 svg,一旦配套 CSS 被漏写/截断(跨 agent 复刻金标准时高频发生),浏览器按父容器 100% 宽渲染 → 单个图标吃满全屏(「巨型铃铛」翻车)。base.md 的 `svg:not([width])` 安全网是最后兜底,但**正确做法是源头就把宽高写在 svg 上**,不依赖兜底。自检:`grep '<svg' 产物.html | grep -v -E 'width=|style="[^"]*width'` 应为空(图表满宽 svg 用 `width="100%"` 也算合规)。
- 用 em 跟随字号:表格/正文 inline `1em`、卡片 hero 16-20px、KPI 大标签 24-28px
- 行内对齐:`width:1em;height:1em;vertical-align:-0.125em`;icon+文字 `inline-flex; gap:0.4em`
- stroke-width 配字重:400-500→1.5,600-700→2,粗标题→2.5

## 色彩
- `stroke="currentColor"`,颜色由父 `color` 控制;状态用 `<span style="color:var(--color-danger)">`
- 单色图标不写死 hex/oklch(用 currentColor 随父 `color`);**数据报表正文 / 状态位 / 表格一律单色**(承载好坏靠语义色,不靠多色 icon)。**多色图标(sto-icons 多色区 28 个:GPT/help-color/notice 等品牌色)仅限固定品牌场景**(如功能入口/品牌标识),**不撒进数据表、状态列、趋势位**。禁渐变 stroke、icon 阴影/发光

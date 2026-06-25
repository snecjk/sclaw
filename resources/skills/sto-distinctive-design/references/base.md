# Base —— 第一版默认视觉基线(锁定)

> 铁律在 SKILL.md 文末。这里是**第一版直接套用的底座**:一套被验证过的、高级且克制的 token。
> 目的:让模型**第一版就高级**,不必靠用户反复迭代;也不靠模型从零自由发挥(那会滑向平庸/均值回归)。
> **锁的是底座(字体/中性色/圆角/数字/间距/出血)的一致与质感;不锁表达层**——强调色、图表、节奏仍按第一、二步的"角度"自由决定。

---

## 怎么用
1. **第一版默认直接粘贴下面的 `:root` + body 基线 + 动效 scaffold**,改都不用改——**scaffold 已含入场/scroll-reveal/hover/无障碍兜底,套了就有动效,别再交静态页**(SKILL.md 门槛 6 默认必须)。
2. **强调色默认就是申通橙 `--brand:#ff6700`(已在基线里),别再去 color.md 另选**——它是 STO 系统强调色,落在固定职位(进度条 / 关键指标列 / 卡片趋势图,见上注释),`--accent` 保持冷灰近黑做结构。STO 官方组件画法(进度条·状态药丸·红圈排名·折角·多级表头·橙关键列)都在金标准 `example-sto.html` 里,直接对照抄。
3. **每个模块(标题 + 内容)整体包进白底面板 `.mod`**——灰底 `--bg` 上铺白面 = STO 看板基本骨架,默认必做。别把卡/表直接裸铺灰底;白面里的内层白卡/白表转 `transparent` 只留描边(避免白套白)。CSS 已内置在下面基线里。
4. 再按角度调图表、密度、节奏。
5. 间距/出血严格按 [density.md](density.md)「固定间距规格」——base 已内置那套值。

> ⚠ base 不是模板:它只锁底座 token 和间距出血。版面结构、角度、图表选型、强调用法,仍由前几步决定。**别把它当成"日报 = 这个长相"套死。**

---

## 锁定 token(直接复制)
```css
:root{
  /* ===== 默认色系 = 申通 / STO 官方 v3.0(owner 定为默认)。冷灰页底 + 申通橙唯一克制强调 ===== */
  --bg:        #f5f7fa;             /* 页底:冷灰(非纯白,已满足"禁纯 #fff") */
  --surface:   #ffffff;            /* 卡片 / 表体 */
  --surface-2: #eef1f6;            /* surface-soft:模块行 / 标签底 / hover / foot(比页底略深) */
  --th:        #f5f6f7;            /* 表头底:中性浅灰(比 surface-2 浅、比 zebra 深) */
  --border:    #e5e6eb;            /* 描边:表格分隔 / 输入框边 */
  --border-2:  #eef0f3;            /* hairline-soft */
  --text:      #1d2129;            /* 主文本(只用官方三档,别自创灰) */
  --text-2:    #4e5969;
  --text-3:    #86909c;
  --neutral:   #4e5969;            /* 中性强调(非状态) */

  /* STO 官方功能色:成功绿 / 警告黄 / 危险红(各带浅底)。降噪为主,强化只留单异常主角 */
  --success:   #00b54b; --success-bg:#e6ffea;
  --warning:   #faad14; --warning-bg:#fffbe6;
  --danger:    #fa3c3c; --danger-bg:#fff2f0;

  /* 强调:结构色 = 冷灰近黑(分节条/结构);申通橙 = STO 系统强调色(有固定职位,见下) */
  --accent:    #1d2129;            /* 分节条 / 结构(刻意不是橙) */
  --brand:     #ff6700;            /* 申通橙:hover #ff852e / active #d24d00 */
  --brand-bg:  #fff3eb;            /* 申通橙淡底(选中卡 / 标签底) */
  --trend:     #ff6700;            /* 关键 sparkline 亮点色(申通橙,非语义,不随好坏变色) */
  --info:      #005be5;            /* 辅助蓝:图表对比/进度条第二色(STO 第二色,不与橙同屏抢焦点)。★不作链接色——链接/次操作/下载用 --brand 橙 */
  /* ★申通橙的"固定职位"(STO 官方画法,照 example-sto.html):① 卡片里的趋势 sparkline/面积图(主指标卡的"近7日趋势") ② 明细表的"一个关键指标列"数值(如当日值,其余列中性) ③ 进度条填充(用进度条卡变体时)。
     这是系统化一致用色,不算"铺满";要避免的是:橙撒在装饰条/随机边框/每一列。明细表趋势列仍走中性灰,不与关键值列同抢橙。 */

  --radius: 12px;                        /* 报表主用大卡 12;官方四档 标签4/按钮6/小容器8/大卡12,圆角不混用 */
  --font: 'PingFang SC','Source Han Sans SC','Microsoft YaHei',system-ui,sans-serif;
  --num:  'D-DIN','DIN Alternate','Bahnschrift','PingFang SC',ui-monospace,monospace;  /* STO 纯数字。'D-DIN'=内联自托管 woff2(见下「字体加载」),Mac/Windows/全平台一致;后面是降级兜底 */

  /* 动效 token(默认就有动效,别留静态。详见 motion.md) */
  --ease:    cubic-bezier(0.16, 1, 0.3, 1);  /* 快进慢停 */
  --dur:     0.42s;                            /* 入场时长 */
  --stagger: 0.05s;                            /* 逐档步进 */
  --hover:   160ms;                            /* hover/状态微过渡 */
}
*{box-sizing:border-box;margin:0;padding:0}
/* 图标 SVG 安全网(必带·别删)——内联 <svg> 若只有 viewBox、没 width/height,
   且没有任何 CSS 命中它,浏览器默认按父容器 100% 宽渲染 → 单个图标吃满全屏(经典「巨型铃铛」翻车)。
   这条只在「svg 自身没写 width 属性」时兜底成 1em(≈正文字号),低特异度(0,1,1),
   任何 `.x svg{width:..}`(0,2,0)都能覆盖它 → 正常排版零影响,只在配套 CSS 被漏掉时阻止炸全屏。
   图表类用 width="100%" 的 svg 自带 width 属性,不受影响。 */
svg:not([width]){width:1em;height:1em}
body{
  background:var(--bg); color:var(--text);
  font-family:var(--font); font-size:12px; line-height:1.5; font-weight:500;  /* STO 默认正文 12px/字重 500;对比仍用 400(次要)/600(强调),不是全页 500。精确值以 example-sto.html 为准 */
  font-feature-settings:'tnum' 1; -webkit-font-smoothing:antialiased;
  padding:16px clamp(12px,1.6vw,24px) 24px;   /* 曝光优先:四周收紧、满宽不居中、无 max-width(纯叙事长文放宽到 26/clamp16-48/44,见 density.md) */
}
.num{font-family:var(--num); font-variant-numeric:tabular-nums}
.t-display{font-size:clamp(48px,6vw,72px); font-weight:700; line-height:1; letter-spacing:-0.02em; font-variant-numeric:tabular-nums}  /* 签名时刻/展示级落差,只用在一处 */

/* ===== 模块白底面板 .mod(默认必做·灰底看板基本骨架)——每个模块的「标题 + 内容」整体包一张白面 =====
   作用域:所有灰底(--bg)数据/看板产物。灰底页直接裸铺卡/表 = 弱模型最高频翻车,这条专治。
   白底↔内容 = padding 16(四周统一);面板之间 = margin-top 12;面板内标题↔内容仍 8(.mod>.sec 去顶距)。
   ★白套白禁令:内层原带白底的表/卡(.sto-table-wrap / .rank / .barlist 等)放进面板后改 background:transparent 只留描边;指标卡用灰底分层(.sto-greycard #FAFBFC)。 */
.mod{ background:var(--surface); border-radius:var(--radius); padding:16px; margin-top:12px; }
.mod > .sec{ margin-top:0; }                 /* 模块标题进白面,去顶部外距(底距 8px 仍保留) */
.mod .sto-table-wrap,.mod .rank,.mod table{ background:transparent; }   /* 白面承托,内层透明,避免白套白发平 */

/* ===== 表格竖向分割线(默认必做·无条件)：每列之间都有一条竖线,不靠 nth-child 手算列号 =====
   作用域:所有 <table>(单层表头 / 多级表头 / 任意列数都生效)。这是 owner 硬性要求,弱模型最爱漏的就是这条。 */
table{ border-collapse:collapse; }
th,td{ border-right:1px solid var(--border); }      /* ★每列右侧一条竖线 = 全表竖向网格 */
tr > th:last-child, tr > td:last-child{ border-right:0; }   /* 表格最右缘不留外框线(禁框中框) */

/* ===== 动效 scaffold(默认就有,且要"被感知到"——别交静态页 / 别若有若无)===== */
/* 入场级联:给区块/卡加 .reveal,再加 .d1..dN 排延迟 */
@keyframes fadeUp{ from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:none} }
.reveal{ animation:fadeUp var(--dur) var(--ease) both; }
.d1{animation-delay:.05s}.d2{animation-delay:.10s}.d3{animation-delay:.15s}.d4{animation-delay:.20s}
.d5{animation-delay:.25s}.d6{animation-delay:.30s}.d7{animation-delay:.35s}.d8{animation-delay:.40s}
/* ★签名级入场(结论卡/主数值用,一页只一处):位移明显加大 + 时长拉长 + 逐张错峰 = 存在感来源 */
@keyframes signIn{ from{opacity:0; transform:translateY(22px)} to{opacity:1; transform:none} }
.reveal-sign{ animation:signIn calc(var(--dur) + .18s) var(--ease) both; }
/* 结论卡逐张"发牌":父级加 .deal,JS 给每张排 +120ms;或手写 .d1..dN 步进 ~120ms */
/* scroll-reveal:首屏之下的元素加 .reveal 时初始隐藏,进视口由 JS 加 .in 触发(见下) */
.io-hidden{ opacity:0; transform:translateY(14px); }
.io-hidden.in{ opacity:1; transform:none; transition:opacity var(--dur) var(--ease), transform var(--dur) var(--ease); }
/* hover 反馈:卡片抬升加大(更明显)、表行高亮、可点击元素按下 */
.card,.kpi-card{ transition:transform var(--hover) var(--ease), box-shadow var(--hover) var(--ease); }
.card:hover,.kpi-card:hover{ transform:translateY(-3px); box-shadow:0 6px 20px oklch(40% .03 245 / .10); }
tbody tr{ transition:background var(--hover) var(--ease); }
button,.clickable{ transition:transform var(--hover) var(--ease); }
button:active,.clickable:active{ transform:translateY(1px); }
/* ★签名级数据动效:重点 sparkline 画线入场(左→右描出)。容器 .draw-spark,线 .spark-line,面积 .spark-area */
.draw-spark .spark-line{ stroke-dasharray:var(--len); stroke-dashoffset:var(--len); }
.draw-spark.drawn .spark-line{ stroke-dashoffset:0; transition:stroke-dashoffset .9s var(--ease); }
.draw-spark .spark-area{ opacity:0; transition:opacity .6s ease; }  .draw-spark.drawn .spark-area{ opacity:.14; }
.draw-spark .spark-dot{ opacity:0; transition:opacity .3s ease; }   .draw-spark.drawn .spark-dot{ opacity:1; }
/* 无障碍兜底(必须有) */
@media (prefers-reduced-motion: reduce){
  *{ animation-duration:.01ms!important; animation-iteration-count:1!important;
     transition-duration:.01ms!important; scroll-behavior:auto!important; }
  .draw-spark .spark-line{ stroke-dashoffset:0!important } .draw-spark .spark-area{ opacity:.14!important } .draw-spark .spark-dot{ opacity:1!important }
}
```
首屏之下挂 scroll-reveal,结论卡逐张发牌,重点 sparkline 画线(都只播一次):
```html
<script>
const io=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}})},{threshold:.12});
document.querySelectorAll('.io-hidden').forEach(el=>{ if(el.getBoundingClientRect().top>innerHeight) io.observe(el); else el.classList.add('in'); });
// 结论卡逐张发牌(签名区):每张 +120ms
document.querySelectorAll('.deal > *').forEach((el,i)=>{ el.classList.add('reveal-sign'); el.style.animationDelay=(.12+i*.12)+'s'; });
// 重点 sparkline 画线:注入路径长 + 错峰触发(只给前台 3–6 条重点线加 .draw-spark)
document.querySelectorAll('.draw-spark').forEach((el,i)=>{ const ln=el.querySelector('.spark-line');
  if(!ln) return; el.style.setProperty('--len', Math.ceil(ln.getTotalLength())||120);
  setTimeout(()=>el.classList.add('drawn'), 260+i*130); });
</script>
```
- 首屏区块/卡:加 `class="reveal d1"`(d1..dN 排 stagger);**结论块/主数值用 `reveal-sign`**(签名级,更明显);结论卡组父级加 `class="deal"` 让 JS 逐张发牌。
- 首屏之下的区块:加 `class="io-hidden"`,进视口才揭示(上面的 JS 自动处理)。
- **重点 sparkline 画线**:给前台 3–6 条重点趋势的容器加 `class="draw-spark"`、线加 `spark-line`、面积加 `spark-area`、末点加 `spark-dot`,JS 自动注入路径长并错峰描出。**明细表 30+ 条趋势不逐条画线**(满屏乱动),随表块淡入即可(详见 motion.md)。
- 这套是**默认必须**(SKILL.md 门槛 6):套了 base 就有"被感知到"的动效,别再交静态页、也别留若有若无的弱入场。

字体加载:
- **数字(DIN)→ 必做内联自托管,保证 Windows/全平台一致**。原生 `DIN Alternate` 只有 Apple 端有,Windows 会降级成 Bahnschrift/雅黑,数字立刻"露馅"。做法:把 [`fonts/sto-din-face.html`](fonts/sto-din-face.html) 整段 `<style>`(内联 base64 的 D-DIN Regular/Bold,SIL OFL,仅 ASCII 子集约 17KB)**原样复制进每份报告的 `<head>`**,`--num` 栈已把 `'D-DIN'` 置首即可生效。字重映射:500→Regular(400)、600→Bold(700)。**别手敲那串 base64**——只能整段复制,要么内联、要么把 `fonts/sto-din-*.woff2` 一起带上改 `url()` 相对路径(单文件分享首选内联)。
- **中文正文(PingFang SC)→ 不内联,按 `--font` 栈降级**。真 PingFang 是 Apple 专有字体不能外发、整字库又有几 MB,得不偿失;Windows 走 `Microsoft YaHei`(每台都有、质感够用),正文中英差异肉眼很小。STO 默认不引外链字体。

## 锁定字阶(三档拉开,别挤一起 —— 精确值以金标准 example-sto.html 为准,本表是摘要)
| 用途 | 字号 / 字重 |
|---|---|
| 辅助 / 脚注 `.t-xs` | 10px / 400,色 `--text-3` |
| 次级 / 小字 `.t-sm` | 11px / 400,色 `--text-2/3` |
| 正文 / 表格 | 12px / 500(表头 14px) |
| 分节标题 `.sec` | 15px / 600(申通橙竖条) |
| 平权网格卡片大数 `.t-big` | 28px / 600,line-height 1 |
| 签名 masthead `h1` | 28px / 600,line-height 1.05 |
| **展示级 / 签名时刻 `.t-display`** | **48–72px / 600–700,line-height 1.0,`tnum`**(仅"有主角"时用;STO 平权日报不用,顶到 28px 为止) |
- **★ `.t-display` 是出彩门槛 1 的载体**:仅当第一步①判定"有主角"时,用它把"巨大 vs 极小"的落差做出来——核心 ≥ 正文 3 倍。**STO 平权数据报告不立 hero**:众多指标统一用 28px 的 `.t-big`(masthead h1 同档 28px),靠"分布式一致强调 + 紧密度"立住,不是每个数都放大、也不上 `.t-display`。
- 数字一律 `--num` + `tnum`,小数点对齐。
- 同一行字重 ≤2 种;主对比 450/600,**禁全页 500**。
- 换行 polish:标题 `text-wrap: balance`(避免末行孤字)、正文段落 `text-wrap: pretty`(避免段尾孤字)。

## 锁定间距 / 出血
间距 / 出血的**唯一权威 = [density.md](density.md)「固定间距规格」表 + CSS 片段**(body padding、`.sec` 上下、`h1` 下、卡 gap、卡 padding、表行、"标题下间距 ≤ 上间距一半"、纯叙事松值切档——全在那张表)。**本文件不再复述这些数值,免得两地不同步**;base 的 `:root` + body 基线已内置该表的值,直接套即可。

---

## 高级感的方向(视觉气质,不是硬 token)
> 参考方向:getdesign.md 的 Airtable design.md(https://getdesign.md/airtable/design-md)——**结构化的数据美学**:克制、精致、编辑感,而非花哨。把"高级"落到下面这些可操作的取向上(它们和 SKILL.md 第三步「出彩 ≠ 用色多」一致):
- **结构先行**:高级感主要来自**对齐、留白节奏、信息层级**,不是颜色或特效。灰度下还成立,才是真高级(见 SKILL.md 第三步灰度测试)。
- **克制的精致**:边框/分隔线细(1px 半透明黑)、圆角统一一档、阴影极轻或无;靠**留白和对齐**分组,而不是靠重色块和重投影。
- **编辑感的字**:字阶拉开档(主-次-辅三档明确落差)、等宽数字小数点对齐、标题 `text-wrap:balance`;一行字重 ≤2 种。
- **色是最后 20%**:大面积中性底 + 一个克制精准的强调色点(每屏 ≤2 处),语义色只在表达状态时出现。**禁靠多色/渐变/玻璃化堆"高级"**——那是用力过猛的另一种 AI 味。
- **数据是主角**:结构化数据界面的高级,体现在"让数据本身清晰、可比、可扫读",装饰为数据让路,不是数据为装饰让路。

> ⚠ 这是**方向**不是模板:别去抄 Airtable 的具体配色(它偏 colorful/friendly,本 skill 默认更克制)。取的是它"结构化、克制、为数据服务"的气质,不是它的色板。
- **该不该有主角 / 平权**(第一步①)——base 不预设 hero。
- **角度**(第二步)——base 不替你选编排角度。
- **强调色具体取哪个、图表选型**——base 只留 `--accent` 插槽和中性底座。
- **报告类结论先行 + 客观、同一数据全文 ≤2 次跨层**——底线全文在 [conclusion-layer.md](conclusion-layer.md),base 不放松(此处不复述,以该文件为准)。

# Motion —— 动效边界(交互式网页优先,适度增强)

> 铁律在 SKILL.md 文末。**v4 起,本 skill 默认产物是「可交互的网页」,不再默认「静态截图/PDF」。**
> 所以动效从"近乎零"改为"适度增强":入场有节奏、滚动有揭示、hover 有反馈——但仍是**克制的增强**,不是炫技。
> 值取自 Motion 库默认与 frontend-ui-animator 的工程实践,以及两个被验证过的参考实现(stagger 入场级联)。

---

## 默认:必须有,且做出"存在感"(交互式网页)
> v4 起这是**默认必须**,不是"可以"(SKILL.md 门槛 6 + 地板)。base.md 已内置 scaffold,套了就有;**交静态零动效页 = 没完成**。
- **入场有节奏**:首屏区块/卡片逐档 stagger fade-up 进入。
- **★签名级入场(更明显的存在感)**:**结论块 / 主数值**给一个比其余略大略慢一档的入场(位移 16px、时长 +0.1s 左右),让动效**被感知到**,而不是若有若无。一页只 1 处签名级,其余走普通 stagger(疏密对比,呼应"签名时刻")。
- **滚动有揭示**:首屏之下的区块用 scroll-reveal(进入视口才 fade-up),让长报告读起来有节奏。
- **hover/状态有反馈**:卡片 hover 轻抬 `translateY(-2px)` + 轻阴影(明显但不浮夸)、表格行高亮、可点击元素按下 `translateY(1px)`。
- **仍然克制**:"更明显" ≠ 满屏乱动 / 回弹炫技。一份报告的动效应当**统一一套缓动 + 统一一档时长 + 统一一个 stagger 步进**,看起来"被同一个人调过";存在感来自"签名级那一处 + 干净的快进慢停",不是到处弹。

> ⚠ **截图/PDF 交付仍是合法的次要场景。** 若用户明确说"这份是要截图/导出 PDF 的",退回克制:关掉入场与 scroll-reveal,只留 hover 与状态过渡(入场动效在静态导出时是负担)。**默认按交互式网页做;只有用户点名截图交付才退回。**

---

## 入场级联(stagger)—— v4 放开,照这套做
参考两个验证实现的做法:`transform: translateY(12px)+opacity:0 → 0`,逐档递增 delay。**统一一套,别每块自定义。**
```css
:root{ --ease: cubic-bezier(0.16, 1, 0.3, 1); --dur: 0.4s; --stagger: 0.04s; }
@keyframes fadeUp   { from{opacity:0; transform:translateY(12px)} to{opacity:1; transform:none} }
@keyframes fadeRight{ from{opacity:0; transform:translateX(-8px)} to{opacity:1; transform:none} }
.reveal-up   { animation: fadeUp    var(--dur) var(--ease) both; }
.reveal-right{ animation: fadeRight calc(var(--dur) * .9) var(--ease) both; }
/* 逐档延迟:用 nth-child 或 .d1..dN 类,步进 ~40ms,封顶 ~12 档(再多眼睛跟不上) */
.d1{animation-delay:.04s} .d2{animation-delay:.08s} .d3{animation-delay:.12s} .d4{animation-delay:.16s}
.d5{animation-delay:.20s} .d6{animation-delay:.24s} .d7{animation-delay:.28s} .d8{animation-delay:.32s}
```
- stagger 步进 **30–60ms**;一组超过 ~12 个元素就**别逐个 stagger**(改整组一次进入),否则最后几个等太久。
- 入场只走 **fade + 轻微位移(≤16px)**;禁大幅位移、禁旋转/缩放炫技入场。

## 滚动揭示(scroll-reveal)—— 首屏之下用
```js
const io = new IntersectionObserver((es)=>{es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} })},{threshold:.12});
document.querySelectorAll('.reveal-up,.reveal-right').forEach(el=>{ if(el.getBoundingClientRect().top>window.innerHeight) io.observe(el); });
```
首屏内的元素直接播入场动画;首屏之下的挂 observer,进视口才播。**只播一次**(`unobserve`),别反复进出反复动。

## 标准值(全文统一这套)
| 用途 | 值 |
|---|---|
| 标准缓动 | `cubic-bezier(0.16, 1, 0.3, 1)`(快进慢停,参考实现用值) |
| 功能过渡缓动 | `cubic-bezier(0.2, 0, 0, 1)` 亦可 |
| 入场动画时长 | `0.35–0.5s` |
| hover / 状态微过渡 | `120–200ms` |
| 较大过渡上限 | `400ms`(超过显拖沓) |
| stagger 步进 | `30–60ms`,封顶 ~12 档 |
| 按钮按下(可点击元素) | `transform: translateY(1px)` 或 `scale(0.97)`,不低于 `0.95` |

## 工程铁规(性能 + 可控)—— 这些**没**放松
- **只动 `transform`(x/y/scale)+ `opacity`(+ 必要时 `filter`)**(GPU、不触发重排);**禁动 `width/height/top/left/margin`** 做动画。
- **`transition-property` 写具体属性,禁 `transition: all`**(会动到不该动的,性能差且不可控)。
- **`will-change` 只给 `transform/opacity/filter`,禁 `will-change: all`**。
- 入场/一次性动画用 `@keyframes` + `animation: ... both`(`both` 保留首帧,防闪);可打断的状态变化用 CSS `transition`。
- **数字用 `tabular-nums`** 防变化时跳动(base.md 已锁)。
- **仍禁回弹/过冲**:`bounce>0` / `backOut` / `anticipate` 不用——增强是"快进慢停的干净进入",不是 Q 弹。
- **count-up 数字滚动默认仍不做**(信息价值低、可读性差);确有叙事必要(单焦点页/年度回顾)才用,且 ≤800ms、`tabular-nums` 防跳。
- **★sparkline 画线入场 = 认可的"签名级数据动效"**(owner 实测要的存在感来源):核心结论卡的趋势线用 `stroke-dasharray=getTotalLength()` + `stroke-dashoffset` 从满长 → 0 描出来(.8–.9s、标准缓动),面积 `opacity` 淡入、末点最后 pop;**错峰跟随卡片入场**(每卡 +~130ms)。这是 `stroke-dashoffset` 的**唯一豁免**(它不触发重排、GPU 友好,等价于一次性入场)。**只给前台少量重点 sparkline(结论卡 3–6 条)画线**;明细表 30+ 条趋势**不逐条画线**(满屏乱动),随表块一次淡入即可。reduced-motion 下直接显终态。

## 无障碍(底线,必须有)
```css
@media (prefers-reduced-motion: reduce){
  *{ animation-duration:.01ms!important; animation-iteration-count:1!important;
     transition-duration:.01ms!important; scroll-behavior:auto!important; }
}
```

## 可检验失败定义(v4 更新)
- 用了 `transition: all` 或 `will-change: all` = 违规。
- 拿 `width/height/top` 等**布局属性**做动画 = 违规(触发重排、卡顿)。
- 出现**回弹/过冲**(`backOut` / `anticipate` / `bounce>0`)= 违规。
- 缺 `prefers-reduced-motion` 兜底 = 违规。
- 一组 >12 个元素仍逐个 stagger,导致末尾元素等待 >0.5s 才进入 = 违规(改整组一次进入)。
- 入场用大幅位移(>16px)/ 旋转 / 缩放炫技 = 违规。
- 全页动效缓动/时长/步进各不相同、看不出"被同一套参数调过" = 违规。

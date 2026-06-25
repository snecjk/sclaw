# Charts

> 铁律在 SKILL.md 文末。优先 ECharts CDN,简单场景用 CSS/SVG。

> **★STO 默认风格:直接调用 STO 图表组件库 [sto-charts.html](sto-charts.html)(自包含 SVG 组件,遵循 STO 图表色板)。** 复制其 `<style>` + `<script>` 两块进报告,调 `stoLine/stoArea/stoColumn/stoBar/stoDonut/stoRadar/stoBubble/stoTooltip(挂载点,数据)`;或抄渲染出的静态 SVG。配色硬约束:**前两系列已对齐品牌——单色优先申通橙 `#FF6700`(橙过多改辅助蓝 `#005BE5`)**,绿/黄/紫等分类色保留图表色板;多系列按序 橙→蓝→绿→黄→紫→红→黄绿;折线/面积橙线·对比蓝线,条形蓝优先,组合图橙线+蓝柱;禁色板外颜色、禁跳配色顺序。(★橙统一用品牌 `#FF6700`,与 KPI/表格关键列同橙,别再出现图表专用的 `#FF7D33` 另一种橙。)选型:趋势→折线/面积·分类对比→柱·排名→条形·占比≤6→环形·多维→雷达·三维→气泡。**报告内嵌的微型 sparkline 仍按本文下方规则(单色不画图例);需要带轴/图例/tooltip 的完整图表时用 sto-charts。**

## 什么时候可视化,什么时候不可视化(可读性是前提)

> **铁律:看不清的图 = 比没有更糟。** 挤到读不出形状的 sparkline 不是信息,是噪声。给 30 个指标每个都塞一条迷你线 = **无脑可视化,视觉完全不可读**——这是要避免的头号失败,不是"图多就好"。

判断"这个指标该不该配图",过**两道闸,两道都过才配**:

**闸 1 · 形状有没有信息?(值不值得画)**
- ✅ 配图:趋势的**形状本身**带决策信息——波动 / 加速 / 突刺 / 回落 / 拐点,是"单个数字 + 环比箭头"表达不了的。
- ❌ 不配:① 单时点值 / 比率 / 计数 / 排名(今天 2.26%、第 1 名)——没有序列;② 序列缺失或 <3 点;③ 方向已被"环比 ↑/↓ x%"完整说清,再加 sparkline 是**冗余装饰**。

**闸 2 · 有没有空间画到能读?(画得清吗)**
- 一条 sparkline 至少要 ~80×28px 才看得出形状;塞不下就别塞,**把数字做大反而更清楚**。
- **指标一多(>8 个)就别散成"每张卡一条迷你线"**——几十张微图一起糊眼,一条都读不出(见反面案例:33 项全做成 sparkline 卡)。改用下面的"分层"。

> ⚖ **别把两道闸读成"尽量别画"——这是分寸,不是开关,两个极端都错。** 闸子只挡两种翻车:(a) 几十张微图糊眼、(b) 给无序列数据硬塞图。**对有真实时间序列的核心指标(业务量、揽收量、有偿派件、达成率、时效等逐日/逐月数据),默认就该各自配一张能读的 sparkline**——它们正是"形状有信息 + 有空间画清"的典型,该画。**别因为"要保留口径"或"怕无脑可视化"就把这类核心卡退成纯文字。**
> **一张核心指标卡的标准构成 = 标签 + 数字 + 环比/方向 + sparkline + 口径小字注,五者共存**(不是"画图"和"留文字描述"二选一)。揽收量、有偿派件各有各的序列 → **各画各的 sparkline**(它们不是构成关系,别合并);占比/构成才合并成一张占比图。

### 多指标的正确分层(不是平铺几十张微图,也不是丢掉一部分)
一份 20-30+ 项的大盘,**不要**把每项都做成带图的卡。分三层:
1. **关键指标 3-6 个** → 卡片 + 能读的图(趋势/达成),形状值得看的才给图。
2. **其余常规指标** → **一张密集表格**,趋势走**一列对齐的 sparkline**(对齐成列才扫得动、可比;这是小 sparkline 唯一真正可读的场合),或只留数字 + 环比箭头。
3. **真正的异常/焦点序列** → 1-3 张**独立大图**(≤320px)放大看形状。

> ⚠ **分层 ≠ 丢数据。** "挑 3-6 个做卡"只是决定谁放大,**第 2 层的"其余"必须是源数据里剩下的全部指标,一项不少地进表格**。绝不能因为某项没进卡片就把它从产物里删掉,也不能把两个不同口径(如"揽收量"和"有偿派件量")并成一张卡只显示一个。源有 N 项,产物可数指标必须 = N(地板硬规则)。

**一句话:可视化 = 挑出"值得看形状"的少数、给够空间画清楚;不是每个数字旁边都挂条线。** 真正的 AI 反射有两种——一种是"全用默认蓝/全柱状/彩虹配色",另一种就是这种"无脑给所有卡配微图"。两种都要躲。

---

## 引入
```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<!-- 地图额外: -->
<script src="https://cdn.jsdelivr.net/npm/echarts@5/map/js/china.js"></script>
```

## 图表类型选择:先判断"数据关系",再选图型(不是一种卡套到底)

**决定图型的是数据的关系,不是"它在卡片里"。** 同样几个百分比,是"各自对目标的完成度"还是"彼此构成一个整体",该用完全不同的图。**最常见的错:把"占比/构成"硬塞进卡片 + 进度条**(见下"形式误用")。

| 数据关系(先判断这个) | 选什么 | 别用什么 |
|---|---|---|
| **单值 vs 目标/上限**(达成率 ≤100%、预算用量) | 进度条 / 环形进度 / 仪表盘 | — |
| **部分占整体**(几个类别加起来 ≈100%,如各投诉类型占比) | **一张**饼 / 环(≤5 块)/ **100% 堆叠条** | ❌ **N 张进度条卡**(拆开就丢了"占整体"的关系,且进度条语义=对目标的完成度,不是份额) |
| **随时间变化**(序列) | 折线 / 面积 sparkline | 饼图(饼不表达时间) |
| **类别比大小**(只是谁高谁低,非构成) | 横向条形(排序) | 饼图(比长度比角度准) |
| **排名** | 排序横向条 / 纯数字 | 折线 / 面积(名次画线误导) |
| **多组构成对比** | 堆叠柱 / 矩形树图 | 多个饼并排(难比) |
| **单时点值/比率**(无序列、不构成整体) | 纯数字(必要时 + 迷你 sparkline) | 硬塞趋势线 |
| 流程/漏斗→漏斗·桑基;地理→地图;多维→雷达;相关→散点;热力→热力·日历图 | | |

**形式误用(重点,用户实测翻车):**
- **占比/构成被拆成 N 张卡 + 进度条** = 双重错:① 拆成 N 张卡丢了"部分-整体"关系(看不到相对份额、看不到"其他/剩余"占多少);② 进度条语义是"对目标/上限的完成度",**不是"占整体的份额"**。
  → 正确:**一张环形/饼(≤5 块,小份额并入"其他")或一条 100% 堆叠条**,一眼看清谁大谁小、合计多少。例:投诉构成 服务体验 43.6% / 时效 18.9% / 价格 13.9% / 破损丢件 10.7% / 其他 → 一个环形,不是 4 张进度条卡。
- **判断口诀**:这些数字**加起来有意义(≈100% 或同一总量的切分)**→ 构成关系 → 一张占比图;**各自独立、各有各的目标**→ 才是单值达成 → 各自进度条。

**单序列强调趋势 → 优先面积图:**
```js
series:[{ type:'line', smooth:true, areaStyle:{opacity:0.18}, lineStyle:{width:1.5}, symbol:'none' }]
```

## 复杂图表骨架
```js
// 地图
geo:{map:'china',roam:false}, series:[{type:'map',map:'china',data:[...],visualMap:{min:0,max:1000,calculable:true}}]
// 漏斗
series:[{type:'funnel',data:[...],sort:'descending'}]
// 仪表盘
series:[{type:'gauge',progress:{show:true},data:[{value:75,name:'达成率'}]}]
// 桑基
series:[{type:'sankey',data:nodes,links:links}]
// 环形进度
series:[{type:'pie',radius:['70%','90%'],data:[{value:75,name:'达成'},{value:25,name:'未达成',itemStyle:{color:'#eee'}}],label:{show:false}}]
```

## 配色(关键去 AI 味)
- **多序列优先单色调多深浅**,优于多色相
- ≤4 序列单色相多深浅;>4 邻近色相过渡
- 含语义(达成/异常)→ 语义色;中性维度(区域/月份)→ 顺序色阶
  - ⚠ **趋势 sparkline / 面积图例外:不按语义上色,统一单一非语义色**(STO 默认:关键卡橙 `--trend` / 明细表中性灰 `--text-3`,见下方"趋势图形统一非语义色")。本条"含语义→语义色"针对的是多序列/分类柱等,不含趋势线。
- **禁:ECharts 默认调色板(饱和过高、AI 重灾区)、7 色彩虹、红绿做非状态对比**

字体继承正文:
```js
echarts.registerTheme('custom',{textStyle:{fontFamily:'Geist,"PingFang SC",sans-serif'}});
echarts.init(el,'custom');
```

## 标签 / 尺寸
- 必有标题、单位、坐标轴单位独立行;legend 默认顶部/右侧
- **趋势优先做成行内 sparkline 塞进表/卡,用固定尺寸 inline SVG(72×22),不单开大图**;这是默认档,绝大多数趋势用它就够
- 独立图表(成块时)**高度封顶 ≤320px**,不甩 `responsive` 的大 canvas 竖向铺满整页(可检验失败定义:图表容器渲染高度 > 320px = 违规);仪表盘正方 ≤320;地图 16:9 或 4:3。多张独立图可成网格平铺
- **sparkline 一律用固定 SVG(60-80×20-32),不要用 Chart.js canvas 做表格趋势列**——`responsive:true` 的 canvas 会被表格单元格撑成超宽、趋势线拉扁、和别的列错位(这是"趋势列没对齐"的常见真凶)。饼图每页 ≤3,超过用堆叠柱替代

### sparkline(直接照抄,纯 SVG 无依赖)
默认占满容器宽:卡片里铺满底部一整行;表格趋势列用 `td.trend` 整列右对齐 + 定宽 96px。
```css
.spark{display:block;width:100%;height:28px;color:var(--accent)}            /* 卡片里占满整宽 */
.spark svg{display:block;width:100%;height:100%}
.spark path.area{fill:currentColor;opacity:.15} .spark path.line{fill:none;stroke:currentColor;stroke-width:1.4;vector-effect:non-scaling-stroke} .spark .dot{fill:currentColor}
th.trend,td.trend{text-align:right}                                        /* 表格趋势列右对齐 */
td.trend .spark{display:inline-block;width:96px;height:24px;vertical-align:middle}
```
```html
<td class="trend"><span class="spark" data-spark="1874252,1911031,1908563,1858471,1977952,2130810,2091516"></span></td>
<script>
document.querySelectorAll('.spark[data-spark]').forEach(el=>{
  const raw=el.dataset.spark.split(',').map(s=>{s=s.trim();return(s===''||s==='—')?null:+s;});
  const vals=raw.filter(v=>v!=null); if(vals.length<2){el.innerHTML='<span style="color:var(--text-3);font-size:11px">—</span>';return;}
  const w=100,h=28,pad=3,min=Math.min(...vals),max=Math.max(...vals),span=(max-min)||1;
  const X=i=>raw.length<2?0:(i/(raw.length-1))*w, Y=v=>h-pad-(v-min)/span*(h-2*pad);
  const first=raw.findIndex(v=>v!=null); let last=first; raw.forEach((v,i)=>{if(v!=null)last=i;});
  let d='',started=false; raw.forEach((v,i)=>{if(v==null)return; d+=(started?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)+' '; started=true;});
  const area=d+'L'+X(last).toFixed(1)+' '+h+' L'+X(first).toFixed(1)+' '+h+' Z';
  el.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><path class="area" d="'+area+'"/><path class="line" d="'+d+'" vector-effect="non-scaling-stroke"/><circle class="dot" cx="'+X(last).toFixed(1)+'" cy="'+Y(raw[last]).toFixed(1)+'" r="1.8" vector-effect="non-scaling-stroke"/></svg>';
});
</script>
```
**★趋势图形(sparkline / 面积图)一律用单一非语义色,禁按语义上色。** 趋势的"好坏"由**形状 + 旁边的方向箭头 ▲▼(那个才语义化上色)**表达,**线和面积本身不要时红时绿时蓝**——同一份报告里十几条 sparkline 各自一个颜色,是最刺眼的"没人统一过"的 AI 味。**STO 默认两档:关键结论卡的 3–6 条重点 sparkline 用申通橙 `--trend`(点睛),30+ 行明细表的趋势列用中性灰 `--text-3`(别让申通橙铺满整表)**——两处各自统一一个色,都不给单行覆盖 danger/success。
- 可检验失败定义:**同一份报告内 sparkline / 面积图出现两种以上不同色相(红、绿、蓝混用)= 违规;趋势图形按指标语义(投诉率涨就红)单独上色 = 违规。**
- 区分:**方向指示 ▲▼ / ↑↓ 箭头**仍按语义上色(该升的升=绿、该降的升=红),那是"方向编码"不是"趋势图形"。趋势图形=统一非语义色(STO 默认:关键卡橙、明细表灰),方向箭头=语义色,两者分工不混。

**配图选型别乱配(低端模型高频翻车):**
- **排名(第 N 名)禁用面积/折线 sparkline**——名次越小越好,线向下掉看着像下跌,方向误导。卡片里用纯数字(要趋势就写"较上期 ↑1 位");**表格趋势列里排名行就显示 `—`(留空占位)。⚠ 绝不能把"排名禁用趋势线"这条规则原话打印到单元格**——那是给你(模型)的判断依据,不是给用户看的内容。**任何 skill 规则/选型理由措辞都不上屏**(见 SKILL.md 地板)。
- **★环比/同比不是时间序列,禁据此画趋势线/面积图**:`环比 +4.87%` 是**一个对比值**,不是一条序列。**只有"值 + 环比"、手头没有真实的多点序列(≥3 个时点)时,绝不能画 sparkline/面积图**——画出来的线是编造的(你没有那些点)。这种情况用**方向指示**呈现:`▲ +4.87%` / `▼ -1.40%`(▲▼ 形态 + 语义色),把卡片右侧让给"目标/达成"等真实信息,或让卡片紧凑些。**只有该指标确实带一段日/周序列时才画趋势图。** 失败定义:**用单个环比/同比值"画"出一条趋势线/面积 = 编造数据 = 违规**。
- **达成率 >100% 或无固定上限禁用进度条**(会满格/溢出误导),用 sparkline 或纯数字;进度条只给"有上限、当前 ≤100%"的达成率。
- **卡片布局:图只挨着「数字」放,长 meta 移到下面整行**。**关键翻车(实测):把图和"数字 + 一长串 meta(环比·月累计·达成…)"放同一横排,长 meta 会把左栏撑宽,把固定尺寸的图挤出卡片、被 `overflow:hidden` 切在边框上(看着图贴边/出血)。** 正确结构:第一排 = 大数字(左) + 固定尺寸图(右);**那串长 meta 单独放数字下面一整行**,不和图抢宽。
  ```html
  <div class="card"><div class="t-xs">标签</div>
    <div class="card-row"><div class="t-big num">2,122,194<span class="unit">票</span></div>
      <span class="spark" data-spark="..."></span></div>
    <div class="t-sm">▲ +4.87% · 月累计 179.95 万 · 达成 104.0%</div>   <!-- 长 meta 在这,整行 -->
    <div class="cap">口径：…</div></div>
  ```
  ```css
  .card-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:6px}
  .card-row .t-big{min-width:0}
  .card-row .spark{flex:0 0 96px;width:96px;height:36px}   /* 固定,不 flex 填充;只和数字同排 */
  ```
  图固定 96px、卡片 min-width 给够(≥320px)且 `padding` 14–16px → 图永远在卡内、离边框有统一留白。**禁 `flex:1` 填充**(会让图宽随数字变、同模块大小不一、贴边框)。
- **★同模块卡片必须"一致":统一 gap、统一列模板、统一内边距、图统一固定尺寸、卡片等高。** 等高做法:`.cards{align-items:stretch}` + `.card{display:flex;flex-direction:column}`,把口径/脚注用 `margin-top:auto` 钉到卡底——这样有口径和没口径的卡也等高、底边对齐,行与行间距才看着齐。可检验失败定义:**同一模块内 sparkline 尺寸不一 = 违规;卡片内容(图/文)紧贴边框、无统一内边距 = 违规;同模块卡片高度参差导致行距视觉不齐 = 违规**。
  ```css
  .cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:stretch}
  .card{display:flex;flex-direction:column;padding:15px 16px 13px}
  .cap{margin-top:auto;padding-top:9px;border-top:1px solid var(--border-2)} /* 口径钉底,卡等高 */
  ```
- **内容与边框统一留白(铁规)**:卡片内任何元素(数字、文字、图、进度条)都不许贴边框,一律由卡片 `padding`(建议 14–16px)统一留白;固定尺寸的图天然不会撑到边框,`flex` 填充的图会——所以图用固定尺寸。

## 简单图表用 CSS/SVG(避免依赖)
| 图表 | 实现 |
|---|---|
| 单系列柱 ≤12 条 | CSS `width:%` |
| sparkline | SVG path |
| 进度条 | CSS `width:%`(3px 细,见 craft-moves 手法 8) |
| 环形进度 | SVG circle + stroke-dasharray |

```html
<svg width="72" height="24" viewBox="0 0 72 24">
  <path d="M0 18 L12 16 L24 14 L36 12 L48 8 L60 6 L72 4" fill="none" stroke="currentColor" stroke-width="1.5"/>
</svg>
```

## ★可视化形式要有变化:禁一种图型满屏重复(单调=另一种均值回归)
**一页里的可视化不该是同一种形式从头铺到尾。** 全 sparkline、全进度条、全环形、全同款卡——即使每张都"对",整页看下来也是单调的 AI 味(模型反射性地把一种图套到所有数据上)。**可视化的节奏来自"按数据关系选不同形式":** 趋势→sparkline/面积、占比构成→环/饼/100%堆叠条、达成→进度环、排名→排序横条、类别比大小→横向条形。不同关系的数据出现在同一页,就该看到**不同形式交替**,这本身是"被设计过"的证据。

- **判定要点(和平权不冲突,见下):** 这条管的是**形式多样**,不是**视觉等级**。平权要求所有指标"同尺寸、不立 hero",但**不要求"全用同一种图"**——同尺寸的卡里完全可以一张是趋势 spark、一张是占比环、一张是达成进度环。
- **何时同款重复是合法的:** 当一组数据**数据关系确实全相同**(如十几项都只有时间序列)且数量不多时,同款 sparkline 成网格是合理的(平权大盘场景);**但数量一多(>8)就别平铺同款微图**——按上面「多指标分层」收进**一列对齐 sparkline 的表格**或合并成一张图,而不是满屏铺几十张同款小图。
- **可检验失败定义:** ① 一页里有 **>8 个独立可视化却全是同一种图型**,而它们的数据关系**并不都相同**(本该按关系换形式)= 违规;② 不同数据关系(趋势 / 占比 / 排名 / 达成)被**强行统一成同一种图**(如把占比也画成 sparkline、把排名也画成进度条)= 违规(同时违反「图型按数据关系选」);③ 同款独立图(同尺寸同类型)在一页内大量堆砌满屏、未分层未合并 = 违规。

## 反射陷阱
- ECharts 默认蓝 + 渐变 + 圆角节点 = AI 反射
- 全是柱状图 = 缺类型选择
- 真正的反射是默认蓝/全柱状/彩虹配色,不是"图多";**平权大盘里同级小图成网格是合理的——但前提是这些数据关系确实相同(都只是时间序列)、数量不多**。数据关系不同却套同一种图、或同款微图满屏堆砌,仍是单调的反射(见上「可视化形式要有变化」)。

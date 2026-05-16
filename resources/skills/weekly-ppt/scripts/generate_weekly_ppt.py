import json
import os
import re
import subprocess
import sys
from datetime import datetime
from collections import OrderedDict

# ========== 配置 ==========

SLIDE_CONFIG = [
    {
        "id": 1,
        "title": "关键指标趋势",
        "num": "01",
        "data_queries": [
            "policyWeekPpt industryTdtMarketShare query --params '{}'",
            "policyWeekPpt keyMetricTrendVolume query --params '{}'",
            "policyWeekPpt keyMetricTrendShopCount query --params '{}'"
        ]
    },
    {
        "id": 2,
        "title": "过程目标达成",
        "num": "02",
        "data_queries": [
            "policyWeekPpt processTarget query --params '{}'"
        ]
    }
]

# ========== 通用样式 ==========

COMMON_CSS = """
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; background: #f5f5f5; }
.ppt-container { width: 1280px; margin: 0 auto; background: white; box-shadow: 0 2px 20px rgba(0,0,0,0.1); }
.slide { width: 1280px; height: 720px; padding: 16px 24px; display: flex; flex-direction: column; position: relative; }
.slide + .slide { border-top: 2px dashed #e0e0e0; }

/* 头部 */
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-shrink: 0; }
.title { font-size: 28px; font-weight: bold; }
.title .num { color: #ff6600; }
.title .text { color: #333; }
.logo { color: #ffccaa; font-size: 18px; font-weight: bold; }

/* 内容区 */
.container { display: flex; gap: 12px; align-items: stretch; flex: 1; min-height: 0; height: 100%; justify-content: center; }

/* 第一页三列布局 - 三列等分，内容自适应 */
.slide-3cols .container { justify-content: stretch; gap: 12px; padding: 0 15px; width: 100%; }
.slide-3cols .chart-column { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }

/* 表格包装器 */
.table-wrapper { flex: 1; overflow: visible; min-height: 0; height: 100%; }

/* 表格 */
table { width: 100%; border-collapse: collapse; font-size: 9px; height: 100%; }
thead { display: table-header-group; }
thead tr { background: linear-gradient(180deg, #ff8833 0%, #ff6600 100%); color: white; }
th { padding: 2px 2px; text-align: center; font-weight: bold; border: 1px solid #ff9955; font-size: 9px; white-space: nowrap; line-height: 1.2; }
tbody { display: table-row-group; }
tbody tr { height: auto; }
tbody tr:nth-child(even) { background: #fafafa; }
tbody tr:hover { background: #fff5ee; }
td { padding: 1px 2px; text-align: center; border: 1px solid #e0e0e0; font-size: 9px; white-space: nowrap; line-height: 1.2; }
.war-zone { background: #f0f0f0; font-weight: bold; text-align: center; vertical-align: middle; }
.negative { color: #cc0000; font-weight: bold; }
.positive { color: #00aa00; font-weight: bold; }

/* 趋势图 */
.trend { width: 100%; height: 16px; display: flex; align-items: center; justify-content: center; }
.trend svg { width: 50px; height: 16px; }

/* 侧边栏 */
.sidebar { width: 220px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px; flex-shrink: 0; height: 100%; }
.info-box { border: 2px dashed #ff9955; padding: 8px; border-radius: 8px; flex: 1; display: flex; flex-direction: column; justify-content: center; }
.info-box h3 { font-size: 11px; color: #333; margin-bottom: 4px; display: flex; align-items: center; gap: 4px; }
.info-box h3::before { content: "□"; color: #ff6600; font-size: 12px; }
.info-box p { font-size: 10px; color: #666; line-height: 1.4; }
.info-box .highlight { color: #ff6600; font-weight: bold; font-size: 10px; margin-top: 2px; }
.info-box .meta { font-size: 9px; color: #999; line-height: 1.5; }
.info-box .meta-label { color: #666; font-weight: bold; }

/* 图表列 */
.chart-column { flex: 1 1 0; display: flex; flex-direction: column; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px; min-width: 0; }
.chart-title { font-size: 20px; font-weight: bold; color: #333; margin-bottom: 8px; }
.chart-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; font-size: 10px; }
.legend-item { display: flex; align-items: center; gap: 3px; }
.legend-item i { display: inline-block; width: 10px; height: 2px; border-radius: 1px; }
.chart-svg { flex: 1; width: 100%; min-height: 0; }
.chart-info { border: 2px dashed #ff9955; padding: 6px; border-radius: 6px; margin-top: 8px; font-size: 11px; color: #666; line-height: 1.6; }
.chart-info .highlight { color: #ff6600; font-weight: bold; }

/* 页脚 */
.footer { margin-top: 4px; text-align: center; color: #ccc; font-size: 10px; flex-shrink: 0; }

/* 导航面板 - 可折叠 */
.nav-panel { position: fixed; right: 20px; top: 50%; transform: translateY(-50%); background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 1000; width: 160px; transition: all 0.3s ease; }
.nav-panel.collapsed { width: 40px; padding: 10px 5px; overflow: hidden; }
.nav-panel.collapsed .nav-pages, .nav-panel.collapsed .nav-info { display: none; }
.nav-panel.collapsed .nav-title { writing-mode: vertical-rl; text-orientation: mixed; font-size: 12px; letter-spacing: 2px; margin-bottom: 0; }
.nav-toggle { position: absolute; left: -20px; top: 50%; transform: translateY(-50%); width: 20px; height: 40px; background: #ff6600; color: white; border: none; border-radius: 4px 0 0 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; pointer-events: auto; }
.nav-panel:hover .nav-toggle { opacity: 1; }
.nav-panel.collapsed .nav-toggle { opacity: 1; left: auto; right: -20px; border-radius: 0 4px 4px 0; transform: translateY(-50%) rotate(180deg); }
.nav-panel.pinned .nav-toggle { opacity: 1; }
.nav-title { font-size: 14px; font-weight: bold; color: #ff6600; margin-bottom: 10px; text-align: center; }
.nav-pages { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
.nav-page-item { padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; color: #666; transition: all 0.2s; }
.nav-page-item:hover { background: #fff5ee; color: #ff6600; }
.nav-page-item.active { background: #ff6600; color: white; }
.nav-info { text-align: center; font-size: 11px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 8px; }

/* 编辑状态 */
[contenteditable="true"]:focus { outline: 2px solid #ff6600; outline-offset: 2px; }
[contenteditable="true"] td:hover, [contenteditable="true"] .info-box:hover, [contenteditable="true"] .chart-column:hover { background: #fff9f5; cursor: text; }
"""

# ========== 数据查询 ==========

def run_query(cmd):
    """执行CLI查询命令"""
    full_cmd = f"~/.sai/bin/sai {cmd} 2>&1"
    try:
        result = subprocess.run(full_cmd, shell=True, capture_output=True, text=True, timeout=60)
        output = result.stdout + result.stderr
        # 提取JSON
        lines = output.strip().split('\n')
        for line in lines:
            line = line.strip()
            if line.startswith('{"ok"'):
                try:
                    return json.loads(line)
                except:
                    continue
        return None
    except Exception as e:
        print(f"Query error: {e}", file=sys.stderr)
        return None

def extract_list(data):
    """从返回数据中提取list"""
    if not data or not data.get('ok'):
        return []
    try:
        return data['data']['result']['body']['data']['list']
    except:
        return []

def extract_state_date(data):
    """从返回数据中提取stateDate"""
    if not data or not data.get('ok'):
        return ''
    try:
        return data['data']['result']['body']['data'].get('stateDate', '')
    except:
        return ''

# ========== 格式化函数 ==========

def fmt_rate(v):
    if v is None or v == '' or v == '%':
        return '-'
    try:
        if isinstance(v, str):
            v = v.replace('%', '')
        f = float(v)
        return f"{f:.2f}%"
    except:
        return str(v)

def fmt_gap(v):
    if v is None or v == '':
        return '-'
    try:
        f = float(v) / 10000  # 除以1万
        if f > 0:
            return f'+{f:.1f}万'
        else:
            return f'{f:.1f}万'
    except:
        return str(v)

def fmt_chain(v):
    if v is None or v == '' or v == '%':
        return '-'
    try:
        if isinstance(v, str):
            v = v.replace('%', '')
        f = float(v)
        return f"{f:.2f}%"
    except:
        return str(v)

def get_color_class(v, threshold_low=90, threshold_high=100, is_gap=False):
    if v is None or v == '' or v == '%':
        return ''
    try:
        if isinstance(v, str):
            v = v.replace('%', '')
        f = float(v)
        if is_gap:
            return 'positive' if f > 0 else 'negative' if f < 0 else ''
        else:
            if f < threshold_low:
                return 'negative'
            elif f >= threshold_high:
                return 'positive'
            return ''
    except:
        return ''

def fmt_percent(v):
    if v is None:
        return "-"
    return f"{v*100:.1f}%"

def fmt_wan(v):
    if v is None:
        return "-"
    return f"{v/10000:.0f}w"

def fmt_int(v):
    if v is None:
        return "-"
    return f"{int(v):,}"

# ========== SVG图表生成 ==========

def draw_line_chart(data_list, fields, colors, y_formatter, width=280, height=280):
    """绘制折线图 SVG - width 用于 viewBox 计算，实际宽度由 CSS 控制"""
    left, right, top, bottom = 40, 10, 15, 50
    chart_w = width - left - right
    chart_h = height - top - bottom
    
    # 收集所有有效值
    all_values = []
    for d in data_list:
        for f in fields:
            v = d.get(f)
            if v is not None:
                all_values.append(v)
    
    if not all_values:
        return f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}"><text x="{width//2}" y="{height//2}" text-anchor="middle" fill="#999">暂无数据</text></svg>'
    
    min_v = min(all_values)
    max_v = max(all_values)
    range_v = max_v - min_v
    if range_v == 0:
        range_v = max_v * 0.1 if max_v else 1
    min_v = min_v - range_v * 0.1
    max_v = max_v + range_v * 0.1
    
    svg_parts = [f'<svg width="100%" height="{height}" viewBox="0 0 {width} {height}" preserveAspectRatio="none">']
    
    # 网格线
    for i in range(6):
        y = top + chart_h * i / 5
        svg_parts.append(f'<line x1="{left}" y1="{y}" x2="{width-right}" y2="{y}" stroke="#e0e0e0" stroke-dasharray="3,3"/>')
    
    # Y轴标签
    for i in range(6):
        y = top + chart_h * i / 5
        val = max_v - (max_v - min_v) * i / 5
        label = y_formatter(val)
        svg_parts.append(f'<text x="{left-5}" y="{y+4}" text-anchor="end" font-size="10" fill="#999">{label}</text>')
    
    # X轴标签
    n = len(data_list)
    step = max(1, n // 8)
    for i in range(0, n, step):
        ds = data_list[i]['ds']
        label = f"{ds[4:6]}/{ds[6:]}"
        x = left + (i / (n-1)) * chart_w if n > 1 else left + chart_w/2
        svg_parts.append(f'<text x="{x}" y="{height-bottom+20}" text-anchor="middle" font-size="10" fill="#999">{label}</text>')
    
    # 绘制每条线
    for field, color in zip(fields, colors):
        points = []
        for i, d in enumerate(data_list):
            v = d.get(field)
            if v is not None:
                x = left + (i / (n-1)) * chart_w if n > 1 else left + chart_w/2
                y = top + (1 - (v - min_v) / (max_v - min_v)) * chart_h
                points.append((x, y, i))
        
        if len(points) < 2:
            continue
        
        # 分段绘制
        segments = []
        current_seg = [points[0]]
        for p in points[1:]:
            if p[2] - current_seg[-1][2] <= 1:
                current_seg.append(p)
            else:
                segments.append(current_seg)
                current_seg = [p]
        segments.append(current_seg)
        
        for seg in segments:
            if len(seg) < 2:
                continue
            pts_str = ' '.join(f'{x},{y}' for x, y, _ in seg)
            svg_parts.append(f'<polyline points="{pts_str}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round"/>')
            for x, y, _ in seg:
                svg_parts.append(f'<circle cx="{x}" cy="{y}" r="3" fill="{color}"/>')
    
    svg_parts.append('</svg>')
    return '\n'.join(svg_parts)

# ========== 页面生成 ==========

def generate_slide_1(market_data, volume_data, shop_data):
    """生成第1页：关键指标趋势"""
    
    # 计算底部信息
    latest_market = market_data[-1] if market_data else {}
    latest_sto_ms = latest_market.get('stoMarketShare')
    latest_tdt_ms = latest_market.get('tdtMarketShare')
    
    latest_vol = volume_data[-1] if volume_data else {}
    prev_vol = volume_data[-2] if len(volume_data) > 1 else None
    sto_latest = latest_vol.get('stoBizNum', 0) or 0
    sto_prev = prev_vol.get('stoBizNum', 0) if prev_vol else 0
    vol_chain = ((sto_latest - sto_prev) / sto_prev * 100) if sto_prev and sto_prev > 0 else 0
    
    first_vol = volume_data[0] if volume_data else None
    sto_first = first_vol.get('stoBizNum', 0) if first_vol else 0
    vol_yoy = ((sto_latest - sto_first) / sto_first * 100) if sto_first and sto_first > 0 else 0
    
    latest_shop = shop_data[-1] if shop_data else {}
    prev_shop = shop_data[-2] if len(shop_data) > 1 else None
    shop_latest = latest_shop.get('shopCount', 0) or 0
    shop_prev = prev_shop.get('shopCount', 0) if prev_shop else 0
    shop_chain = ((shop_latest - shop_prev) / shop_prev * 100) if shop_prev and shop_prev > 0 else 0
    shop_change = abs(shop_latest - shop_prev)
    
    # 生成图表
    market_svg = draw_line_chart(market_data, ['stoMarketShare', 'tdtMarketShare', 'tdtYoyMarketShare'],
                                ['#ff6600', '#00aa00', '#999999'], fmt_percent)
    volume_svg = draw_line_chart(volume_data, ['stoBizNum', 'ydBizNum', 'ytoBizNum'],
                                ['#ff6600', '#ffcc00', '#9966cc'], fmt_wan)
    shop_svg = draw_line_chart(shop_data, ['shopCount'], ['#ff6600'], fmt_int)
    
    return f'''
<div class="slide slide-3cols" id="slide-1" data-title="关键指标趋势">
    <div class="header">
        <div class="title"><span class="num">01</span><span class="text">关键指标趋势</span></div>
        <div class="logo">我为人人 人人为我</div>
    </div>
    <div class="container" style="height: 520px;">
        <div class="chart-column">
            <div class="chart-title">市占</div>
            <div class="chart-legend">
                <span class="legend-item"><i style="background:#ff6600"></i>本期全品牌市占</span>
                <span class="legend-item"><i style="background:#00aa00"></i>本期通达兔市占</span>
                <span class="legend-item"><i style="background:#999"></i>同期通达兔市占</span>
            </div>
            {market_svg}
            <div class="chart-info">
                <p>最新市占 <span class="highlight">{fmt_percent(latest_sto_ms) if latest_sto_ms else '-'}</span></p>
                <p>通达兔市占 <span class="highlight">{fmt_percent(latest_tdt_ms) if latest_tdt_ms else '-'}</span></p>
            </div>
        </div>
        <div class="chart-column">
            <div class="chart-title">单量</div>
            <div class="chart-legend">
                <span class="legend-item"><i style="background:#ff6600"></i>本期</span>
                <span class="legend-item"><i style="background:#ffcc00"></i>YD</span>
                <span class="legend-item"><i style="background:#9966cc"></i>YT</span>
            </div>
            {volume_svg}
            <div class="chart-info">
                <p>本期单量<span class="highlight">环比增长{vol_chain:.1f}%</span>；</p>
                <p>本期单量<span class="highlight">同比增长{vol_yoy:.1f}%</span>。</p>
            </div>
        </div>
        <div class="chart-column">
            <div class="chart-title">客户数</div>
            <div class="chart-legend">
                <span class="legend-item"><i style="background:#ff6600"></i>大盘</span>
            </div>
            {shop_svg}
            <div class="chart-info">
                <p>客户数<span class="highlight">较上期增长{shop_chain:.1f}%</span>，涉及{shop_change}个客户。</p>
            </div>
        </div>
    </div>
    <div class="footer">生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')} | 数据来源：政策周报PPT | 第 1 / 2 页</div>
</div>'''

def generate_slide_2(process_data):
    """生成第 2 页：过程目标达成"""
    
    # 过滤数据 - 排除总部、西藏、海南、未知政策省，但保留全国
    exclude = {'总部', '西藏', '海南', '未知政策省'}
    filtered = [d for d in process_data if d.get('policyProvName') not in exclude]
    
    # 提取"全国"数据单独处理
    national_data = [d for d in filtered if d.get('policyProvName') == '全国']
    provincial_data = [d for d in filtered if d.get('policyProvName') != '全国']
    
    # 战区排序
    war_order = ['一战区', '二战区', '三战区']
    def war_sort_key(item):
        w = item.get('warName', '')
        return war_order.index(w) if w in war_order else 99
    provincial_data.sort(key=war_sort_key)
    
    # 按战区分组
    war_groups = OrderedDict()
    for d in provincial_data:
        w = d.get('warName', '')
        if w not in war_groups:
            war_groups[w] = []
        war_groups[w].append(d)
    # 生成趋势图 SVG
    def make_trend_svg(d):
        vals = [d.get(f'policyGotNum{i}', 0) for i in [4, 3, 2, 1]]
        valid_vals = [v for v in vals if v]
        if not valid_vals:
            return '<span style="color:#999">-</span>'
        
        min_v = min(valid_vals)
        max_v = max(valid_vals)
        
        pts = []
        for i, v in enumerate(vals):
            if v:
                y = 8 if max_v == min_v else 14 - ((v - min_v) / (max_v - min_v)) * 12
            else:
                y = 14
            pts.append((i * 16 + 4, y))
        
        color = '#00aa00' if vals[-1] > vals[0] else '#ff6600' if vals[-1] < vals[0] else '#999999'
        
        lines = []
        for i in range(len(pts)-1):
            lines.append(f'<line x1="{pts[i][0]}" y1="{pts[i][1]}" x2="{pts[i+1][0]}" y2="{pts[i+1][1]}" stroke="{color}" stroke-width="1.5"/>')
        
        dots = []
        for x, y in pts:
            dots.append(f'<circle cx="{x}" cy="{y}" r="1.5" fill="{color}"/>')
        
        return f'<svg width="50" height="16" viewBox="0 0 50 16">{ "".join(lines) }{ "".join(dots) }</svg>'
    
    # 生成表格行 - 计算总行数用于均匀分布
    total_rows = sum(len(provinces) for provinces in war_groups.values())
    row_height_pct = 100.0 / total_rows if total_rows > 0 else 0
    
    # 生成表格行 - 计算总行数用于均匀分布
    total_rows = sum(len(provinces) for provinces in war_groups.values())
    if national_data:
        total_rows += 1  # 全国行单独占一行
    row_height_pct = 100.0 / total_rows if total_rows > 0 else 0
    
    table_rows = []
    
    # 添加全国行到最前面
    for d in national_data:
        prov = d.get('policyProvName', '')
        y_rate = fmt_rate(d.get('yAchievementRate'))
        y_gap = fmt_gap(d.get('yAchievementGap'))
        w_rate = fmt_rate(d.get('wAchievementRate'))
        w_gap = fmt_gap(d.get('wAchievementGap'))
        w_chain = fmt_chain(d.get('wPolicyGotNumChain'))
        w_yoy = fmt_chain(d.get('wPolicyGotNumYoy'))
        trend = make_trend_svg(d)
        
        y_rate_cls = get_color_class(d.get('yAchievementRate'))
        y_gap_cls = get_color_class(d.get('yAchievementGap'), is_gap=True)
        w_rate_cls = get_color_class(d.get('wAchievementRate'))
        w_gap_cls = get_color_class(d.get('wAchievementGap'), is_gap=True)
        w_chain_cls = get_color_class(d.get('wPolicyGotNumChain'), is_gap=True)
        
        row_style = f' style="height:{row_height_pct:.2f}%"' if row_height_pct > 0 else ''
        table_rows.append(f'<tr{row_style}><td class="war-zone" rowspan="1"></td><td>{prov}</td><td class="{y_rate_cls}">{y_rate}</td><td class="{y_gap_cls}">{y_gap}</td><td class="{w_rate_cls}">{w_rate}</td><td class="{w_gap_cls}">{w_gap}</td><td class="{w_chain_cls}">{w_chain}</td><td>{w_yoy}</td><td class="trend">{trend}</td></tr>')
    
    for war_name, provinces in war_groups.items():
        rowspan = len(provinces)
        for i, d in enumerate(provinces):
            prov = d.get('policyProvName', '')
            y_rate = fmt_rate(d.get('yAchievementRate'))
            y_gap = fmt_gap(d.get('yAchievementGap'))
            w_rate = fmt_rate(d.get('wAchievementRate'))
            w_gap = fmt_gap(d.get('wAchievementGap'))
            w_chain = fmt_chain(d.get('wPolicyGotNumChain'))
            w_yoy = fmt_chain(d.get('wPolicyGotNumYoy'))
            trend = make_trend_svg(d)
            
            y_rate_cls = get_color_class(d.get('yAchievementRate'))
            y_gap_cls = get_color_class(d.get('yAchievementGap'), is_gap=True)
            w_rate_cls = get_color_class(d.get('wAchievementRate'))
            w_gap_cls = get_color_class(d.get('wAchievementGap'), is_gap=True)
            w_chain_cls = get_color_class(d.get('wPolicyGotNumChain'), is_gap=True)
            
            row_style = f' style="height:{row_height_pct:.2f}%"' if row_height_pct > 0 else ''
            
            if i == 0:
                table_rows.append(f'<tr{row_style}><td class="war-zone" rowspan="{rowspan}">{war_name}</td><td>{prov}</td><td class="{y_rate_cls}">{y_rate}</td><td class="{y_gap_cls}">{y_gap}</td><td class="{w_rate_cls}">{w_rate}</td><td class="{w_gap_cls}">{w_gap}</td><td class="{w_chain_cls}">{w_chain}</td><td>{w_yoy}</td><td class="trend">{trend}</td></tr>')
            else:
                table_rows.append(f'<tr{row_style}><td>{prov}</td><td class="{y_rate_cls}">{y_rate}</td><td class="{y_gap_cls}">{y_gap}</td><td class="{w_rate_cls}">{w_rate}</td><td class="{w_gap_cls}">{w_gap}</td><td class="{w_chain_cls}">{w_chain}</td><td>{w_yoy}</td><td class="trend">{trend}</td></tr>')
    
    table_body = '\n'.join(table_rows)
    
    return f'''
<div class="slide" id="slide-2" data-title="过程目标达成">
    <div class="header">
        <div class="title"><span class="num">02</span><span class="text">过程目标达成</span></div>
        <div class="logo">我为人人 人人为我</div>
    </div>
    <div class="container">
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr><th>战区</th><th>省区</th><th>月达成率</th><th>月达成缺口</th><th>周达成率</th><th>周达成缺口</th><th>周环比</th><th>周同比</th><th>周揽件量趋势</th></tr>
                </thead>
                <tbody>
                    {table_body}
                </tbody>
            </table>
        </div>
        <div class="sidebar">
            <div class="info-box">
                <h3>过程目标取值逻辑</h3>
                <p style="color: #0066cc; font-style: italic;">市占目标*累计行业规模VS业务量目标</p>
            </div>
            <div class="info-box">
                <h3>关注同行价格省区</h3>
                <p class="highlight">广东</p>
                <p class="highlight">四川、西北、重庆</p>
            </div>
            <div class="info-box">
                <h3>关注调整幅度省区</h3>
                <p class="highlight">贵州、广西、云南</p>
            </div>
            <div class="info-box">
                <h3>数据说明</h3>
                <p class="meta"><span class="meta-label">取数维度：</span>政策省过程目标与揽件达成明细</p>
                <p class="meta"><span class="meta-label">统计日期：</span>2026-05-10</p>
                <p class="meta"><span class="meta-label">更新频率：</span>每周</p>
                <p class="meta"><span class="meta-label">数据来源：</span>政策周报PPT</p>
            </div>
        </div>
    </div>
    <div class="footer">生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')} | 数据来源：政策周报PPT | 第 2 / 2 页</div>
</div>'''

# ========== 主函数 ==========

def main():
    print("正在查询数据...", file=sys.stderr)
    
    # 并行查询所有数据
    market_result = run_query("policyWeekPpt industryTdtMarketShare query --params '{}'")
    volume_result = run_query("policyWeekPpt keyMetricTrendVolume query --params '{}'")
    shop_result = run_query("policyWeekPpt keyMetricTrendShopCount query --params '{}'")
    process_result = run_query("policyWeekPpt processTarget query --params '{}'")
    
    # 提取数据
    market_data = extract_list(market_result)
    volume_data = extract_list(volume_result)
    shop_data = extract_list(shop_result)
    process_data = extract_list(process_result)
    
    print(f"市占数据: {len(market_data)} 条", file=sys.stderr)
    print(f"单量数据: {len(volume_data)} 条", file=sys.stderr)
    print(f"客户数数据: {len(shop_data)} 条", file=sys.stderr)
    print(f"过程目标数据: {len(process_data)} 条", file=sys.stderr)
    
    # 生成各页面
    slide1 = generate_slide_1(market_data, volume_data, shop_data)
    slide2 = generate_slide_2(process_data)
    
    # 生成导航项
    nav_items = []
    for config in SLIDE_CONFIG:
        nav_items.append(f'<div class="nav-page-item" data-target="slide-{config["id"]}">{config["num"]} {config["title"]}</div>')
    
    # 生成完整HTML
    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>周会PPT - {datetime.now().strftime('%Y-%m-%d')}</title>
    <style>
        {COMMON_CSS}
    </style>
</head>
<body>
    <div class="ppt-container" contenteditable="true">
        {slide1}
        {slide2}
    </div>
    
    <div class="nav-panel" id="navPanel">
        <button class="nav-toggle" id="navToggle" title="收起">▶</button>
        <div class="nav-title">周会PPT</div>
        <div class="nav-pages">
            {''.join(nav_items)}
        </div>
        <div class="nav-info">
            第 <span id="current-page">1</span> / <span id="total-pages">{len(SLIDE_CONFIG)}</span> 页
        </div>
    </div>
    
    <script>
        const slides = document.querySelectorAll('.slide');
        const currentPageEl = document.getElementById('current-page');
        const navItems = document.querySelectorAll('.nav-page-item');
        const navPanel = document.getElementById('navPanel');
        const navToggle = document.getElementById('navToggle');
        
        // 导航折叠/展开 - 点击按钮切换
        navToggle.addEventListener('click', function(e) {{
            e.stopPropagation();
            navPanel.classList.toggle('collapsed');
            const isCollapsed = navPanel.classList.contains('collapsed');
            navToggle.textContent = isCollapsed ? '◀' : '▶';
            navToggle.title = isCollapsed ? '展开' : '收起';
        }});
        
        // 鼠标悬停自动展开
        navPanel.addEventListener('mouseenter', function() {{
            if (navPanel.classList.contains('collapsed')) {{
                navPanel.classList.remove('collapsed');
                navToggle.textContent = '▶';
                navToggle.title = '收起';
            }}
        }});
        
        navPanel.addEventListener('mouseleave', function() {{
            if (!navPanel.classList.contains('collapsed')) {{
                navPanel.classList.add('collapsed');
                navToggle.textContent = '◀';
                navToggle.title = '展开';
            }}
        }});
        
        const observer = new IntersectionObserver((entries) => {{
            entries.forEach(entry => {{
                if (entry.isIntersecting) {{
                    const id = entry.target.id.replace('slide-', '');
                    currentPageEl.textContent = id;
                    navItems.forEach(item => {{
                        item.classList.toggle('active', item.getAttribute('data-target') === entry.target.id);
                    }});
                }}
            }});
        }}, {{ threshold: 0.5 }});
        
        slides.forEach(slide => observer.observe(slide));
        
        navItems.forEach(item => {{
            item.addEventListener('click', function(e) {{
                e.stopPropagation();
                const targetId = item.getAttribute('data-target');
                document.getElementById(targetId).scrollIntoView({{ behavior: 'smooth' }});
            }});
        }});
    </script>
</body>
</html>'''
    
    # 写入文件
    workspace_dir = os.path.join(os.path.expanduser("~"), ".openclaw", "workspace")
    os.makedirs(workspace_dir, exist_ok=True)
    output_file = os.path.join(workspace_dir, f"weekly_ppt_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html")
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html)

    print(output_file)

if __name__ == '__main__':
    main()

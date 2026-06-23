#!/usr/bin/env python3
"""
通用 PPT HTML 报告生成器

用法：
    uv run python generate.py --config template.json --data-dir ./data --output report.html
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime
from pathlib import Path

# StoClaw artifact output directory (aligned with long-output-saver / AGENTS.md).
_DEFAULT_OUTPUT_DIR = (
    Path.home() / ".stoclaw" / "openclaw" / "workspace" / ".claw-output"
)


def get_output_dir() -> Path:
    """Resolve the directory for generated HTML reports."""
    env_output = os.environ.get("STOCLAW_OUTPUT_DIR", "").strip()
    if env_output:
        return Path(env_output).expanduser().resolve()
    env_workspace = os.environ.get("STOCLAW_WORKSPACE", "").strip()
    if env_workspace:
        return (Path(env_workspace).expanduser() / ".claw-output").resolve()
    return _DEFAULT_OUTPUT_DIR.resolve()


def resolve_output_file(output_arg: str | None) -> Path:
    """
    Resolve the final output file path.
    - No --output: .claw-output/report_<timestamp>.html
    - Relative --output: under .claw-output (not skill cwd)
    - Absolute --output: used as-is (with version bump if exists)
    """
    output_dir = get_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    if output_arg:
        candidate = Path(output_arg).expanduser()
        if candidate.is_absolute():
            target = candidate
        else:
            target = output_dir / candidate
        return resolve_versioned_path(target)

    return output_dir / f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"

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

/* 多列布局 */
.slide-multi-column .container { justify-content: stretch; gap: 12px; padding: 0 15px; width: 100%; }
.slide-multi-column .column { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }

/* 表格+侧边栏布局 */
.slide-table-with-sidebar .container { justify-content: stretch; gap: 12px; padding: 0 15px; width: 100%; }
.slide-table-with-sidebar .table-wrapper { flex: 1; overflow: visible; min-height: 0; height: 100%; }
.slide-table-with-sidebar .sidebar { width: 220px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px; flex-shrink: 0; height: 100%; }

/* 单列布局 */
.slide-single .container { justify-content: stretch; padding: 0 15px; width: 100%; }
.slide-single .column { flex: 1; display: flex; flex-direction: column; }

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

/* 指标卡片 */
.metric-cards { display: flex; gap: 16px; justify-content: center; align-items: center; flex: 1; }
.metric-card { background: linear-gradient(180deg, #fff5ee 0%, #fff 100%); border: 1px solid #ffccaa; border-radius: 12px; padding: 24px 32px; text-align: center; min-width: 160px; }
.metric-card .label { font-size: 12px; color: #999; margin-bottom: 8px; }
.metric-card .value { font-size: 36px; font-weight: bold; color: #ff6600; }
.metric-card .change { font-size: 12px; margin-top: 4px; }

/* 页脚 */
.footer { margin-top: 4px; text-align: center; color: #ccc; font-size: 10px; flex-shrink: 0; }

/* 导航面板 */
.nav-panel { position: fixed; right: 20px; top: 50%; transform: translateY(-50%); background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 1000; width: 160px; transition: all 0.3s ease; }
.nav-panel.collapsed { width: 40px; padding: 10px 5px; overflow: hidden; }
.nav-panel.collapsed .nav-pages, .nav-panel.collapsed .nav-info { display: none; }
.nav-panel.collapsed .nav-title { writing-mode: vertical-rl; text-orientation: mixed; font-size: 12px; letter-spacing: 2px; margin-bottom: 0; }
.nav-toggle { position: absolute; left: -20px; top: 50%; transform: translateY(-50%); width: 20px; height: 40px; background: #ff6600; color: white; border: none; border-radius: 4px 0 0 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; pointer-events: auto; }
.nav-panel:hover .nav-toggle { opacity: 1; }
.nav-panel.collapsed .nav-toggle { opacity: 1; left: auto; right: -20px; border-radius: 0 4px 4px 0; transform: translateY(-50%) rotate(180deg); }
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

# ========== 格式化工具 ==========

FORMATTERS = {
    "percent": lambda v: f"{float(v)*100:.1f}%" if v is not None else "-",
    "wan": lambda v: f"{float(v)/10000:.0f}w" if v is not None else "-",
    "int": lambda v: f"{int(v):,}" if v is not None else "-",
    "float": lambda v: f"{float(v):.2f}" if v is not None else "-",
    "rate": lambda v: f"{float(str(v).replace('%', '')):.2f}%" if v is not None and v != '' and v != '%' else "-",
    "text": lambda v: str(v) if v is not None else "-",
    "gap": lambda v: _fmt_gap(v),
    "chain": lambda v: _fmt_chain(v),
}

def _fmt_gap(v):
    if v is None or v == '':
        return '-'
    try:
        f = float(v) / 10000
        return f'+{f:.1f}万' if f > 0 else f'{f:.1f}万'
    except:
        return str(v)

def _fmt_chain(v):
    if v is None or v == '' or v == '%':
        return '-'
    try:
        f = float(str(v).replace('%', ''))
        return f"{f:.2f}%"
    except:
        return str(v)

def get_color_class(v, threshold_low=90, threshold_high=100, is_gap=False):
    if v is None or v == '' or v == '%':
        return ''
    try:
        f = float(str(v).replace('%', ''))
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

# ========== SVG 图表 ==========

def draw_line_chart(data_list, fields, colors, y_formatter_name="float", width=280, height=280):
    """绘制折线图 SVG"""
    y_formatter = FORMATTERS.get(y_formatter_name, FORMATTERS["float"])
    left, right, top, bottom = 40, 10, 15, 50
    chart_w = width - left - right
    chart_h = height - top - bottom
    
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
    
    for i in range(6):
        y = top + chart_h * i / 5
        svg_parts.append(f'<line x1="{left}" y1="{y}" x2="{width-right}" y2="{y}" stroke="#e0e0e0" stroke-dasharray="3,3"/>')
    
    for i in range(6):
        y = top + chart_h * i / 5
        val = max_v - (max_v - min_v) * i / 5
        # 对于格式化器，避免显示太长的标签
        label = y_formatter(val)
        svg_parts.append(f'<text x="{left-5}" y="{y+4}" text-anchor="end" font-size="10" fill="#999">{label}</text>')
    
    n = len(data_list)
    step = max(1, n // 8)
    for i in range(0, n, step):
        ds = data_list[i].get('ds', '')
        label = f"{ds[4:6]}/{ds[6:]}" if len(ds) >= 8 else str(i)
        x = left + (i / (n-1)) * chart_w if n > 1 else left + chart_w/2
        svg_parts.append(f'<text x="{x}" y="{height-bottom+20}" text-anchor="middle" font-size="10" fill="#999">{label}</text>')
    
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

def draw_bar_chart(data_list, field, color="#ff6600", width=280, height=280):
    """绘制柱状图 SVG"""
    left, right, top, bottom = 40, 10, 15, 50
    chart_w = width - left - right
    chart_h = height - top - bottom
    
    values = [d.get(field) for d in data_list if d.get(field) is not None]
    if not values:
        return f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}"><text x="{width//2}" y="{height//2}" text-anchor="middle" fill="#999">暂无数据</text></svg>'
    
    max_v = max(values)
    min_v = min(0, min(values))
    range_v = max_v - min_v
    if range_v == 0:
        range_v = 1
    
    n = len(data_list)
    bar_w = chart_w / n * 0.6
    gap = chart_w / n * 0.4
    
    svg_parts = [f'<svg width="100%" height="{height}" viewBox="0 0 {width} {height}" preserveAspectRatio="none">']
    
    # 网格线
    for i in range(5):
        y = top + chart_h * i / 4
        svg_parts.append(f'<line x1="{left}" y1="{y}" x2="{width-right}" y2="{y}" stroke="#e0e0e0" stroke-dasharray="3,3"/>')
    
    for i, d in enumerate(data_list):
        v = d.get(field)
        if v is None:
            continue
        x = left + i * (bar_w + gap) + gap/2
        bar_h = ((v - min_v) / range_v) * chart_h
        y = top + chart_h - bar_h
        svg_parts.append(f'<rect x="{x}" y="{y}" width="{bar_w}" height="{bar_h}" fill="{color}" rx="2"/>')
        
        ds = d.get('ds', '')
        label = f"{ds[4:6]}/{ds[6:]}" if len(ds) >= 8 else str(i)
        svg_parts.append(f'<text x="{x + bar_w/2}" y="{height-bottom+20}" text-anchor="middle" font-size="10" fill="#999">{label}</text>')
    
    svg_parts.append('</svg>')
    return '\n'.join(svg_parts)

# ========== 页面渲染器 ==========

class PageRenderer:
    def __init__(self, data_sources: dict, theme: dict):
        self.data_sources = data_sources
        self.theme = theme
    
    def get_data(self, key: str) -> list:
        return self.data_sources.get(key, [])
    
    def render_page(self, page_config: dict, page_num: int, total_pages: int) -> str:
        layout = page_config.get("layout", "single")
        page_id = page_config.get("id", page_num)
        title = page_config.get("title", "")
        
        render_method = getattr(self, f"_render_{layout.replace('-', '_')}", self._render_single)
        content = render_method(page_config)
        
        return f'''
<div class="slide slide-{layout}" id="slide-{page_id}" data-title="{title}">
    <div class="header">
        <div class="title"><span class="num">{page_id:02d}</span><span class="text">{title}</span></div>
        <div class="logo">我为人人 人人为我</div>
    </div>
    {content}
    <div class="footer">生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')} | 第 {page_num} / {total_pages} 页</div>
</div>'''
    
    def _render_multi_column(self, page_config: dict) -> str:
        sections = page_config.get("sections", [])
        columns_html = []
        
        for section in sections:
            col_html = self._render_section(section)
            columns_html.append(f'<div class="column">{col_html}</div>')
        
        return f'<div class="container">{"".join(columns_html)}</div>'
    
    def _render_table_with_sidebar(self, page_config: dict) -> str:
        table_config = page_config.get("table", {})
        sidebar_config = page_config.get("sidebar", [])
        
        table_html = self._render_table_section(table_config)
        sidebar_html = self._render_sidebar(sidebar_config)
        
        return f'''
<div class="container">
    <div class="table-wrapper">{table_html}</div>
    <div class="sidebar">{sidebar_html}</div>
</div>'''
    
    def _render_single(self, page_config: dict) -> str:
        sections = page_config.get("sections", [])
        sections_html = []
        for section in sections:
            sections_html.append(self._render_section(section))
        return f'<div class="container"><div class="column">{"".join(sections_html)}</div></div>'
    
    def _render_section(self, section: dict) -> str:
        section_type = section.get("type", "info")
        render_method = getattr(self, f"_render_{section_type.replace('-', '_')}", self._render_info)
        return render_method(section)
    
    def _render_line_chart(self, section: dict) -> str:
        data_source = section.get("data_source", "")
        data = self.get_data(data_source)
        fields = section.get("fields", [])
        colors = section.get("colors", ["#ff6600"])
        y_formatter = section.get("y_formatter", "float")
        title = section.get("title", "")
        labels = section.get("labels", fields)
        info_text = section.get("info_text", "")
        
        svg = draw_line_chart(data, fields, colors, y_formatter)
        
        legend_html = ""
        if labels and colors:
            legend_items = "".join(
                f'<span class="legend-item"><i style="background:{c}"></i>{l}</span>'
                for l, c in zip(labels, colors)
            )
            legend_html = f'<div class="chart-legend">{legend_items}</div>'
        
        info_html = ""
        if info_text:
            info_html = f'<div class="chart-info">{self._format_info_text(info_text, data)}</div>'
        
        return f'''
<div class="chart-column">
    <div class="chart-title">{title}</div>
    {legend_html}
    {svg}
    {info_html}
</div>'''
    
    def _render_bar_chart(self, section: dict) -> str:
        data_source = section.get("data_source", "")
        data = self.get_data(data_source)
        field = section.get("field", "")
        color = section.get("color", "#ff6600")
        title = section.get("title", "")
        info_text = section.get("info_text", "")
        
        svg = draw_bar_chart(data, field, color)
        
        info_html = ""
        if info_text:
            info_html = f'<div class="chart-info">{self._format_info_text(info_text, data)}</div>'
        
        return f'''
<div class="chart-column">
    <div class="chart-title">{title}</div>
    {svg}
    {info_html}
</div>'''
    
    def _render_table(self, section: dict) -> str:
        return self._render_table_section(section)
    
    def _render_table_section(self, section: dict) -> str:
        data_source = section.get("data_source", "")
        data = self.get_data(data_source)
        columns = section.get("columns", [])
        
        if not data:
            return '<div style="text-align:center;color:#999;padding:40px;">暂无数据</div>'
        
        thead_html = "<tr>" + "".join(f"<th>{c.get('title', c['field'])}</th>" for c in columns) + "</tr>"
        
        tbody_rows = []
        for row in data:
            cells = []
            for col in columns:
                field = col.get("field", "")
                fmt = col.get("format", "text")
                colorize = col.get("colorize", False)
                val = row.get(field)
                
                formatted = FORMATTERS.get(fmt, FORMATTERS["text"])(val)
                
                cls = ""
                if colorize:
                    cls = get_color_class(val)
                
                cells.append(f'<td class="{cls}">{formatted}</td>')
            tbody_rows.append("<tr>" + "".join(cells) + "</tr>")
        
        return f'''
<table>
    <thead>{thead_html}</thead>
    <tbody>{"".join(tbody_rows)}</tbody>
</table>'''
    
    def _render_metric_cards(self, section: dict) -> str:
        cards = section.get("cards", [])
        cards_html = []
        
        for card in cards:
            data_source = card.get("data_source", "")
            data = self.get_data(data_source)
            field = card.get("field", "")
            label = card.get("label", "")
            fmt = card.get("format", "text")
            
            latest_val = data[-1].get(field) if data else None
            prev_val = data[-2].get(field) if len(data) > 1 else None
            
            value_str = FORMATTERS.get(fmt, FORMATTERS["text"])(latest_val)
            
            change_str = ""
            if latest_val is not None and prev_val is not None and prev_val != 0:
                change_pct = (latest_val - prev_val) / prev_val * 100
                change_cls = "positive" if change_pct > 0 else "negative"
                change_str = f'<div class="change {change_cls}">{"+" if change_pct > 0 else ""}{change_pct:.1f}%</div>'
            
            cards_html.append(f'''
<div class="metric-card">
    <div class="label">{label}</div>
    <div class="value">{value_str}</div>
    {change_str}
</div>''')
        
        return f'<div class="metric-cards">{"".join(cards_html)}</div>'
    
    def _render_info(self, section: dict) -> str:
        content = section.get("content", "")
        title = section.get("title", "")
        return f'<div class="info-box"><h3>{title}</h3><p>{content}</p></div>'
    
    def _render_sidebar(self, sections: list) -> str:
        boxes = []
        for section in sections:
            title = section.get("title", "")
            content = section.get("content", "")
            highlight = section.get("highlight", "")
            
            content_html = f"<p>{content}</p>" if content else ""
            highlight_html = f'<p class="highlight">{highlight}</p>' if highlight else ""
            meta_html = ""
            if "meta" in section:
                for label, value in section["meta"].items():
                    meta_html += f'<p class="meta"><span class="meta-label">{label}：</span>{value}</p>'
            
            boxes.append(f'''
<div class="info-box">
    <h3>{title}</h3>
    {content_html}
    {highlight_html}
    {meta_html}
</div>''')
        
        return "".join(boxes)
    
    def _format_info_text(self, text: str, data: list) -> str:
        """支持 {{变量}} 插值"""
        if not data:
            return text
        
        latest = data[-1] if data else {}
        prev = data[-2] if len(data) > 1 else {}
        
        # 简单替换 {{field}} 为最新值
        import re
        def replacer(match):
            field = match.group(1)
            val = latest.get(field)
            return FORMATTERS.get("text", str)(val)
        
        return re.sub(r'\{\{(\w+)\}\}', replacer, text)


# ========== 版本化路径解析 ==========

def resolve_versioned_path(base_path: Path) -> Path:
    """如果路径已存在，自动递增版本号 v1, v2..."""
    if not base_path.exists():
        return base_path

    stem = base_path.stem
    suffix = base_path.suffix
    parent = base_path.parent

    import re
    base_stem = re.sub(r'_v\d+$', '', stem)

    max_ver = 0
    # 检查基础文件（无版本后缀）是否存在，存在则算作 v0
    if (parent / f"{base_stem}{suffix}").exists():
        max_ver = 0

    # 查找所有带版本号的同基础名文件
    for f in parent.glob(f"{base_stem}_v*{suffix}"):
        match = re.search(r'_v(\d+)' + re.escape(suffix) + '$', f.name)
        if match:
            max_ver = max(max_ver, int(match.group(1)))

    new_ver = max_ver + 1
    return parent / f"{base_stem}_v{new_ver}{suffix}"


# ========== 主函数 ==========

def main():
    parser = argparse.ArgumentParser(description="通用 PPT HTML 报告生成器")
    parser.add_argument("--config", required=True, help="模板配置文件路径（JSON）")
    parser.add_argument("--data-dir", required=True, help="数据目录，内含 <data_key>.json 文件")
    parser.add_argument("--output", default=None, help="输出 HTML 路径")
    args = parser.parse_args()
    
    config_path = Path(args.config)
    data_dir = Path(args.data_dir)
    
    # 加载模板配置
    if not config_path.exists():
        print(f"❌ 模板配置不存在: {config_path}", file=sys.stderr)
        sys.exit(1)
    
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    pages_config = config.get("pages", [])
    theme = config.get("theme", {
        "primary": "#ff6600",
        "background": "#f5f5f5",
        "negative": "#cc0000",
        "positive": "#00aa00"
    })
    
    print(f"模板: {config.get('name', '未命名')}, 页面数: {len(pages_config)}", file=sys.stderr)
    
    # 加载数据
    data_sources = {}
    required_sources = set()
    for page in pages_config:
        for section in page.get("sections", []):
            if "data_source" in section:
                required_sources.add(section["data_source"])
        if "table" in page:
            required_sources.add(page["table"].get("data_source", ""))
    
    for src in required_sources:
        if not src:
            continue
        data_file = data_dir / f"{src}.json"
        if data_file.exists():
            with open(data_file, 'r', encoding='utf-8') as f:
                data_sources[src] = json.load(f)
            print(f"  加载数据 {src}: {len(data_sources[src])} 条", file=sys.stderr)
        else:
            print(f"  ⚠️ 数据文件缺失: {data_file}", file=sys.stderr)
            data_sources[src] = []
    
    # 渲染页面
    renderer = PageRenderer(data_sources, theme)
    slides_html = []
    nav_items = []
    
    total_pages = len(pages_config)
    for i, page in enumerate(pages_config):
        page_num = i + 1
        page_id = page.get("id", page_num)
        slide_html = renderer.render_page(page, page_num, total_pages)
        slides_html.append(slide_html)
        nav_items.append(
            f'<div class="nav-page-item" data-target="slide-{page_id}">{page_id:02d} {page.get("title", "")}</div>'
        )
    
    # 组装完整 HTML
    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{config.get("name", "报告")} - {datetime.now().strftime('%Y-%m-%d')}</title>
    <style>
        {COMMON_CSS}
    </style>
</head>
<body>
    <div class="ppt-container" contenteditable="true">
        {"".join(slides_html)}
    </div>
    
    <div class="nav-panel" id="navPanel">
        <button class="nav-toggle" id="navToggle" title="收起">▶</button>
        <div class="nav-title">{config.get("name", "报告")}</div>
        <div class="nav-pages">
            {"".join(nav_items)}
        </div>
        <div class="nav-info">
            第 <span id="current-page">1</span> / <span id="total-pages">{total_pages}</span> 页
        </div>
    </div>
    
    <script>
        const slides = document.querySelectorAll('.slide');
        const currentPageEl = document.getElementById('current-page');
        const navItems = document.querySelectorAll('.nav-page-item');
        const navPanel = document.getElementById('navPanel');
        const navToggle = document.getElementById('navToggle');
        
        navToggle.addEventListener('click', function(e) {{
            e.stopPropagation();
            navPanel.classList.toggle('collapsed');
            const isCollapsed = navPanel.classList.contains('collapsed');
            navToggle.textContent = isCollapsed ? '◀' : '▶';
            navToggle.title = isCollapsed ? '展开' : '收起';
        }});
        
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
    
    # 写入文件（默认 ~/.stoclaw/openclaw/workspace/.claw-output/）
    output_file = resolve_output_file(args.output)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"报告已生成: {output_file}")

if __name__ == '__main__':
    main()

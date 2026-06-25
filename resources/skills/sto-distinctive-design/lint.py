#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sto-distinctive-design lint —— 把 skill 的硬规格变成确定性检查。
用法:  python3 lint.py report.html [--json] [--sto]
       STO/申通现为默认风格:品牌橙 #FF6700 系 + 辅助蓝 #005BE5 默认放行,无需任何 flag。
       --sto: 进一步豁免所有冷蓝带(含 oklch/hsl 冷蓝),仅当确实要满屏蓝色系时用。
退出码: 有 P0 违规 → 1 (可用于 gate);否则 0。

只查"机器能确定判定"的规则;主观的留给模型/人(skill 里标 guidance 的不在此)。
规则来源标在每条 message 末尾的 [file·概念]。
"""
import sys, re, json, colorsys, bisect

# ---------- 工具 ----------
def line_of(offsets, pos):
    return bisect.bisect_right(offsets, pos)

def hex_to_hsl(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c*2 for c in h)
    if len(h) != 6:
        return None
    r, g, b = (int(h[i:i+2], 16)/255 for i in (0, 2, 4))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    return hh*360, ss, ll  # hue 0-360, sat 0-1, light 0-1

# 冷蓝/靛蓝 band。SKILL 口径是 hue 200–285;此处刻意收窄到 212–278,
# 留出两端缓冲(近青 200–211 / 近紫 279–285)避免误伤,宁可漏报不误杀。
COLD = lambda hue: 212 <= hue <= 278
INDIGO = {'#6366f1','#4f46e5','#4338ca','#3730a3','#8b5cf6','#7c3aed','#a855f7'}
BRAND_OK = {'#ff6700','#ff852e','#d24d00','#005be5','#4760fe'}  # STO 品牌橙系+辅助蓝+info蓝:默认放行(STO 为默认风格)
BAD_FONTS = ('inter','roboto','arial')
EMOJI = re.compile(r'[\U0001F300-\U0001FAFF☀-➿⬀-⯿️✨]')

# ---------- 加载 ----------
if len(sys.argv) < 2:
    print("用法: python3 lint.py report.html [--json]"); sys.exit(2)
path = sys.argv[1]
as_json = '--json' in sys.argv
sto = '--sto' in sys.argv  # 用户点名 STO/申通品牌:豁免品牌橙/辅助蓝/冷蓝(其余 P0 照查)
text = open(path, encoding='utf-8', errors='replace').read()
nl = [m.start() for m in re.finditer('\n', text)]

findings = []  # (sev, rule, msg, line, snippet)
def add(sev, rule, msg, pos, snippet=''):
    findings.append((sev, rule, msg, line_of(nl, pos), snippet.strip()[:80]))

# ---------- 解析 CSS 规则块 (selector { decls }) ----------
# 适用扁平 CSS(这类报告几乎都是扁平,无嵌套)
styles = [(m.start(1), m.group(1)) for m in re.finditer(r'<style[^>]*>(.*?)</style>', text, re.S|re.I)]
rules = []  # (selector_lower, decls_text, decls_abs_offset)
for base, css in styles:
    for rm in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sel = rm.group(1).strip().lower()
        rules.append((sel, rm.group(2), base + rm.start(2)))

# 内联 style="" (selector 视为元素标签)
inlines = []  # (tagname, decls_text, abs_offset)
for m in re.finditer(r'<(\w+)[^>]*\bstyle="([^"]*)"', text, re.I):
    inlines.append((m.group(1).lower(), m.group(2), m.start(2)))

def decls(block):
    for dm in re.finditer(r'([\w-]+)\s*:\s*([^;{}]+)', block):
        yield dm.group(1).strip().lower(), dm.group(2).strip(), dm.start(2)

# ---------- 检查 1: 间距禁 clamp/vw/vh ----------
SPACING = ('margin','margin-top','margin-bottom','margin-left','margin-right',
           'gap','row-gap','column-gap','padding','padding-top','padding-bottom',
           'padding-left','padding-right')
for sel, block, off in rules:
    is_body = bool(re.search(r'(^|[,\s])body([,\s{]|$)', sel))
    for prop, val, dpos in decls(block):
        if prop in SPACING and re.search(r'clamp\(|\dvw|\dvh', val):
            # 唯一豁免: body 的 padding 简写(侧边出血)
            if is_body and prop == 'padding':
                continue
            add('P0','间距禁clamp', f'{prop}:{val} —— 间距/padding/gap 必须固定 px,禁 clamp/vw/vh(仅 body 侧边出血豁免)[density.md·间距禁clamp]', off+dpos, f'{prop}: {val}')

# ---------- 检查 2: body/容器 max-width 居中(数据报告满宽出血) ----------
for sel, block, off in rules:
    if re.search(r'(^|[,\s])(body|\.container|\.wrap|\.wrapper|\.page|main)([,\s{]|$)', sel):
        has_mw = re.search(r'max-width\s*:', block)
        has_auto = re.search(r'margin[^:]*:\s*[^;]*auto', block)
        if has_mw and has_auto:
            add('P0','禁居中留白', f'选择器「{sel}」同时设 max-width + margin:auto → 宽屏两侧大片留白。数据报告满宽不居中[density.md·满宽出血]', off+has_mw.start(), 'max-width + margin auto')

# ---------- 检查 3: 颜色(冷蓝/indigo/品牌色/纯黑白) ----------
for m in re.finditer(r'#[0-9a-fA-F]{3,6}\b', text):
    hx = m.group(0).lower()
    if len(hx) not in (4,7):  # #rgb 或 #rrggbb
        continue
    if hx in INDIGO:
        add('P0','禁冷蓝', f'{hx} = Tailwind indigo(AI 默认色)[color.md·禁冷蓝]', m.start(), hx); continue
    if hx in BRAND_OK:
        continue   # STO 品牌橙/辅助蓝默认合法(STO 为默认风格;#005be5 虽属冷蓝带,此处单点豁免)
    if hx in ('#fff','#ffffff'):
        continue  # 白底 canvas / 反白徽章文字常合法,不报(避免误伤金标准)
    if hx in ('#000','#000000'):
        add('P2','纯黑提示', f'{hx} 纯黑 —— 建议改向主色相微调的近黑(非纯 #000)[color.md·中性禁纯黑白]', m.start(), hx); continue
    hsl = hex_to_hsl(hx)
    if hsl and not sto:
        hue, sat, lig = hsl
        if COLD(hue) and sat > 0.25 and 0.25 < lig < 0.88:
            add('P0','禁冷蓝', f'{hx}(hue≈{hue:.0f}) 落在冷蓝/靛蓝带,owner 反复否决[color.md·禁冷蓝]', m.start(), hx)
# oklch / hsl 函数式(STO 品牌模式豁免冷蓝)
if not sto:
    for m in re.finditer(r'oklch\(\s*[\d.]+%?\s+([\d.]+)\s+([\d.]+)', text):
        chroma, hue = float(m.group(1)), float(m.group(2))
        if COLD(hue) and chroma > 0.04:
            add('P0','禁冷蓝', f'oklch hue≈{hue:.0f} chroma {chroma} 落在冷蓝带[color.md·禁冷蓝]', m.start(), m.group(0))
    for m in re.finditer(r'hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%', text):
        hue, sat = float(m.group(1)), float(m.group(2))
        if COLD(hue) and sat > 25:
            add('P0','禁冷蓝', f'hsl hue {hue:.0f} sat {sat}% 落在冷蓝带[color.md·禁冷蓝]', m.start(), m.group(0))

# ---------- 检查 4: 禁用主字体 Inter/Roboto/Arial ----------
for m in re.finditer(r'font-family\s*:\s*([^;{}]+)', text, re.I):
    first = m.group(1).split(',')[0].strip().strip('\'"').lower()
    if first in BAD_FONTS:
        add('P0','禁默认字体', f'主字体 = {first}(AI 默认),换非默认字体[typography.md][禁 {first}]', m.start(), m.group(1)[:60])

# ---------- 检查 4b: 用了 DIN 数字却没内联 D-DIN 字面(Windows 会露馅) ----------
uses_din = re.search(r"['\"]D-DIN['\"]|['\"]DIN Alternate['\"]|var\(\s*--num", text, re.I)
has_face = re.search(r"@font-face[^}]*?font-family\s*:\s*['\"]D-DIN['\"]", text, re.I|re.S) \
           or re.search(r"sto-din-(?:face|400|700)", text, re.I)
if uses_din and not has_face:
    m = uses_din
    add('P1','DIN 未内联', '用了 DIN/--num 数字字体但没内联 D-DIN @font-face,Windows 会降级露馅;把 fonts/sto-din-face.html 整段复制进 <head>[base.md·字体加载]', m.start(), m.group(0)[:60])

# ---------- 检查 5: 卡片白名单(>2 处卡网格, 红黑榜豁免需人工确认) ----------
card_grids = []
for m in re.finditer(r'class="([^"]*\b(?:cards|findings)\b[^"]*)"', text):
    card_grids.append(m.start())
exempt = re.search(r'红榜|黑榜|红旗|黑旗|rank|leaderboard|榜', text)
if len(card_grids) > 2:
    note = '(检测到红黑榜/排行榜关键词,确认是否走白名单豁免)' if exempt else ''
    add('P1','卡片白名单', f'发现 {len(card_grids)} 处卡网格(.cards/.findings),白名单只允许 2 卡位(结论卡+KPI卡){note}[structure-and-hierarchy.md·卡片白名单]', card_grids[2], f'{len(card_grids)} card-grids')

# ---------- 检查 5b (P0): 指标卡网格全屏每排 ≥4 列(总卡 ≥4 时禁 repeat(2/3,1fr) 当桌面默认) ----------
# owner 硬规则(density.md·每排卡片数下限):一个模块里的指标卡/KPI/概览卡网格,自适应全屏时每排 ≥4 列;
# 总卡 ≥4 却用 repeat(2,1fr)/repeat(3,1fr) 当桌面默认 = 卡被拉宽、稀疏廉价。只查桌面默认(剥掉 @media),
# 且只在该网格"真有 ≥4 个直接子卡"时才报(plan/策略等 3 项网格不误伤);结论/诊断卡按 conclusion-layer 豁免。
def _strip_media(css):
    out, i, n = [], 0, len(css)
    while i < n:
        am = css.find('@media', i)
        if am < 0:
            out.append(css[i:]); break
        out.append(css[i:am])
        ob = css.find('{', am)
        if ob < 0:
            break
        depth, j = 1, ob + 1
        while j < n and depth:
            if css[j] == '{': depth += 1
            elif css[j] == '}': depth -= 1
            j += 1
        i = j
    return ''.join(out)

def _count_direct_children(html, start):
    depth, count, i, n = 0, 0, start, len(html)
    VOID = re.compile(r'(br|hr|img|input|meta|link|source|col|area|base|wbr)\b', re.I)
    while i < n:
        lt = html.find('<', i)
        if lt < 0: break
        gt = html.find('>', lt)
        if gt < 0: break
        tag = html[lt+1:gt].strip()
        if tag.startswith('/'):
            if depth == 0: break          # 容器自身的闭合标签
            depth -= 1
        elif tag.startswith('!'):
            pass                          # 注释 / doctype
        elif tag.endswith('/') or VOID.match(tag):
            if depth == 0: count += 1     # 顶层自闭合/空元素子节点
        else:
            if depth == 0: count += 1
            depth += 1
        i = gt + 1
    return count

desktop_css = ''.join(_strip_media(css) for _b, css in styles)
_narrow, _seen = [], set()
for rm in re.finditer(r'([^{}]+)\{([^{}]*)\}', desktop_css):
    g = re.search(r'grid-template-columns\s*:\s*repeat\(\s*([23])\s*,\s*1fr\s*\)', rm.group(2), re.I)
    if not g:
        continue
    cols = int(g.group(1))
    for cm in re.finditer(r'\.([\w-]+)', rm.group(1)):
        _narrow.append((cm.group(1), cols))
for cls, cols in _narrow:
    if cls in _seen:
        continue
    _seen.add(cls)
    if re.search(r'diag|concl|finding|summary|deck|note', cls, re.I):
        continue   # 结论/诊断/摘要网格按 conclusion-layer 豁免(≤3 条可并列)
    cre = re.compile(r'<\w+\b[^>]*class="[^"]*(?<![\w-])' + re.escape(cls) + r'(?![\w-])[^"]*"[^>]*>', re.I)
    for em in cre.finditer(text):
        nkids = _count_direct_children(text, em.end())
        if nkids >= 4:
            add('P0','指标卡每排<4',
                f'.{cls} 桌面排 {cols} 列却有 {nkids} 张卡 —— owner 硬规则:总卡 ≥4 时每排 ≥4 列,禁 repeat({cols},1fr) 当桌面默认(降列只在 @media 窄屏断点做)[density.md·每排卡片数下限]',
                em.start(), f'repeat({cols},1fr) × {nkids} cards')
            break   # 每类报一次即可

# ---------- 检查 6: var(--accent) 过度使用(≤2 可见/屏, 原始用量阈值 6) ----------
acc = [m.start() for m in re.finditer(r'var\(--accent\)', text)]
if len(acc) > 6:
    add('P1','accent过用', f'var(--accent) 用了 {len(acc)} 次(原始),目标每屏 ≤2 处可见,核查是否铺太多[color.md·--accent≤2]', acc[6], f'{len(acc)}×')

# ---------- 检查 7: emoji 当图标(h*/button/li/.icon 内) ----------
for m in re.finditer(r'<(h[1-6]|button|li)\b[^>]*>(.*?)</\1>', text, re.S|re.I):
    if EMOJI.search(m.group(2)):
        add('P1','禁emoji图标', f'<{m.group(1)}> 内出现 emoji,图标用内联 SVG[icons.md][禁 emoji 图标]', m.start(), m.group(2)[:40])
for m in re.finditer(r'class="[^"]*icon[^"]*"[^>]*>([^<]{0,8})', text, re.I):
    if EMOJI.search(m.group(1)):
        add('P1','禁emoji图标', f'.icon 内出现 emoji,换内联 SVG[icons.md]', m.start(), m.group(1))

# ---------- 检查 7b (P0): 无宽高 svg + 缺安全网 → 图标可能撑满全屏(「巨型铃铛」翻车) ----------
# 只有 viewBox、没 width/height 的内联 svg,一旦没 CSS 命中它,浏览器按父容器 100% 宽渲染 → 单图标吃满全屏。
# base.md 的 `svg:not([width]){width:1em}` 安全网兜底;跨 agent 复刻金标准时常把这条连同图标 CSS 一起漏掉。
# 判定:存在「开标签里没 width= 也没 style 含 width」的 svg + 全文找不到安全网 → P0。两条件同时满足才报,误杀低。
_has_net = re.search(r'svg:not\(\s*\[\s*width\s*\]\s*\)', text)
if not _has_net:
    for m in re.finditer(r'<svg\b([^>]*)>', text, re.I):
        attrs = m.group(1)
        if not re.search(r'\bwidth\s*=', attrs) and not re.search(r'style\s*=\s*"[^"]*width', attrs, re.I):
            add('P0','svg无宽高无安全网',
                'svg 只有 viewBox、没 width/height,且全文缺 base.md 的 `svg:not([width]){width:1em;height:1em}` 安全网 → CSS 一旦漏写,图标会按父容器 100% 宽撑满全屏(巨型铃铛翻车)。修法二选一:① 给 svg 加 width/height 属性;② 把安全网复制进 <style>[icons.md·尺寸铁律 / base.md·图标安全网]',
                m.start(), m.group(0)[:60])
            break  # 报一次即可,避免刷屏

# ---------- 检查 7c (P0): 彩虹卡边框(每张卡不同色顶边/左边)= AI 仪表盘签名 ----------
# 最典型 AI 生成物:.kpi-card.brand{border-top:3px solid var(--brand)} / .green{...--green} / .red / .blue —— 每卡一条不同色粗边。
# STO 金标准:卡统一中性,承载好坏靠语义色+标签,唯一染色卡是异常主角(.mc.focus 淡红底)。金标准 border-top/left 只用中性 --border(0 个彩色边),
# 所以「border-top/left 出现 ≥2 个不同的强调色」几乎必然是彩虹卡,误杀极低。
_NEUTRAL = re.compile(r'border|line|divider|bg|surface|text|muted|grey|gray|shadow|hairline', re.I)
_ACCENT_KW = re.compile(r'brand|accent|trend|green|red|blue|orange|success|danger|warning|warn|info|pos\b|neg\b|positive|negative|up\b|down\b|alert|primary', re.I)
def _is_accent_color(tok):
    vm = re.match(r'var\(\s*(--[a-z0-9-]+)', tok, re.I)
    if vm:
        nm = vm.group(1)
        if _NEUTRAL.search(nm): return False
        return bool(_ACCENT_KW.search(nm))
    hm = re.match(r'#[0-9a-f]{3,6}$', tok, re.I)
    if hm:
        hsl = hex_to_hsl(tok)
        if not hsl: return False
        _h, s, l = hsl
        return s > 0.25 and 0.15 < l < 0.85          # 饱和且非极亮极暗 = 强调色
    return False
_rainbow = {}
for m in re.finditer(r'border-(?:top|left)\s*:\s*([^;}]+)', text, re.I):
    cm = re.search(r'var\(\s*--[a-z0-9-]+\s*\)|#[0-9a-f]{3,6}\b', m.group(1), re.I)
    if cm and _is_accent_color(cm.group(0)):
        _rainbow.setdefault(cm.group(0).lower().replace(' ',''), m.start())
if len(_rainbow) >= 2:
    _cols = sorted(_rainbow); _first = min(_rainbow.values())
    add('P0','彩虹卡边框',
        f'卡顶边/左边用了 {len(_rainbow)} 种不同强调色({", ".join(_cols[:4])})= AI 仪表盘签名(每卡一色彩虹边)。STO 卡统一中性,好坏靠语义色+状态标签承载,唯一染色卡=异常主角(淡红底 .mc.focus);删掉每卡的彩色 border-top/left,照抄金标准 .mc 卡(微灰底 #FAFBFC + 1px 中性描边 + 卡内 sparkline)[color.md·禁彩虹卡 / structure-and-hierarchy.md·KPI 卡抄 .mc]',
        _first, ", ".join(_cols[:4]))

# ---------- 检查 8: 表格竖向分割线缺失 ----------
if re.search(r'<table', text, re.I) and not re.search(r'border-right\s*:', text):
    p = re.search(r'<table', text, re.I).start()
    add('P1','表格竖线', '页面有 <table> 但全局无 border-right → 缺竖向分割线(全表竖向网格默认必做)[data-presentation.md·全表竖向分割线]', p, '<table> 无 border-right')

# ---------- 检查 8b: 斑马纹方向写反(首行被染灰,贴着灰表头分不开) ----------
for m in re.finditer(r'tr:nth-child\(\s*odd\s*\)\s*\{[^}]*background\s*:\s*var\(--zebra\)', text, re.I):
    add('P1','斑马纹起白', '斑马纹染在 nth-child(odd) → 紧贴表头的第一行被染灰、与灰表头糊在一起;改染 nth-child(even),奇数行(含首行)锁纯白 #FFFFFF[data-presentation.md·斑马纹隔行]', m.start(), 'nth-child(odd) 染 --zebra')

# ---------- 检查 9 (P2): transition:all / em-dash 连接符 ----------
for m in re.finditer(r'transition\s*:\s*all\b', text, re.I):
    add('P2','禁transition-all', 'transition:all → 只动 transform/opacity[motion.md]', m.start(), 'transition: all')

# ---------- 检查 10 (P0): 灰底页缺白底模块面板 (STO 看板基本骨架) ----------
# 规则:灰底(--bg)数据页上,每个模块的「标题+内容」要整体包一张白底面板 .mod/.sto-modpanel(白底·圆角·padding16)。
# 弱模型最高频翻车 = 卡/表直接裸铺灰底、零白面承托。这里只机械判"灰底页是否存在白底模块面板";
# 更细的"白套白 / 模块没整体包"留给 SKILL 出门前自检 #12(class 名多变,硬判会误伤)。
def _is_white(v):
    return bool(re.search(r'#fff\b|#ffffff\b|\bwhite\b', v.lower()))
def _is_light_neutral(hx):
    # 浅灰底判定:用 RGB 通道差(绝对 chroma)而非 HLS 饱和度。
    # HLS 对极浅色会把饱和度算得虚高(#f5f7fa 实测 S≈0.33),用它判灰会漏掉所有 STO 实际底色;
    # 通道差才稳:#f5f7fa→delta=5。阈值对齐 SKILL #7「L≥96%、chroma≤0.03」。
    h = hx.lstrip('#')
    if len(h) == 3:
        h = ''.join(c*2 for c in h)
    if len(h) != 6:
        return False
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    light = (max(r, g, b) + min(r, g, b)) / 2 >= 0.90 * 255   # L≥90%
    near_neutral = (max(r, g, b) - min(r, g, b)) <= 14         # chroma≈≤0.05
    return light and near_neutral
# --bg 取值:STO 默认灰;仅可选 Figma 风格把 --bg 设白时豁免(非灰底页,不检)
bg_val = None
for _sel, _block, _off in rules:
    for _p, _v, _dp in decls(_block):
        if _p == '--bg':
            bg_val = _v.strip().lower()
bg_is_grey = (bg_val is None) or (not _is_white(bg_val))
# body 是否走灰底(var(--bg) 且 --bg 为灰,或直接给浅灰 hex)
grey_page, body_pos = False, None
for _sel, _block, _off in rules:
    if re.search(r'(^|[,\s])body([,\s{]|$)', _sel):
        body_pos = _off
        _bgm = re.search(r'background(?:-color)?\s*:\s*([^;{}]+)', _block)
        if _bgm:
            _v = _bgm.group(1).strip().lower()
            if 'var(--bg)' in _v and bg_is_grey:
                grey_page = True
            else:
                _hx = re.search(r'#[0-9a-f]{3,6}\b', _v)
                if _hx and not _is_white(_v) and _is_light_neutral(_hx.group(0)):
                    grey_page = True   # 直接写浅灰 hex(非 var(--bg))也算灰底页
if grey_page:
    PANEL_SEL = re.compile(r'\.(?:sto-)?mod(?:panel)?\b|\.panel\b')
    panel_present = False
    for _sel, _block, _off in rules:
        if PANEL_SEL.search(_sel):
            _bgm = re.search(r'background(?:-color)?\s*:\s*([^;{}]+)', _block)
            if _bgm and ('var(--surface)' in _bgm.group(1).lower() or _is_white(_bgm.group(1))) \
               and 'border-radius' in _block and 'padding' in _block:
                panel_present = True; break
    if not panel_present:
        add('P0','缺白底模块面板',
            '灰底页(--bg)未见白底模块面板 .mod/.sto-modpanel(白底·圆角·padding16)。每个模块的「标题+内容」要整体包一张白面 = STO 看板基本骨架,禁卡/表裸铺灰底[base.md·模块白底面板][density.md]',
            body_pos or 0, 'grey bg, no .mod panel')

# ---------- 检查 11 (P1·保守软提示): 疑似榜单数据未走排名钻取型画法 ----------
# 弱模型最高频路由翻车 = 拿到榜单/排名数据却套成"指标卡+多表"日报。只机械判可检测的一小片:
# 标题/表头出现强榜单信号(排行榜/降幅榜/红黑榜/TOP N / 表头"排名·名次") 但全页无排名画法标记
# (红圈排名 .rk / 区域 tab .rnav / 降幅条 .dbar / .rank)→ P1 提示走①排名钻取型。
# 关键词门控 + 仅 P1 不阻断,误报代价低;"根本没做表"的路由错检测不到(留给 SKILL 自检 #13)。
_head_txt = ' '.join(re.findall(r'<title[^>]*>(.*?)</title>', text, re.S|re.I)
                     + re.findall(r'<h[1-3][^>]*>(.*?)</h[1-3]>', text, re.S|re.I))
_th_txt = ' '.join(re.findall(r'<th[^>]*>(.*?)</th>', text, re.S|re.I))
rank_signal_pos = None
m_h = re.search(r'排行榜|排行|降幅榜|增幅榜|红黑榜|榜单|TOP\s?\d+', _head_txt)
m_th = re.search(r'排名|名次|排行', _th_txt)
if m_h or m_th:
    ranking_craft = re.search(r'class="[^"]*\b(?:rk|rnav|dbar|rank|medal)\b', text) or re.search(r'排序条|奖牌', text)
    if not ranking_craft:
        _pos = (re.search(r'<title', text, re.I) or re.search(r'<th', text, re.I))
        add('P1','疑似榜单未走排名画法',
            '标题/表头含榜单信号(排行/降幅榜/红黑榜/TOP N/排名·名次)但全页无排名画法(红圈排名 .rk / 区域 tab .rnav / 降幅条 .dbar)。榜单/排名数据应走①排名钻取型,照抄 example-sto-ranking;别套成「指标卡+多表」日报[structure-and-hierarchy.md·三原型]',
            _pos.start() if _pos else 0, 'ranking data?')

# ---------- 检查 12 (P1·软提示): 头部核心结论疑似未包结论卡 ----------
# owner 2026-06-18:头部核心结论必须"一直"包在有底色的结论卡(.sto-diag/.diag/.verdict)里,
# 禁裸排成灰底段落(实测翻车:叙述型 AI 总结被当 <p> 直接铺灰底)。机械只做保守判:
# 出现结论关键词但全页找不到任何结论卡 class → P1 软提示(模型若用自定义白卡 class 会误报,故仅 P1)。
_concl_kw = re.search(r'核心结论|核心发现|核心观点|AI\s*总结|结论先行', text)
if _concl_kw:
    has_concl_card = re.search(r'class="[^"]*\b(?:sto-diag|diag|verdict|vd|finding|fd\d|concl)', text)
    if not has_concl_card:
        add('P1','头部结论疑似无卡',
            '出现"核心结论/核心发现/AI 总结"等内容但全页无结论卡 class(.sto-diag/.diag/.verdict)。头部核心结论必须一直包在有底色的结论卡里(淡橙底诊断卡优先),禁裸排成灰底普通段落[conclusion-layer.md·头部结论永远有底色卡]',
            _concl_kw.start(), '核心结论 无卡容器?')

# ---------- 检查 13 (P0): masthead 头部 meta 窄屏未翻横排(竖列每条独占一行拖留白) ----------
# owner 2026-06-18:.mh-meta 桌面竖列(flex-direction:column),窄屏 @media 必须翻成 row(flex-wrap)贴左紧排。
# 只查规范类名 .mh-meta:设了 column 却全页找不到任何 row 覆盖 → 窄屏每条独占一行、右侧大片留白。
# (断点无关:row 覆盖在 760 还是 480 都行;模型若另起类名不检,接受静态扫描的天花板)
mh_col_pos, mh_has_row = None, False
for sel, block, off in rules:
    if re.search(r'\.mh-meta\b', sel):
        for prop, val, dp in decls(block):
            if prop == 'flex-direction':
                v = val.strip().lower()
                if v.startswith('column') and mh_col_pos is None:
                    mh_col_pos = off + dp
                elif v.startswith('row'):
                    mh_has_row = True
if mh_col_pos is not None and not mh_has_row:
    add('P0','masthead未翻横排',
        '.mh-meta 设了 flex-direction:column 却全页无任何规则把它翻成 row —— 窄屏头部 meta(报告日/对比口径/规则版本…)每条独占一行、右侧大片留白。在 @media(max-width:760px) 加 .mh-meta{flex-direction:row;flex-wrap:wrap;align-items:baseline;justify-content:flex-start;text-align:left}贴左紧排[structure-and-hierarchy.md·响应式 masthead]',
        mh_col_pos, 'mh-meta column 未翻 row')

# ---------- 检查 14 (P0): 模块标题右侧统计组 margin-left:auto(换行后黏右浪费左侧) ----------
# owner 2026-06-18:.sec-stats 靠外层 .sechead 的 justify-content:space-between 定位,切勿写 margin-left:auto;
# 否则窄屏换行后整组黏在右边、左侧大片留白(正是 owner 反馈的根因)。仅查规范类名 .sec-stats。
for sel, block, off in rules:
    if 'sec-stats' in sel:
        m = re.search(r'margin-left\s*:\s*auto|margin\s*:\s*[^;{}]*\bauto\b', block, re.I)
        if m:
            add('P0','统计组黏右',
                '.sec-stats 用了 margin-left/auto 边距 —— 窄屏换行后整组黏右、左侧留白。删掉它,改靠外层 .sechead 的 justify-content:space-between 定位(换行后单项自动贴左)[density.md·§C 内联统计组]',
                off + m.start(), m.group(0))

# ---------- 检查 15 (P1): 头部灰导语段复述结论卡数值(§3 ③ 的机械兜底) ----------
# v76 §3③/自检#10 已有文字规则:masthead 副标题下/结论卡上方的灰概述若与结论卡重复 → 删。
# 弱模型仍高频翻车(owner v75 实测),这里加机械检测:取"核心结论/核心发现"标记之前的所有 <p>
# (=导语/概述段;标题是 h*、meta 是 div/span,不会是 <p>),与标记之后(结论区)各自抽"有辨识度的数",
# 重叠 ≥2 个 → P1。仅 P1 不阻断;门控在"有结论标记 + 标记前有 <p>",干净 masthead(无导语 <p>)不触发。
def _distinct_nums(s):
    out = set()
    for nm in re.finditer(r'\d[\d,]*(?:\.\d+)?%?', s):
        tok = nm.group(0)
        norm = tok.replace(',', '')
        digits = re.sub(r'[.%]', '', norm)
        if '%' in tok or '.' in norm or len(digits) >= 2:  # 1 位整数易碰撞,不计
            out.add(norm.rstrip('%'))
    return out
_concl = re.search(r'核心结论|核心发现', text)
if _concl:
    head_html = text[:_concl.start()]
    lead_paras = ' '.join(re.sub(r'<[^>]+>', ' ', p) for p in re.findall(r'<p\b[^>]*>(.*?)</p>', head_html, re.S|re.I))
    if lead_paras.strip():
        concl_txt = re.sub(r'<[^>]+>', ' ', text[_concl.start():])
        overlap = _distinct_nums(lead_paras) & _distinct_nums(concl_txt)
        if len(overlap) >= 2:
            _pp = re.search(r'<p\b', head_html, re.I)
            sample = ', '.join(sorted(overlap)[:4])
            add('P1','头部导语复述结论',
                f'masthead 标题下的灰导语/概述段复述了结论卡已给的数({sample} 等 {len(overlap)} 个同值出现在导语和结论两处)。导语与结论卡职能相同 = 头部双写;删掉导语段(数只留结论卡)或剥掉其重复数值,仅保留口径/范围等结论外独有信息[conclusion-layer.md §3③·masthead 概述去重]',
                _pp.start() if _pp else 0, sample)

# ---------- 输出 ----------
order = {'P0':0,'P1':1,'P2':2}
findings.sort(key=lambda f: (order[f[0]], f[3]))
counts = {'P0':0,'P1':0,'P2':0}
for f in findings: counts[f[0]] += 1

if as_json:
    print(json.dumps([{'severity':s,'rule':r,'message':m,'line':ln,'snippet':sn}
                      for s,r,m,ln,sn in findings], ensure_ascii=False, indent=2))
else:
    C = {'P0':'\033[91m','P1':'\033[93m','P2':'\033[90m','x':'\033[0m','b':'\033[1m'}
    if not findings:
        print(f"{C['b']}✓ 通过{C['x']}  {path}  —— 无机械违规")
    else:
        print(f"{C['b']}{path}{C['x']}")
        for s,r,m,ln,sn in findings:
            print(f"  {C[s]}{s}{C['x']} L{ln:<4} [{r}] {m}")
        print(f"\n  {C['P0']}P0={counts['P0']}{C['x']}  {C['P1']}P1={counts['P1']}{C['x']}  {C['P2']}P2={counts['P2']}{C['x']}"
              + ("  → 有 P0,必须修后再交" if counts['P0'] else "  → 无 P0(P1/P2 建议修)"))

sys.exit(1 if counts['P0'] else 0)

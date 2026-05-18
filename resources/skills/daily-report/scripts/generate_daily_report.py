#!/usr/bin/env python3
"""
生成日报 HTML 页面
从 SAI CLI 获取业务数据和过程目标数据，生成可编辑的日报 HTML 页面
"""

import argparse
import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path


SAI_CLI_PATH = "/Users/sto/Documents/project/robot/sto-claw/resources/bin/darwin-arm64/sai"


def run_sai_cli(command: str) -> dict:
    """执行 SAI CLI 命令并返回 JSON 结果"""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=60
        )
        if result.returncode != 0:
            print(f"CLI 错误：{result.stderr}")
            return {}
        
        # 解析 JSON 输出
        output = result.stdout.strip()
        # 处理可能的 markdown 格式
        if output.startswith("```json"):
            output = output.split("```json")[1].split("```")[0].strip()
        elif output.startswith("```"):
            output = output.split("```")[1].split("```")[0].strip()
        
        return json.loads(output)
    except Exception as e:
        print(f"执行 CLI 失败：{e}")
        return {}


def get_business_volume_data(date: str) -> dict:
    """获取业务量数据"""
    # 查询全国业务量数据
    cmd = f'{SAI_CLI_PATH} metric biznum query --params \'{{"statDate": "{date}", "orgDimension": "NATION", "dateDimension": "MTD", "targetOrgCode": "V000000"}}\''
    return run_sai_cli(cmd)


def get_process_target_data(date: str) -> dict:
    """获取过程目标数据"""
    # 查询全国过程目标数据
    cmd = f'{SAI_CLI_PATH} policy processVolume_targetList query --params \'{{"statDate": "{date}", "orgDimension": "NATION", "targetOrgLevel": "POLICY_PROVINCE"}}\''
    return run_sai_cli(cmd)


def generate_html(business_data: dict, process_data: dict, output_path: str):
    """生成日报 HTML 页面"""
    
    today = datetime.now().strftime("%Y-%m-%d")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 提取业务量数据
    biz_num = business_data.get("data", {}).get("bizNum", "0") if business_data.get("data") else "0"
    biz_rate = business_data.get("data", {}).get("completeRate", "0%") if business_data.get("data") else "0%"
    
    # 提取过程目标数据
    process_items = []
    if process_data.get("data") and isinstance(process_data["data"], list):
        process_items = process_data["data"][:10]  # 取前 10 条
    
    # 生成表格行
    process_rows = ""
    for item in process_items:
        org_name = item.get("orgName", "未知")
        target_vol = item.get("targetVolume", "0")
        actual_vol = item.get("actualVolume", "0")
        rate = item.get("completeRate", "0%")
        gap = item.get("gap", "0")
        
        # 根据达成率设置颜色
        rate_color = "#00aa00" if float(rate.replace("%", "")) >= 100 else "#cc0000"
        
        process_rows += f"""
        <tr>
            <td>{org_name}</td>
            <td>{target_vol}</td>
            <td>{actual_vol}</td>
            <td style="color: {rate_color}; font-weight: bold;">{rate}</td>
            <td>{gap}</td>
        </tr>"""
    
    html_content = f"""<!DOCTYPE html>
<html data-claw-editable="true" data-claw-version="1.0" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="claw:save-mode" content="manual">
  <meta name="claw:save-dir" content="{{{{workspace}}}}/{today}">
  <meta name="claw:version-format" content="v{{{{N}}}}">
  <meta name="claw:filename" content="daily-report">
  <title>{today} 日报</title>
  <style>
    :root {{
      --primary-color: #ff6600;
      --primary-gradient: linear-gradient(180deg, #ff8833 0%, #ff6600 100%);
      --border-color: #ff9955;
      --negative-color: #cc0000;
      --positive-color: #00aa00;
      --bg-gray: #f5f5f5;
    }}
    
    * {{
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }}
    
    body {{
      font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
      background: var(--bg-gray);
      padding: 20px;
      line-height: 1.6;
    }}
    
    .claw-container {{
      max-width: 1280px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      padding: 40px;
    }}
    
    h1 {{
      font-size: 32px;
      color: #333;
      margin-bottom: 10px;
      background: var(--primary-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }}
    
    .subtitle {{
      color: #666;
      font-size: 14px;
      margin-bottom: 30px;
    }}
    
    .section {{
      margin-bottom: 40px;
    }}
    
    .section-title {{
      font-size: 24px;
      color: #333;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 3px solid var(--primary-color);
    }}
    
    .metrics-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }}
    
    .metric-card {{
      background: var(--bg-gray);
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      border: 2px solid var(--border-color);
    }}
    
    .metric-label {{
      font-size: 14px;
      color: #666;
      margin-bottom: 10px;
    }}
    
    .metric-value {{
      font-size: 36px;
      font-weight: bold;
      color: var(--primary-color);
    }}
    
    table {{
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }}
    
    th, td {{
      padding: 12px 15px;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
    }}
    
    th {{
      background: var(--primary-gradient);
      color: white;
      font-weight: 600;
    }}
    
    tr:hover {{
      background: #fafafa;
    }}
    
    .footer {{
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e0e0e0;
      color: #999;
      font-size: 12px;
      text-align: center;
    }}
    
    [data-editable="true"],
    [data-editable="text"],
    [data-editable="cell"],
    [data-editable="rich"] {{
      outline: none;
    }}
    
    [data-editable="true"]:hover,
    [data-editable="text"]:hover,
    [data-editable="cell"]:hover,
    [data-editable="rich"]:hover {{
      background: #fff3e6;
      cursor: text;
    }}
    
    [data-editable="true"]:focus,
    [data-editable="text"]:focus,
    [data-editable="cell"]:focus,
    [data-editable="rich"]:focus {{
      background: #ffe6cc;
      box-shadow: 0 0 0 2px var(--primary-color);
      border-radius: 4px;
    }}
  </style>
</head>
<body class="claw-page">
  <main class="claw-container" data-editable="true">
    <!-- 标题 -->
    <h1 data-editable="text">{today} 业务日报</h1>
    <p class="subtitle" data-editable="text">生成时间：{timestamp} | 数据来源：政策管家系统</p>
    
    <!-- 关键指标 -->
    <div class="section">
      <h2 class="section-title" data-editable="text">📊 关键业务指标</h2>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">MTD 业务量</div>
          <div class="metric-value" data-editable="cell">{biz_num}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">目标达成率</div>
          <div class="metric-value" data-editable="cell">{biz_rate}</div>
        </div>
      </div>
    </div>
    
    <!-- 过程目标达成 -->
    <div class="section">
      <h2 class="section-title" data-editable="text">🎯 过程目标达成（省区 TOP10）</h2>
      <table>
        <thead>
          <tr>
            <th>省区</th>
            <th>目标量</th>
            <th>实际量</th>
            <th>达成率</th>
            <th>缺口</th>
          </tr>
        </thead>
        <tbody>
          {process_rows}
        </tbody>
      </table>
    </div>
    
    <!-- 文字描述 -->
    <div class="section">
      <h2 class="section-title" data-editable="text">📝 今日总结</h2>
      <p data-editable="rich">
        今日整体业务运行情况良好，各区域目标达成情况如上表所示。
        请重点关注达成率较低的省区，及时采取措施提升业绩。
      </p>
    </div>
    
    <!-- 页脚 -->
    <div class="footer">
      生成时间：{timestamp} | 数据来源：政策管家系统 | 第 1 / 1 页
    </div>
  </main>
  
  <script>
    // 启用内容编辑功能
    document.querySelectorAll('[data-editable]').forEach(el => {{
      el.contentEditable = el.dataset.editable === 'false' ? 'false' : 'true';
    }});
  </script>
</body>
</html>"""
    
    # 写入文件
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"日报已生成：{output_path}")


def main():
    parser = argparse.ArgumentParser(description='生成日报 HTML 页面')
    parser.add_argument('--date', type=str, default='', 
                        help='统计日期 (yyyyMMdd)，不传则使用今天')
    parser.add_argument('--output', type=str, default='',
                        help='输出文件路径')
    
    args = parser.parse_args()
    
    # 确定日期
    if args.date:
        stat_date = args.date
    else:
        stat_date = datetime.now().strftime("%Y%m%d")
    
    # 确定输出路径
    if args.output:
        output_path = args.output
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = str(Path.home() / f".openclaw/workspace/daily_report_{timestamp}.html")
    
    print(f"正在查询数据 (日期：{stat_date})...")
    
    # 获取数据
    business_data = get_business_volume_data(stat_date)
    process_data = get_process_target_data(stat_date)
    
    # 生成 HTML
    generate_html(business_data, process_data, output_path)
    
    # 自动打开
    subprocess.run(['open', output_path])


if __name__ == '__main__':
    main()

# CLI Report Generator Skill

📊 从 CLI 数据源自动生成 HTML 报告页面

## 快速开始

### 1. 配置你的 CLI 命令

复制示例配置并修改：

```bash
cp configs/network-report.json.example configs/network-report.json
```

编辑 `configs/network-report.json`：

```json
{
  "cliCommand": "your-cli-tool get-stats --format json",
  "workingDir": "/path/to/cli",
  "template": "assets/network-report-template.html",
  "outputDir": "reports"
}
```

### 2. 测试生成

```bash
cd /Users/sto/.openclaw/skills/cli-report-generator
uv run python scripts/generate_report.py --config configs/network-report.json
```

### 3. 设置定时任务

使用 OpenClaw cron 设置每日自动生成：

```bash
openclaw cron add --job '{
  "name": "daily-network-report",
  "schedule": {"kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai"},
  "payload": {"kind": "systemEvent", "text": "📊 生成每日网络报告"}
}'
```

## 文件结构

```
cli-report-generator/
├── SKILL.md                      # 技能说明（自动加载）
├── configs/
│   └── network-report.json.example  # 配置示例
├── scripts/
│   ├── generate_report.py        # 主生成脚本
│   └── parse_network_data.py     # 数据解析脚本
├── assets/
│   └── network-report-template.html  # HTML 模板
└── references/
    └── cron-setup.md             # Cron 设置指南
```

## 自定义模板

1. 复制现有模板：`cp assets/network-report-template.html assets/my-template.html`
2. 编辑模板中的 `{{variables}}`
3. 修改配置指向新模板

## 下一步

- 阅读 `SKILL.md` 了解完整功能
- 阅读 `references/cron-setup.md` 设置自动化
- 根据你的 CLI 工具修改 `scripts/parse_network_data.py`

---
name: cli-report-generator
description: Generate HTML report pages from CLI data sources with customizable templates and scheduled automation. Use when: (1) Creating daily/periodic reports from command-line data, (2) Need HTML visualization of CLI output, (3) Setting up cron jobs for automated report generation, (4) Building reusable report templates for recurring data snapshots.
---

# CLI Report Generator

Automated HTML report generation from CLI data sources with template support and scheduled execution.

## Quick Start

### Generate a Report

```bash
# Manual generation
uv run python scripts/generate_report.py \
  --cli-command "your-cli-command --json" \
  --template assets/network-report-template.html \
  --output reports/daily-report.html
```

### Schedule Daily Reports

```bash
# Add to crontab (runs at 9 AM daily)
0 9 * * * cd /Users/sto/.stoclaw/openclaw/skills/cli-report-generator && uv run python scripts/generate_report.py --config config.json
```

## 输出约束

生成文件后：
- 在回答中用 Markdown 链接输出**绝对路径**：`[report.html](file:///绝对路径)`（禁止 `./.claw-output/...` 或 `[report.html](report.html)`）
- **绝对不要**执行 `open` 命令或自动唤起浏览器
- **绝对不要**说"已在浏览器中打开"、"已为您打开"等暗示已自动打开的话
- 对话界面会自动识别文件路径并支持右侧预览

## Core Workflow

### 1. Define Your CLI Data Source

Create a config file specifying how to fetch data:

```json
{
  "name": "network-report",
  "cliCommand": "your-cli-tool get-network-stats --format json",
  "workingDir": "/path/to/cli/tool",
  "parseScript": "scripts/parse_network_data.py"
}
```

### 2. Create or Customize Template

Templates are HTML files with `{{placeholders}}` for dynamic data:

```html
<table>
  <tr>
    <td>{{region}}</td>
    <td>{{volume}}</td>
    <td>{{growth}}</td>
  </tr>
</table>
```

See `assets/network-report-template.html` for a complete example.

### 3. Generate Report

```bash
uv run python scripts/generate_report.py --config config.json
```

### 4. (Optional) Schedule with Cron

Use OpenClaw's cron tool or system crontab:

```bash
# OpenClaw cron (recommended)
openclaw cron add --job '{
  "name": "daily-network-report",
  "schedule": {"kind": "cron", "expr": "0 9 * * *"},
  "payload": {
    "kind": "systemEvent",
    "text": "Generate daily network report from CLI data"
  }
}'
```

## Scripts

### `generate_report.py`

Main report generation script.

**Usage:**

```bash
uv run python scripts/generate_report.py \
  --cli-command "cli-tool data --json" \
  --template assets/template.html \
  --output reports/output.html \
  [--working-dir /path] \
  [--parse-script scripts/parser.py]
```

**Options:**

- `--cli-command`: CLI command to fetch data (required)
- `--template`: HTML template file path (required)
- `--output`: Output HTML file path (required)
- `--working-dir`: Working directory for CLI command
- `--parse-script`: Custom data parsing script
- `--config`: JSON config file (alternative to individual flags)

### `parse_data.py`

Generic data parser for CLI output. Supports JSON, CSV, and plain text.

**Input formats:**

- **JSON**: Direct mapping to template variables
- **CSV**: Converts to array of objects
- **Text**: Regex-based extraction

See `references/parser-examples.md` for format-specific examples.

## Templates

### Template Syntax

Use `{{variable_name}}` for simple substitutions:

```html
<h1>{{report_title}}</h1>
<p>Generated: {{timestamp}}</p>
```

Use `{{#each items}}...{{/each}}` for loops:

```html
{{#each regions}}
<tr>
  <td>{{name}}</td>
  <td>{{value}}</td>
</tr>
{{/each}}
```

### Built-in Variables

Automatically available in all templates:

- `{{timestamp}}` - Current datetime (YYYY-MM-DD HH:mm:ss)
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{cli_command}}` - The CLI command that was run
- `{{generated_at}}` - Generation timestamp

### Template Examples

- `assets/network-report-template.html` - Network performance report
- `assets/simple-table-template.html` - Basic data table
- `assets/dashboard-template.html` - Multi-section dashboard

See `references/template-guide.md` for advanced templating.

## Configuration

### Config File Structure

```json
{
  "name": "daily-network-report",
  "cliCommand": "network-cli stats --date today --format json",
  "workingDir": "/opt/network-tool",
  "template": "assets/network-report-template.html",
  "outputDir": "reports",
  "outputFilename": "network-{date}.html",
  "parseScript": "scripts/parse_network.py",
  "env": {
    "API_KEY": "${NETWORK_API_KEY}"
  },
  "schedule": {
    "enabled": true,
    "cron": "0 9 * * *",
    "timezone": "Asia/Shanghai"
  }
}
```

### Environment Variables

Use `${VAR_NAME}` in config to reference environment variables.

## Cron Integration

### Using OpenClaw Cron

For reminders and notifications:

```bash
openclaw cron add --job '{
  "name": "daily-report-reminder",
  "schedule": {"kind": "cron", "expr": "0 9 * * *"},
  "payload": {
    "kind": "systemEvent",
    "text": "📊 Time to generate daily network report!"
  },
  "sessionTarget": "main"
}'
```

### Using System Crontab

For fully automated execution:

```bash
# Edit crontab
crontab -e

# Add job
0 9 * * * cd /Users/sto/.stoclaw/openclaw/skills/cli-report-generator && uv run python scripts/generate_report.py --config configs/network-report.json >> logs/cron.log 2>&1
```

## References

- `references/template-guide.md` - Complete template syntax and examples
- `references/parser-examples.md` - Data parsing patterns for different CLI outputs
- `references/cli-integration.md` - Integrating with various CLI tools
- `references/cron-setup.md` - Scheduling and automation options

## Common Use Cases

### Daily Performance Reports

```json
{
  "name": "daily-performance",
  "cliCommand": "perf-cli daily --format json",
  "template": "assets/performance-template.html",
  "schedule": {"cron": "0 8 * * *"}
}
```

### Weekly Summaries

```json
{
  "name": "weekly-summary",
  "cliCommand": "analytics-cli weekly --format json",
  "template": "assets/summary-template.html",
  "schedule": {"cron": "0 9 * * 1"}
}
```

### On-Demand Snapshots

```bash
# Generate ad-hoc report
uv run python scripts/generate_report.py \
  --cli-command "snapshot-cli --now" \
  --template assets/snapshot-template.html \
  --output reports/snapshot-$(date +%Y%m%d-%H%M).html
```

## Tips

- **Test CLI command first**: Ensure your CLI command works manually before automating
- **Use JSON output**: JSON is easiest to parse and map to templates
- **Keep templates simple**: Complex logic should be in parse scripts, not templates
- **Log everything**: Add `>> logs/generate.log 2>&1` to cron jobs for debugging
- **Version your reports**: Include date in output filename for historical tracking

## Troubleshooting

### CLI Command Fails

- Check `workingDir` is correct
- Ensure CLI tool is in PATH or use absolute path
- Verify environment variables are set

### Template Variables Not Rendering

- Check variable names match exactly (case-sensitive)
- Ensure data structure matches template expectations
- Review parse script output format

### Cron Job Not Running

- Check cron daemon is running: `sudo systemctl status cron`
- Verify cron syntax with [crontab.guru](https://crontab.guru)
- Check logs for errors

# Cron Setup Guide

Setting up automated report generation with OpenClaw cron or system crontab.

## Option 1: OpenClaw Cron (Recommended)

Best for reminders and integration with OpenClaw sessions.

### Create a Reminder Job

```bash
openclaw cron add --job '{
  "name": "daily-network-report",
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * *",
    "tz": "Asia/Shanghai"
  },
  "payload": {
    "kind": "systemEvent",
    "text": "📊 提醒：生成每日网络报告"
  },
  "sessionTarget": "main"
}'
```

### Cron Expression Examples

| Expression | Meaning |
|------------|---------|
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 */6 * * *` | Every 6 hours |
| `0 9 1 * *` | First day of month at 9:00 AM |
| `30 8 * * *` | Every day at 8:30 AM |

Use [crontab.guru](https://crontab.guru) to validate expressions.

## Option 2: System Crontab

Best for fully automated execution without user interaction.

### Setup Steps

1. **Create a shell script** (`scripts/run_daily_report.sh`):

```bash
#!/bin/bash
cd /Users/sto/.stoclaw/openclaw/skills/cli-report-generator
uv run python scripts/generate_report.py --config configs/network-report.json
echo "Report generated at $(date)" >> logs/cron.log
```

2. **Make it executable**:

```bash
chmod +x scripts/run_daily_report.sh
```

3. **Edit crontab**:

```bash
crontab -e
```

4. **Add job entry**:

```bash
# Daily network report at 9 AM
0 9 * * * cd /Users/sto/.stoclaw/openclaw/skills/cli-report-generator && ./scripts/run_daily_report.sh >> logs/cron.log 2>&1
```

## Option 3: macOS launchd

For macOS-native scheduling.

### Create Launch Agent

`~/Library/LaunchAgents/com.sto.cli-report.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sto.cli-report</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/sto/.stoclaw/openclaw/skills/cli-report-generator/scripts/run_daily_report.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>WorkingDirectory</key>
    <string>/Users/sto/.stoclaw/openclaw/skills/cli-report-generator</string>
    <key>StandardOutPath</key>
    <string>/Users/sto/.stoclaw/openclaw/skills/cli-report-generator/logs/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/sto/.stoclaw/openclaw/skills/cli-report-generator/logs/launchd.err</string>
</dict>
</plist>
```

### Load the Agent

```bash
launchctl load ~/Library/LaunchAgents/com.sto.cli-report.plist
```

## Debugging Cron Jobs

### Check if Cron is Running

```bash
# macOS
sudo systemsetup -getusingnetworktime
ps aux | grep cron
```

### View Cron Logs

```bash
# macOS
log show --predicate 'process == "cron"' --last 1h

# Linux
grep CRON /var/log/syslog
```

### Test Cron Environment

Cron runs with minimal environment. Test with:

```bash
# Simulate cron environment
env -i HOME=$HOME PATH=/usr/bin:/bin /bin/bash -c 'your-command'
```

### Common Issues

1. **Command not found**: Use absolute paths or set PATH in script
2. **Environment variables missing**: Source your shell profile or set explicitly
3. **Permissions denied**: Ensure scripts are executable (`chmod +x`)
4. **Working directory wrong**: Always `cd` to project directory first

## Best Practices

- ✅ Log output to files for debugging
- ✅ Use absolute paths in cron scripts
- ✅ Test commands manually before scheduling
- ✅ Set up email notifications for failures (Linux)
- ✅ Rotate logs to prevent disk space issues
- ✅ Include error handling in scripts

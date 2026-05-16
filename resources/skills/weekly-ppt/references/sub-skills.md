# 子技能引用说明

本文件记录了 weekly-ppt 主技能嵌套的子技能及其数据接口。

## 已集成的子技能

### 1. 行业市占 (market-share)

**数据接口**:
- `policyWeekPpt.industryTdtMarketShare.query` - 行业市占趋势
- `policyWeekPpt.keyMetricTrendVolume.query` - 单量趋势
- `policyWeekPpt.keyMetricTrendShopCount.query` - 客户数趋势

**页面内容**:
- 三列图表：市占、单量、客户数
- 底部信息栏显示关键指标

**完整 SKILL.md**: `~/.openclaw/skills/market-share/SKILL.md`

### 2. 过程目标管理 (process-target-manage)

**数据接口**:
- `policyWeekPpt.processTarget.query` - 省区过程目标数据

**页面内容**:
- 省区达成率表格
- 月达成率、周达成率、周环比、周同比
- 周揽件量趋势图
- 右侧信息栏

**完整 SKILL.md**: `~/.openclaw/skills/process-target-manage/SKILL.md`

## 扩展新子技能

要添加新的子技能，需要：

1. 在 `scripts/generate_weekly_ppt.py` 的 `SLIDE_CONFIG` 中注册
2. 在 `assets/templates/` 中创建页面模板
3. 在 `scripts/generate_weekly_ppt.py` 中添加数据查询逻辑
4. 更新本文件记录新子技能信息

## 数据接口规范

所有接口使用统一的 CLI 调用方式：
```bash
~/.sai/bin/sai <path> query --params '{}' 2>&1
```

返回格式：
```json
{
  "ok": true,
  "data": {
    "result": {
      "body": {
        "code": 200,
        "data": {
          "list": [...],
          "stateDate": "YYYYMMDD"
        }
      }
    }
  }
}
```

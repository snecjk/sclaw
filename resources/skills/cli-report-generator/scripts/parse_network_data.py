#!/usr/bin/env python3
"""
Network Data Parser - Parse CLI output for network report generation

This script transforms raw CLI output into the data structure expected by
the network report HTML template.

Expected CLI output format (JSON):
{
  "summary": {
    "total_volume_change": -3332000,
    "completion_rate": 104
  },
  "regions": [
    {
      "zone": "一战区",
      "province": "浙江",
      "manager": "杨刘炜",
      "volume_change": -44000,
      "completion_rate": 88,
      "kpi_score": 4,
      "q2_completion": 90
    },
    ...
  ]
}
"""

import json
import re
from typing import Any, Dict, List


def format_volume(volume: int) -> str:
    """Format volume change with sign and unit"""
    if volume > 0:
        return f"+{volume / 10000:.1f}万"
    elif volume < 0:
        return f"{volume / 10000:.1f}万"
    else:
        return "0"


def get_volume_class(volume: int) -> str:
    """Return CSS class based on volume change direction"""
    if volume > 0:
        return "positive"
    elif volume < 0:
        return "negative"
    return ""


def parse(raw_output: str) -> Dict[str, Any]:
    """
    Parse CLI output into template-ready data structure
    
    Args:
        raw_output: Raw JSON string from CLI command
        
    Returns:
        Dictionary with all variables needed for template
    """
    try:
        data = json.loads(raw_output)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        return {}
    
    # Build template data
    template_data = {
        'report_title': data.get('title', '网络贡献达成'),
        'period': data.get('period', '0417'),
        'slogan': data.get('slogan', '我为人人 人人为我'),
        'underperforming_regions': ', '.join(data.get('underperforming', [])),
        'notes': data.get('notes', '进港利润=进港派费利润 + 周期性利润 + 网点补贴支出'),
        'data_source': data.get('source', 'CLI Network Stats'),
        'regions': []
    }
    
    # Process regions
    regions = data.get('regions', [])
    for region in regions:
        zone = region.get('zone', '')
        volume = region.get('volume_change', 0)
        
        template_data['regions'].append({
            'zone': zone,
            'row_class': 'zone-header' if zone and not region.get('province') else '',
            'province': region.get('province', ''),
            'manager': region.get('manager', ''),
            'volume_change': format_volume(volume),
            'volume_class': get_volume_class(volume),
            'mtd_comparison': region.get('mtd_comparison', ''),
            'rebate': region.get('rebate', ''),
            'transfer': region.get('transfer', ''),
            'delivery_fee': region.get('delivery_fee', ''),
            'profit': region.get('profit', ''),
            'completion_rate': f"{region.get('completion_rate', 0)}%",
            'kpi_score': str(region.get('kpi_score', '')),
            'q2_completion': f"{region.get('q2_completion', 0)}%"
        })
    
    return template_data


def parse_text_output(raw_output: str) -> Dict[str, Any]:
    """
    Fallback parser for non-JSON CLI output
    
    Uses regex patterns to extract data from text-based CLI output.
    Customize these patterns based on your actual CLI output format.
    """
    result = {
        'regions': [],
        'underperforming': []
    }
    
    # Example patterns - customize for your CLI tool
    province_pattern = r'(\w+)\s+([\w\u4e00-\u9fa5]+)\s+(-?\d+\.?\d*)'
    
    for line in raw_output.split('\n'):
        match = re.search(province_pattern, line)
        if match:
            zone, province, volume = match.groups()
            result['regions'].append({
                'zone': zone,
                'province': province,
                'volume_change': float(volume) * 10000  # Convert to units
            })
    
    return result


if __name__ == '__main__':
    # Test with sample data
    sample_input = {
        'title': '网络贡献达成',
        'period': '0417',
        'regions': [
            {'zone': '一战区', 'province': '浙江', 'manager': '杨刘炜', 'volume_change': -44000, 'completion_rate': 88, 'kpi_score': 4, 'q2_completion': 90},
            {'zone': '一战区', 'province': '江苏', 'manager': '王政', 'volume_change': -281000, 'completion_rate': 98, 'kpi_score': 9, 'q2_completion': 99}
        ],
        'underperforming': ['江苏', '湖北', '江西'],
        'notes': '测试备注'
    }
    
    result = parse(json.dumps(sample_input))
    print(json.dumps(result, indent=2, ensure_ascii=False))

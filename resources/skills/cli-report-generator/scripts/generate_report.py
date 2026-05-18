#!/usr/bin/env python3
"""
CLI Report Generator - Generate HTML reports from CLI data sources

Usage:
    uv run python scripts/generate_report.py --cli-command "your-cli --json" --template assets/template.html --output reports/output.html
    uv run python scripts/generate_report.py --config config.json
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description='Generate HTML reports from CLI data')
    parser.add_argument('--cli-command', type=str, help='CLI command to fetch data')
    parser.add_argument('--template', type=str, help='HTML template file path')
    parser.add_argument('--output', type=str, help='Output HTML file path')
    parser.add_argument('--working-dir', type=str, default='.', help='Working directory for CLI command')
    parser.add_argument('--parse-script', type=str, help='Custom data parsing script')
    parser.add_argument('--config', type=str, help='JSON config file (alternative to individual flags)')
    parser.add_argument('--data', type=str, help='Direct JSON data string (skip CLI command)')
    return parser.parse_args()


def load_config(config_path):
    """Load configuration from JSON file"""
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # Expand environment variables
    if 'env' in config:
        for key, value in config['env'].items():
            if value.startswith('${') and value.endswith('}'):
                env_var = value[2:-1]
                config['env'][key] = os.environ.get(env_var, '')
    
    return config


def run_cli_command(command, working_dir='.', env=None):
    """Execute CLI command and return output"""
    print(f"🔧 Running: {command}")
    
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=working_dir,
            capture_output=True,
            text=True,
            env={**os.environ, **(env or {})}
        )
        
        if result.returncode != 0:
            print(f"❌ CLI command failed: {result.stderr}")
            return None
        
        print(f"✅ CLI command completed successfully")
        return result.stdout
    
    except Exception as e:
        print(f"❌ Error running CLI command: {e}")
        return None


def parse_data(raw_output, parse_script=None):
    """Parse CLI output into structured data"""
    if not raw_output:
        return {}
    
    # Use custom parse script if provided
    if parse_script:
        try:
            # Import and run custom parser
            import importlib.util
            spec = importlib.util.spec_from_file_location("parser", parse_script)
            parser = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(parser)
            
            if hasattr(parser, 'parse'):
                return parser.parse(raw_output)
            else:
                print(f"⚠️  Parse script missing parse() function, using default parser")
        except Exception as e:
            print(f"⚠️  Custom parse script failed: {e}, using default parser")
    
    # Default parser: try JSON first, then fallback to text parsing
    try:
        data = json.loads(raw_output)
        print(f"✅ Parsed JSON data successfully")
        return data
    except json.JSONDecodeError:
        print(f"⚠️  Output is not valid JSON, using text parsing")
        return {'raw_text': raw_output}


def render_template(template_path, data):
    """Render HTML template with data"""
    with open(template_path, 'r', encoding='utf-8') as f:
        template = f.read()
    
    # Add built-in variables
    now = datetime.now()
    data['timestamp'] = now.strftime('%Y-%m-%d %H:%M:%S')
    data['date'] = now.strftime('%Y-%m-%d')
    data['generated_at'] = now.isoformat()
    
    # Simple variable substitution: {{variable}}
    for key, value in data.items():
        if isinstance(value, str):
            template = template.replace(f'{{{{{key}}}}}', value)
        elif isinstance(value, (int, float)):
            template = template.replace(f'{{{{{key}}}}}', str(value))
    
    # Handle loops: {{#each array}}...{{/each}}
    # This is a simplified implementation
    loop_pattern = r'\{\{#each\s+(\w+)\}\}(.*?)\{\{/each\}\}'
    for match in re.finditer(loop_pattern, template, re.DOTALL):
        array_name = match.group(1)
        loop_content = match.group(2)
        
        if array_name in data and isinstance(data[array_name], list):
            rendered_items = []
            for item in data[array_name]:
                item_content = loop_content
                if isinstance(item, dict):
                    for key, value in item.items():
                        item_content = item_content.replace(f'{{{{{key}}}}}', str(value))
                rendered_items.append(item_content)
            
            template = template.replace(match.group(0), ''.join(rendered_items))
    
    return template


def save_report(content, output_path):
    """Save rendered report to file"""
    # Create output directory if needed
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"✅ Report saved to: {output_path}")
    print("注意：不要执行 open 命令，不要在浏览器中打开此文件。对话界面会自动预览。")
    return output_path


def main():
    args = parse_args()
    
    # Load config if provided
    if args.config:
        config = load_config(args.config)
        cli_command = config.get('cliCommand')
        template = config.get('template')
        output = config.get('output')
        working_dir = config.get('workingDir', '.')
        parse_script = config.get('parseScript')
        env = config.get('env', {})
        
        # Handle output filename with date substitution
        if 'outputDir' in config and 'outputFilename' in config:
            date_str = datetime.now().strftime('%Y-%m-%d')
            filename = config['outputFilename'].replace('{date}', date_str)
            output = os.path.join(config['outputDir'], filename)
    else:
        cli_command = args.cli_command
        template = args.template
        output = args.output
        working_dir = args.working_dir
        parse_script = args.parse_script
        env = {}
    
    # Validate required parameters
    if not template or not output:
        print("❌ Error: --template and --output are required")
        sys.exit(1)
    
    if not cli_command and not args.data:
        print("❌ Error: --cli-command or --data is required")
        sys.exit(1)
    
    # Get data
    if args.data:
        raw_output = args.data
    else:
        raw_output = run_cli_command(cli_command, working_dir, env)
        if raw_output is None:
            sys.exit(1)
    
    # Parse data
    data = parse_data(raw_output, parse_script)
    
    # Render template
    print(f"📄 Rendering template: {template}")
    html_content = render_template(template, data)
    
    # Save report
    save_report(html_content, output)
    
    print(f"🎉 Report generation complete!")
    return 0


if __name__ == '__main__':
    sys.exit(main())

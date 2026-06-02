# 自然语言驱动脚本生命周期设计

> 聚焦核心闭环：**自然语言描述 → LLM 生成脚本 → 脚本存储 → 定时触发执行 → 产物交付 → 自然语言调整 → 脚本增量更新 → 再次执行**
>
> 本文档面向云端后端实现，前端对接仅在边界处简要说明。

---

## 1. 核心闭环总览

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          自然语言驱动脚本生命周期                                      │
│                                                                                      │
│   创建定时任务               LLM 生成               定时触发              产物交付       │
│      │                       │                       │                     │          │
│      ▼                       ▼                       ▼                     ▼          │
│  ┌────────┐            ┌────────┐             ┌────────┐            ┌────────┐       │
│  │自然语言 │───────────▶│ Python │────────────▶│Sandbox │───────────▶│ 产物   │       │
│  │描述    │  ①生成     │ 脚本   │   ②存储     │ 执行   │   ③执行    │ (OSS)  │       │
│  └────────┘            └────────┘             └────────┘            └────────┘       │
│       │                     │                      │                     │            │
│       │                     │                      │                     │            │
│       │    ┌────────────────┘                      │                     │            │
│       │    │ ④差异检测                               │                     │            │
│       │    │                                         │                     │            │
│       ▼    ▼                                         ▼                     ▼            │
│  ┌────────┐            ┌────────┐             ┌────────┐            ┌────────┐       │
│  │调整后的 │───────────▶│ 脚本   │────────────▶│Sandbox │───────────▶│ 新产物 │       │
│  │自然语言 │  ⑤增量更新 │ 更新   │   ⑥存储     │ 执行   │   ⑦执行    │ (OSS)  │       │
│  └────────┘            └────────┘             └────────┘            └────────┘       │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 自然语言 → Python 脚本（首次生成）

### 2.1 触发时机

| 场景 | 触发方 | 异步/同步 | 说明 |
|------|--------|----------|------|
| 用户创建任务时填写了 `description` | TaskService | **异步** | 落库后立即发布 `TaskCreatedEvent`，ScriptService 消费后触发 LLM |
| 用户手动点击"重新生成脚本" | ScriptService | **异步** | 直接调用 LLM，前端轮询状态 |

**为什么必须异步？**
- LLM 生成脚本耗时 5-30 秒，不能阻塞 HTTP 响应
- 生成失败不应影响任务创建（任务可先用"知多星回退模式"执行）

### 2.2 生成流水线（Pipeline）

```
TaskCreatedEvent / RegenerateRequest
        │
        ▼
┌───────────────┐
│  ① 上下文构建  │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  ② LLM 调用   │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  ③ 输出解析   │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  ④ 安全扫描   │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  ⑤ 格式化     │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  ⑥ 存储入库   │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  ⑦ 状态推送   │
└───────────────┘
```

### 2.3 上下文构建（关键）

LLM 不是只拿到 `description` 就生成，需要构建**结构化上下文（Context）**：

```python
@dataclass
class ScriptGenerationContext:
    # 任务元信息
    task_name: str
    task_description: str
    
    # 用户上下文（从 SSO 获取）
    owner_user_id: str
    site_code: str
    site_name: str
    
    # 时间上下文
    current_time: datetime  # LLM 需要知道"今天"来生成相对时间逻辑
    timezone: str = "Asia/Shanghai"
    
    # 可用数据源（注册中心动态获取）
    available_data_sources: List[DataSourceSchema]
    
    # 历史脚本（如果是重新生成，提供上一个版本的脚本作为参考）
    previous_script: Optional[str] = None
    previous_script_error: Optional[str] = None  # 上次执行失败的错误，用于指导修正
    
    # 输出格式要求
    output_requirements: OutputRequirements

@dataclass
class DataSourceSchema:
    name: str                          # "hq_reconciliation"
    description: str                   # "总部对账数据"
    endpoint: str                      # "GET /api/v1/hq/reconciliation"
    required_params: List[ParamSchema]
    optional_params: List[ParamSchema]
    response_schema: Dict              # 响应字段说明
    example_response: str              # 示例响应（帮助 LLM 理解数据结构）

@dataclass
class OutputRequirements:
    allowed_formats: List[str]         # ["xlsx", "csv", "png", "json"]
    max_file_size_mb: int = 10
    output_dir_env: str = "OUTPUT_DIR"
```

**示例：可用数据源注册**

```json
{
  "available_data_sources": [
    {
      "name": "hq_reconciliation",
      "description": "总部资金系统对账数据，包含昨日到账、利息、异常项",
      "endpoint": "GET https://data.sto.cn/api/v1/hq/reconciliation",
      "required_params": [
        {"name": "site_code", "type": "string", "description": "网点编码"},
        {"name": "date", "type": "string", "format": "YYYY-MM-DD", "description": "对账日期，默认昨日"}
      ],
      "optional_params": [
        {"name": "include_interest", "type": "boolean", "default": true}
      ],
      "response_schema": {
        "items": {
          "customer_code": "string",
          "customer_name": "string",
          "amount": "decimal",
          "status": "enum: normal|abnormal",
          "abnormal_reason": "string?"
        }
      },
      "example_response": "[{\"customer_code\": \"C001\", \"amount\": 150000.00, \"status\": \"abnormal\"}]"
    },
    {
      "name": "customer_cost",
      "description": "出港单票成本与客户成本异常",
      "endpoint": "GET https://data.sto.cn/api/v1/customer/cost",
      "required_params": [
        {"name": "site_code", "type": "string"},
        {"name": "month", "type": "string", "format": "YYYY-MM"}
      ],
      "response_schema": {
        "customer_avg_cost": "decimal",
        "abnormal_customers": [{"code": "string", "deviation_pct": "decimal"}]
      }
    }
  ]
}
```

### 2.4 Prompt 工程（详细版）

采用 **System Prompt + User Prompt + Few-shot Examples** 三段式结构。

**System Prompt：**

```text
你是一个为物流行业（申通快递）生成数据分析脚本的 AI 助手。

你的职责：
1. 根据用户的自然语言描述，生成可执行的 Python 3 标准库脚本
2. 脚本需自动从公司数据接口拉取数据、进行分析、生成产物
3. 脚本必须安全、健壮、自包含

约束（绝对遵守）：
- 只能使用 Python 标准库：urllib.request, json, csv, datetime, os, sys, math, statistics, collections, itertools
- 禁止使用：os.system, subprocess, eval, exec, compile, __import__, socket, urllib.request.urlopen 以外的网络库
- 禁止访问 OUTPUT_DIR 以外的文件系统路径
- 网络请求只能访问 *.sto.cn 域名
- 脚本必须将产物写入环境变量 OUTPUT_DIR 指定的目录
- 脚本必须在 stdout 输出 JSON 格式的执行摘要

输出格式：
- 只返回纯 Python 代码，不要 Markdown 代码块标记（```python）
- 不要包含任何解释性文字
- 脚本头部必须包含注释：# Generated by AI for task: {task_name}
- 脚本必须包含 main() 函数，并在 if __name__ == '__main__': 中调用
```

**User Prompt（动态构建）：**

```text
【任务名称】
每日异常客户跟踪

【任务描述】
每工作日 9:00 从总部资金系统拉取上一日对账与利息到账数据，写入工作中心并与首页「昨日异常客户跟踪」卡片口径对齐，异常项自动标红便于结算小组处理。

【用户上下文】
- 网点编码：276000
- 网点名称：山东临沂公司
- 当前时间：2026-05-29 10:00:00 (Asia/Shanghai)

【可用数据源】
1. hq_reconciliation
   GET https://data.sto.cn/api/v1/hq/reconciliation?site_code={site_code}&date={date}
   响应示例：[{"customer_code": "C001", "customer_name": "某某客户", "amount": 150000.00, "status": "abnormal", "abnormal_reason": "利息未到账"}]

2. customer_cost
   GET https://data.sto.cn/api/v1/customer/cost?site_code={site_code}&month={month}
   响应示例：{"customer_avg_cost": 2.5, "abnormal_customers": [{"code": "C001", "deviation_pct": 15.3}]}

【输出要求】
- 生成 Excel 报表（.xlsx 格式），包含：客户编码、客户名称、金额、状态、异常原因
- 异常行（status='abnormal'）需要在单独的异常汇总 sheet 中展示
- 文件命名：daily_abnormal_customers_{YYYYMMDD}.xlsx
- 同时在 stdout 输出 JSON 摘要：{"summary": "发现并跟踪X家异常客户", "abnormal_count": X}

【历史参考】
（如果是重新生成，此处填入上一个版本的脚本）
```

**Few-shot Example（嵌入 Prompt）：**

```text
【示例 1：日报表生成】
输入：每天生成昨日发件量统计报表
输出：
import os, json, urllib.request
from datetime import datetime, timedelta

def main():
    token = os.environ['STO_TOKEN']
    site_code = os.environ['SITE_CODE']
    output_dir = os.environ['OUTPUT_DIR']
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    req = urllib.request.Request(
        f'https://data.sto.cn/api/v1/volume/daily?site_code={site_code}&date={yesterday}',
        headers={'Authorization': f'Bearer {token}'}
    )
    
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    
    # 生成 CSV
    output_file = os.path.join(output_dir, f'daily_volume_{yesterday}.csv')
    with open(output_file, 'w', newline='', encoding='utf-8-sig') as f:
        # ... 写入逻辑
    
    print(json.dumps({"summary": f"生成日报 {yesterday}", "rows": len(data)}))

if __name__ == '__main__':
    main()
```

### 2.5 LLM 输出解析与后处理

**解析规则：**
1. 去除 Markdown 代码块标记（```python ... ```）
2. 去除首尾空白和非代码内容
3. 检查是否包含 `def main():` 和 `if __name__ == '__main__':`
4. 若缺少 main 函数，自动包装（将整个代码体放入 main 函数）

**格式化：**
- 使用 `autopep8` 或 `black` 进行代码格式化
- 统一缩进为 4 空格
- 统一引号为单引号（减少转义问题）

### 2.6 安全扫描（AST 静态分析）

使用 Python 的 `ast` 模块进行静态分析，而非正则表达式（更准确）。

```python
import ast

class ScriptSecurityScanner:
    BLOCKED_CALLS = {
        'os.system', 'os.popen', 'os.exec*', 'os.spawn*',
        'subprocess.call', 'subprocess.run', 'subprocess.Popen',
        'eval', 'exec', 'compile', '__import__',
        'socket.socket', 'socket.create_connection',
        'urllib.request.urlopen',  # 只允许我们包装过的版本
    }
    
    ALLOWED_MODULES = {
        'os', 'sys', 'json', 'csv', 'datetime', 'math', 
        'statistics', 'collections', 'itertools', 'urllib.request'
    }
    
    def scan(self, code: str) -> ScanResult:
        tree = ast.parse(code)
        violations = []
        
        for node in ast.walk(tree):
            # 检查危险函数调用
            if isinstance(node, ast.Call):
                func_name = self._get_full_name(node.func)
                if func_name in self.BLOCKED_CALLS:
                    violations.append(f"Blocked call: {func_name}")
            
            # 检查非法导入
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    module = alias.name.split('.')[0]
                    if module not in self.ALLOWED_MODULES:
                        violations.append(f"Blocked import: {alias.name}")
            
            # 检查文件系统访问（只允许 OUTPUT_DIR）
            if isinstance(node, ast.Call) and self._is_open_call(node):
                if not self._is_safe_path(node):
                    violations.append("File access outside OUTPUT_DIR detected")
        
        return ScanResult(
            passed=len(violations) == 0,
            violations=violations
        )
```

**扫描失败处理：**
- 失败原因记录到 `script_generation_log` 表
- 标记 `script_status='error'`
- 通过 WebSocket 推送失败原因给前端
- 用户可在前端看到具体哪个调用被拦截，修改描述后重试

### 2.7 存储入库

扫描通过后，脚本进入存储流程：

```python
def store_script(task_id: int, script_content: str) -> str:
    """
    1. 计算 content hash
    2. 上传到 OSS
    3. 小于 64KB 同时存入 MySQL script_content
    4. 写入 script_version 历史表
    5. 更新 task.script_status='ready'
    """
    version = get_next_version(task_id)
    oss_key = f"scheduled-tasks/{owner_id}/{task_id}/script_v{version}.py"
    
    # 上传 OSS
    oss_client.put_object(oss_key, script_content.encode('utf-8'))
    
    # 更新任务表
    update_data = {
        'oss_object_key': oss_key,
        'script_version': version,
        'script_status': 'ready',
    }
    if len(script_content) <= 64 * 1024:
        update_data['script_content'] = script_content
    else:
        update_data['script_content'] = None
    
    task_repo.update(task_id, **update_data)
    
    # 写入版本历史
    script_version_repo.insert(
        task_id=task_id,
        version=version,
        oss_key=oss_key,
        content_snapshot=script_content[:65535],  # 截断存快照
        generated_by='llm',
        description_hash=hash_description(current_description),
    )
    
    return oss_key
```

---

## 3. 脚本执行（定时触发）

### 3.1 调度触发链路

```
XXL-JOB dispatch-tick (每 30s)
        │
        ▼
查询到期任务：
SELECT * FROM scheduled_task
WHERE enabled = 1 
  AND is_delete = 0
  AND next_run_at <= NOW()
  AND (script_status = 'ready' OR oss_object_key IS NULL)
FOR UPDATE SKIP LOCKED
        │
        ▼
获取 Redis 分布式锁：SET task:{id}:lock EX 60 NX
        │
        ▼
  ┌─────────────┐
  │ 有脚本？      │
  └──────┬──────┘
         │
    Yes /│\ No
        / │ \
       /  │  \
      ▼   │   ▼
┌────────┐│┌──────────┐
│脚本模式 │││知多星回退 │
└────┬───┘│└────┬─────┘
     │    │     │
     ▼    │     ▼
下载脚本  │   调用知多星
Sandbox执行│   dispatch
     │    │     │
     ▼    │     ▼
收集产物  │   保存结果
     │    │     │
     └────┼─────┘
          │
          ▼
   更新 next_run_at
   释放 Redis 锁
```

### 3.2 脚本模式执行详细流程

```python
def execute_script_mode(task: ScheduledTask) -> TaskRun:
    run_id = generate_uuid()
    run = TaskRun(task_id=task.id, run_id=run_id, status='running')
    run_repo.save(run)
    
    work_dir = f"/tmp/scheduled-tasks/{task.id}/{run_id}"
    os.makedirs(work_dir, exist_ok=True)
    
    try:
        # 1. 下载脚本（带缓存）
        script_path = download_script_with_cache(task.oss_object_key, work_dir)
        
        # 2. 准备输出目录
        output_dir = os.path.join(work_dir, 'output')
        os.makedirs(output_dir, exist_ok=True)
        
        # 3. 准备环境变量
        env = build_execution_env(task, run_id, output_dir)
        
        # 4. 启动 Sandbox
        result = sandbox.run(
            script_path=script_path,
            env=env,
            work_dir=work_dir,
            limits=ResourceLimits(cpu=1.0, memory_mb=512, timeout_sec=30),
            network_policy=NetworkPolicy(whitelist_domains=['*.sto.cn'])
        )
        
        # 5. 解析 stdout（JSON 摘要）
        summary = parse_execution_summary(result.stdout)
        
        # 6. 收集产物
        artifacts = collect_artifacts(run_id, output_dir)
        
        # 7. 构建执行结果 markdown
        execution_result = build_result_markdown(task, summary, artifacts)
        
        # 8. 更新执行记录
        run.status = 'success'
        run.completed_at = now()
        run.duration_ms = result.duration_ms
        run.execution_result = execution_result
        run.log_text = result.stderr[:10000]  # 截断日志
        run.script_version_used = task.script_version
        run.script_oss_key = task.oss_object_key
        run_repo.update(run)
        
        # 9. 推送通知
        notification.push(task, run, artifacts)
        
    except SandboxTimeout:
        handle_execution_error(run, 'timeout', 'EXEC_TIMEOUT', '脚本执行超过30秒')
    except SandboxOOM:
        handle_execution_error(run, 'failed', 'OOM', '内存超限')
    except Exception as e:
        handle_execution_error(run, 'failed', 'EXEC_FAILED', str(e))
    finally:
        cleanup_work_dir(work_dir)
        redis.delete(f"task:{task.id}:lock")
        update_next_run(task)
    
    return run
```

### 3.3 Sandbox 执行环境详解

**Docker 运行时配置：**

```yaml
# docker-compose.sandbox.yml
version: '3.8'
services:
  sandbox:
    image: scheduled-tasks-sandbox:v1
    read_only: true
    tmpfs:
      - /tmp:noexec,nosuid,size=100m
    volumes:
      - type: bind
        source: ./script.py
        target: /sandbox/script.py
        read_only: true
      - type: bind
        source: ./output
        target: /sandbox/output
    environment:
      - PYTHONDONTWRITEBYTECODE=1
      - PYTHONUNBUFFERED=1
    security_opt:
      - no-new-privileges:true
      - seccomp:./sandbox-seccomp.json
    network_mode: none  # 由外部控制网络命名空间
    cgroup_limits:
      cpu_quota: 100000  # 1核
      memory: 536870912  # 512MB
      pids_limit: 50
```

**seccomp 配置文件（关键过滤）：**

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "syscalls": [
    {
      "names": ["read", "write", "open", "close", "stat", "fstat", "lstat", "mmap", "mprotect", "munmap", "brk", "rt_sigaction", "rt_sigprocmask", "ioctl", "pread64", "pwrite64", "readv", "writev", "pipe", "dup", "dup2", "nanosleep", "getpid", "accept", "bind", "connect", "getsockname", "getpeername", "sendto", "recvfrom", "setsockopt", "getsockopt", "shutdown", "clone", "exit", "exit_group", "wait4", "uname", "fcntl", "futex", "getcwd", "chdir", "mkdir", "rmdir", "rename", "unlink", "readlink", "gettimeofday", "clock_gettime", "getrandom"],
      "action": "SCMP_ACT_ALLOW"
    },
    {
      "names": ["socket"],
      "action": "SCMP_ACT_ALLOW",
      "args": [
        {
          "index": 0,
          "value": 2,
          "op": "SCMP_CMP_EQ",
          "comment": "只允许 AF_INET"
        }
      ]
    },
    {
      "names": ["execve", "execveat", "fork", "vfork", "ptrace", "mount", "umount2", "reboot", "setuid", "setgid", "setreuid", "setregid"],
      "action": "SCMP_ACT_KILL"
    }
  ]
}
```

**网络控制（iptables + Docker 网络）：**

```bash
# 创建受限网络
 docker network create --internal restricted-net

# 允许访问 *.sto.cn（通过 DNS 解析后动态添加 iptables 规则）
# 禁止访问其他所有出站地址
iptables -A OUTPUT -d 10.0.0.0/8 -j ACCEPT      # 内网数据服务
iptables -A OUTPUT -p tcp --dport 443 -m string --string "sto.cn" --algo bm -j ACCEPT
iptables -A OUTPUT -p tcp --dport 80 -m string --string "sto.cn" --algo bm -j ACCEPT
iptables -A OUTPUT -j DROP
```

### 3.4 产物收集与存储

```python
def collect_artifacts(run_id: str, output_dir: str) -> List[Artifact]:
    artifacts = []
    
    if not os.path.exists(output_dir):
        return artifacts
    
    for filename in os.listdir(output_dir):
        file_path = os.path.join(output_dir, filename)
        if not os.path.isfile(file_path):
            continue
        
        file_size = os.path.getsize(file_path)
        content_type = guess_content_type(filename)
        
        # 上传 OSS
        oss_key = f"scheduled-tasks/{owner_id}/{task_id}/artifacts/{run_id}/{filename}"
        oss_client.put_object(oss_key, open(file_path, 'rb'))
        
        # 记录元数据
        artifact = Artifact(
            run_id=run_id,
            name=filename,
            size=file_size,
            content_type=content_type,
            oss_key=oss_key,
        )
        artifact_repo.save(artifact)
        artifacts.append(artifact)
        
        # 如果是钉钉推送需要的产物，同步到 CDN
        if task.notify_mode in ('dingtalk_group', 'both'):
            cdn_url = sync_to_cdn(oss_key)
            artifact.cdn_url = cdn_url
            artifact_repo.update(artifact)
    
    return artifacts
```

### 3.5 执行摘要解析

脚本 stdout 最后一行必须是 JSON 摘要：

```python
def parse_execution_summary(stdout: str) -> ExecutionSummary:
    """解析脚本 stdout，提取最后一行 JSON 摘要"""
    lines = stdout.strip().split('\n')
    
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            if isinstance(data, dict) and 'summary' in data:
                return ExecutionSummary(
                    summary=data.get('summary', ''),
                    rows_processed=data.get('rows_processed', 0),
                    abnormal_count=data.get('abnormal_count', 0),
                    extra=data,
                )
        except json.JSONDecodeError:
            continue
    
    # 未找到摘要，返回默认
    return ExecutionSummary(summary='脚本执行完成', rows_processed=0)
```

---

## 4. 产物与脚本的存储策略

### 4.1 脚本存储

| 维度 | 策略 | 理由 |
|------|------|------|
| **主存储** | OSS (`script_v{version}.py`) | 大对象存储，高可用，低成本 |
| **缓存** | MySQL `script_content` (≤64KB) | 前端预览、快速校验时无需请求 OSS |
| **历史版本** | `script_version` 表 + OSS | 支持回滚，执行记录可追溯 |
| **版本清理** | 保留最近 10 个版本 / 90 天 | 平衡存储成本与回滚需求 |

**脚本读取优先级：**
1. 执行时优先从本地缓存读取（按 `oss_key` 做文件系统缓存）
2. 缓存 miss 时从 OSS 下载，写入本地缓存（TTL 1 小时）
3. 前端预览时直接读 MySQL `script_content`（若有）

### 4.2 产物存储（多格式支持）

**产物形态分类：**

| 产物类型 | 格式示例 | OSS 路径 | 生命周期 | CDN 同步 | 预览能力 |
|---------|---------|---------|---------|---------|---------|
| **文档类** | `.md`, `.docx`, `.pdf`, `.txt` | `.../artifacts/{run_id}/docs/*` | 30 天 | 是 | Markdown 原生渲染，Word/PDF 下载 |
| **表格类** | `.xlsx`, `.csv`, `.tsv` | `.../artifacts/{run_id}/sheets/*` | 30 天 | 是 | Excel 在线预览（SheetJS） |
| **图片类** | `.png`, `.jpg`, `.svg`, `.gif` | `.../artifacts/{run_id}/images/*` | 30 天 | 是 | 直接 `<img>` 预览 |
| **演示文稿** | `.pptx`, `.key` | `.../artifacts/{run_id}/slides/*` | 30 天 | 是 | 下载或转 PDF 预览 |
| **网页类** | `.html`, `.htm` | `.../artifacts/{run_id}/pages/*` | 7 天 | 否 | iframe 沙箱预览 |
| **数据类** | `.json`, `.xml`, `.yaml` | `.../artifacts/{run_id}/data/*` | 7 天 | 否 | JSON 格式化查看器 |
| **日志类** | `.log`, `.out` | `.../logs/{run_id}/*` | 7 天 | 否 | 高亮日志查看器 |
| **压缩包** | `.zip`, `.tar.gz` | `.../artifacts/{run_id}/archives/*` | 15 天 | 否 | 解压后列出文件清单 |

**产物元数据扩展：**

```python
@dataclass
class Artifact:
    run_id: str
    name: str
    size: int
    content_type: str           # MIME type: application/vnd.openxml...
    oss_key: str
    cdn_url: Optional[str]
    
    # 新增字段
    category: str               # "document" | "spreadsheet" | "image" | "presentation" | "webpage" | "data" | "log" | "archive"
    preview_url: Optional[str]  # 预览页面 URL（如 HTML 渲染页）
    thumbnail_url: Optional[str] # 缩略图（图片/文档首屏截图）
    metadata: Optional[Dict]    # 扩展元数据
    
    # 文档类特有
    page_count: Optional[int]   # PDF/Word 页数
    word_count: Optional[int]   # 文档字数
    
    # 表格类特有
    sheet_count: Optional[int]  # Excel sheet 数量
    row_count: Optional[int]    # 总行数
    
    # 图片类特有
    width: Optional[int]        # 图片宽度
    height: Optional[int]       # 图片高度
    
    # 压缩包特有
    file_count: Optional[int]   # 包含文件数量
    uncompressed_size: Optional[int]  # 解压后大小
```

**产物生成示例（脚本内）：**

```python
# 示例 1：生成 Markdown 报告
def generate_markdown_report(data, output_dir):
    md_content = f"""# 每日异常客户跟踪报告

## 执行时间
{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 摘要
- 总客户数：{len(data)}
- 异常客户数：{sum(1 for c in data if c['status'] == 'abnormal')}

## 异常明细
| 客户编码 | 客户名称 | 金额 | 异常原因 |
|---------|---------|------|---------|
"""
    for item in [c for c in data if c['status'] == 'abnormal']:
        md_content += f"| {item['customer_code']} | {item['customer_name']} | {item['amount']} | {item['abnormal_reason']} |\n"
    
    with open(os.path.join(output_dir, 'report.md'), 'w', encoding='utf-8') as f:
        f.write(md_content)
    
    print(json.dumps({"summary": "生成 Markdown 报告", "file": "report.md"}))

# 示例 2：生成 Word 文档（使用 python-docx，需预装）
def generate_word_report(data, output_dir):
    from docx import Document
    doc = Document()
    doc.add_heading('每日异常客户跟踪报告', 0)
    doc.add_paragraph(f'生成时间：{datetime.now()}')
    
    table = doc.add_table(rows=1, cols=4)
    table.style = 'Table Grid'
    hdr_cells = table.rows[0].cells
    hdr_cells[0].text = '客户编码'
    hdr_cells[1].text = '客户名称'
    hdr_cells[2].text = '金额'
    hdr_cells[3].text = '异常原因'
    
    for item in data:
        row_cells = table.add_row().cells
        row_cells[0].text = item['customer_code']
        row_cells[1].text = item['customer_name']
        row_cells[2].text = str(item['amount'])
        row_cells[3].text = item.get('abnormal_reason', '')
    
    doc.save(os.path.join(output_dir, 'report.docx'))

# 示例 3：生成图片图表（使用 matplotlib，需预装）
def generate_chart(data, output_dir):
    import matplotlib.pyplot as plt
    
    customers = [item['customer_name'] for item in data[:10]]
    amounts = [item['amount'] for item in data[:10]]
    
    plt.figure(figsize=(12, 6))
    plt.bar(customers, amounts)
    plt.xticks(rotation=45)
    plt.title('Top 10 客户金额')
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'chart.png'), dpi=150)
    plt.close()

# 示例 4：生成 HTML 仪表板
def generate_html_dashboard(data, output_dir):
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据仪表板</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 40px; }}
        .card {{ border: 1px solid #ddd; padding: 20px; margin: 10px 0; border-radius: 8px; }}
        .metric {{ font-size: 24px; font-weight: bold; color: #ff6f00; }}
        table {{ border-collapse: collapse; width: 100%; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background-color: #ff6f00; color: white; }}
        tr:nth-child(even) {{ background-color: #f2f2f2; }}
    </style>
</head>
<body>
    <h1>每日数据仪表板</h1>
    <div class="card">
        <div class="metric">{len(data)}</div>
        <div>总客户数</div>
    </div>
    <h2>异常客户明细</h2>
    <table>
        <tr><th>客户编码</th><th>客户名称</th><th>金额</th><th>状态</th></tr>
        {''.join(f"<tr><td>{c['customer_code']}</td><td>{c['customer_name']}</td><td>{c['amount']}</td><td>{c['status']}</td></tr>" for c in data)}
    </table>
</body>
</html>"""
    
    with open(os.path.join(output_dir, 'dashboard.html'), 'w', encoding='utf-8') as f:
        f.write(html)

# 示例 5：生成 PPT（使用 python-pptx，需预装）
def generate_ppt_summary(data, output_dir):
    from pptx import Presentation
    from pptx.util import Inches
    
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = '每日异常客户跟踪'
    slide.placeholders[1].text = f'生成时间：{datetime.now().strftime("%Y-%m-%d")}'
    
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = '异常汇总'
    
    table = slide.shapes.add_table(
        rows=len([c for c in data if c['status'] == 'abnormal']) + 1,
        cols=4,
        left=Inches(0.5),
        top=Inches(1.5),
        width=Inches(9),
        height=Inches(1)
    ).table
    
    # 设置表头
    headers = ['客户编码', '客户名称', '金额', '异常原因']
    for i, header in enumerate(headers):
        table.cell(0, i).text = header
    
    # 填充数据
    for i, item in enumerate([c for c in data if c['status'] == 'abnormal'], 1):
        table.cell(i, 0).text = item['customer_code']
        table.cell(i, 1).text = item['customer_name']
        table.cell(i, 2).text = str(item['amount'])
        table.cell(i, 3).text = item.get('abnormal_reason', '')
    
    prs.save(os.path.join(output_dir, 'summary.pptx'))
```

**Sandbox 预装库扩展：**

```yaml
# Dockerfile.sandbox
FROM python:3.11-slim

# 基础库（标准库）
RUN pip install --no-cache-dir \
    # 文档处理
    python-docx==1.1.0 \
    reportlab==4.0.7 \
    markdown==3.5.2 \
    # 表格处理
    openpyxl==3.1.2 \
    pandas==2.1.4 \
    # 图表处理
    matplotlib==3.8.2 \
    pillow==10.2.0 \
    # 演示文稿
    python-pptx==0.6.23 \
    # 数据处理
    numpy==1.26.3 \
    # HTML 处理
    jinja2==3.1.3

WORKDIR /sandbox
COPY entrypoint.py /entrypoint.py
ENTRYPOINT ["python", "/entrypoint.py"]
```

**产物预览服务（前端）：**

```typescript
// 产物预览组件
interface ArtifactPreviewProps {
  artifact: Artifact;
  onDownload: () => void;
}

function ArtifactPreview({ artifact, onDownload }: ArtifactPreviewProps) {
  switch (artifact.category) {
    case 'document':
      if (artifact.content_type === 'text/markdown') {
        return <MarkdownRenderer content={artifact.preview_url} />;
      }
      if (artifact.content_type.includes('wordprocessingml')) {
        return <WordViewer url={artifact.cdn_url} />;
      }
      if (artifact.content_type === 'application/pdf') {
        return <PDFViewer url={artifact.cdn_url} />;
      }
      break;
    
    case 'spreadsheet':
      return <ExcelViewer url={artifact.cdn_url} sheetCount={artifact.sheet_count} />;
    
    case 'image':
      return <ImageViewer src={artifact.cdn_url} width={artifact.width} height={artifact.height} />;
    
    case 'presentation':
      return <PPTViewer url={artifact.cdn_url} slideCount={artifact.page_count} />;
    
    case 'webpage':
      return <iframe src={artifact.preview_url} sandbox="allow-scripts" />;
    
    case 'data':
      if (artifact.content_type === 'application/json') {
        return <JSONViewer url={artifact.cdn_url} />;
      }
      break;
    
    case 'archive':
      return <ArchiveViewer manifestUrl={artifact.preview_url} fileCount={artifact.file_count} />;
  }
  
  // 默认下载
  return <DefaultViewer artifact={artifact} onDownload={onDownload} />;
}
```

**产物清单展示（前端 UI）：**

```typescript
// 产物列表卡片
function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  return (
    <div className="artifact-grid">
      {artifacts.map(artifact => (
        <div key={artifact.id} className="artifact-card">
          <div className="artifact-icon">
            {artifact.category === 'image' && <ImageIcon />}
            {artifact.category === 'document' && <FileTextIcon />}
            {artifact.category === 'spreadsheet' && <TableIcon />}
            {artifact.category === 'presentation' && <PresentationIcon />}
            {artifact.category === 'webpage' && <GlobeIcon />}
            {artifact.category === 'archive' && <ArchiveIcon />}
          </div>
          <div className="artifact-info">
            <h4>{artifact.name}</h4>
            <p>{formatFileSize(artifact.size)}</p>
            {artifact.thumbnail_url && (
              <img src={artifact.thumbnail_url} alt="" className="thumbnail" />
            )}
          </div>
          <div className="artifact-actions">
            <button onClick={() => openPreview(artifact)}>预览</button>
            <button onClick={() => download(artifact)}>下载</button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

**访问链路：**

```
Claw 前端请求产物
        │
        ▼
TaskAPI: GET /{task_id}/runs/{run_id}/artifacts/{name}/url
        │
        ▼
生成 OSS 预签名 URL（有效期 3600s）
        │
        ▼
前端直接访问 OSS URL 下载/预览

钉钉群推送产物
        │
        ▼
产物上传 OSS 后，自动触发 CDN 预热
        │
        ▼
钉钉消息中使用 CDN URL（长期有效）
```

---

## 5. 自然语言调整 → 脚本同步更新

### 5.1 核心问题

用户修改 `description` 后，如何判断**脚本是否需要更新**？

**不能简单对比 description 字符串**，因为：
- 用户可能只是修正了错别字，语义未变
- 用户可能加了半句补充，核心逻辑未变
- 用户可能完全改变了需求，脚本必须重写

### 5.2 差异检测策略（三层检测）

```
用户提交 update {task_id, description: "新描述"}
        │
        ▼
┌─────────────────┐
│  第一层：哈希检测  │
│  description_hash│
│  != 当前 hash ?  │
└────────┬────────┘
         │
    No   │   Yes
    ┌────┘    └────┐
    ▼              ▼
 直接返回      ┌─────────────────┐
 scriptStale   │  第二层：语义检测  │
 = false       │  LLM 判断语义变化 │
              │  程度（0-100分）  │
              └────────┬────────┘
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
           轻微变化   中度变化   重大变化
           (0-30)   (30-70)   (70-100)
              │        │        │
              ▼        ▼        ▼
           标记      标记       标记
         stale    stale+建议   stale+
         静默处理  前端提示     强制重生成
```

**第一层：哈希检测**

```python
def hash_description(description: str) -> str:
    """对 description 做归一化后哈希"""
    normalized = description.strip().lower()
    normalized = re.sub(r'\s+', ' ', normalized)  # 去除多余空格
    normalized = re.sub(r'[，。？！,.?!]', '', normalized)  # 去除标点
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]
```

**第二层：语义变化评分（LLM 判断）**

```text
System: 你是一个语义变化检测器。判断用户修改后的任务描述与原始描述相比，执行脚本需要改变的程度。

输入：
- 原始描述：{original_description}
- 新描述：{new_description}
- 当前脚本功能摘要：{current_script_summary}

输出 JSON 格式：
{
  "change_score": 0-100,  // 0=完全不需要改，100=必须完全重写
  "change_type": "none" | "minor" | "moderate" | "major",
  "reason": "简要说明为什么是这个分数",
  "suggested_action": "regenerate" | "patch" | "ignore"
}

评分标准：
- 0-30 (minor): 错别字、格式调整、补充无关紧要的背景信息 → ignore 或 patch
- 30-70 (moderate): 调整数据源、增加字段、修改筛选条件 → patch（增量更新）
- 70-100 (major): 改变分析逻辑、改变输出格式、改变业务目标 → regenerate（全量重生成）
```

**第三层：执行结果反馈（运行时检测）**

如果前两层都通过了，但脚本执行时出错：
- 错误信息（如 `KeyError: 'interest_amount'`）回传给 LLM
- LLM 判断是否是描述变化导致的数据结构不匹配
- 若是，自动触发脚本修复（Patch 模式）

### 5.3 脚本更新模式

| 模式 | 触发条件 | 实现方式 | 适用场景 |
|------|---------|---------|---------|
| **全量重生成 (Regenerate)** | `change_score > 70` 或用户手动点击 | 完全重新调用 LLM，生成新脚本，版本号 +1 | 需求完全改变 |
| **增量 Patch** | `30 < change_score <= 70` | LLM 基于当前脚本生成 Diff/Patch，应用修改 | 调整数据源、增加字段、修改条件 |
| **静默保留** | `change_score <= 30` | 仅更新 description，script_status 保持 ready | 错别字修正 |

**增量 Patch 的 Prompt：**

```text
你是一个 Python 代码修改助手。用户修改了任务描述，请基于当前脚本生成修改后的代码。

当前脚本：
```python
{current_script}
```

原始描述：{original_description}
新描述：{new_description}

要求：
1. 尽量保留原有代码结构，只修改必要的部分
2. 如果新描述要求新增数据源，添加相应的请求逻辑
3. 如果新描述要求改变输出格式，修改产物生成部分
4. 如果新描述要求新增计算逻辑，在适当位置插入
5. 输出完整的修改后脚本（不是 diff）
```

### 5.4 更新流程时序图

```sequence
Claw前端 ->> TaskAPI: POST /update {task_id, description: "新描述"}
TaskAPI ->> TaskService: updateTask(task_id, patch)

TaskService ->> TaskService: calcHash(new_description)
TaskService ->> MySQL: SELECT current_description_hash

alt hash 不同
    TaskService ->> ScriptService: evaluateSemanticChange(
        original=old_desc, 
        new=new_desc,
        current_script=task.script_content
    )
    ScriptService ->> LLMService: semanticDiff(old, new, script_summary)
    LLMService -->> ScriptService: {change_score: 65, change_type: "moderate"}
    
    alt change_score > 70
        ScriptService -->> TaskService: action="regenerate"
        TaskService ->> MySQL: UPDATE script_status='stale'
        TaskService -->> TaskAPI: {task, scriptStale: true, actionRequired: "regenerate"}
        TaskAPI -->> Claw前端: 200 OK + scriptStale
        
        Claw前端 ->> Claw前端: 弹窗"需求已变更，建议重新生成脚本"
        Claw前端 ->> TaskAPI: POST /{id}/regenerate-script
        TaskAPI ->> ScriptService: regenerateScript(task_id)
        ScriptService ->> LLMService: generateScript(full_context)
        LLMService -->> ScriptService: new_script
        ScriptService ->> ScriptScanner: scan(new_script)
        ScriptService ->> OSS: upload(new_script, v+1)
        ScriptService ->> MySQL: UPDATE script_status='ready', script_version=+1
        ScriptService ->> EventBus: ScriptReadyEvent
        EventBus ->> Claw前端: WebSocket push
        
    else 30 < change_score <= 70
        ScriptService -->> TaskService: action="patch"
        TaskService ->> MySQL: UPDATE script_status='stale'
        TaskService -->> TaskAPI: {task, scriptStale: true, actionRequired: "patch"}
        TaskAPI -->> Claw前端: 200 OK + scriptStale + suggestPatch
        
        Claw前端 ->> Claw前端: 提示"描述有调整，是否应用增量更新？"
        Claw前端 ->> TaskAPI: POST /{id}/patch-script
        TaskAPI ->> ScriptService: patchScript(task_id, new_description)
        ScriptService ->> LLMService: generatePatch(current_script, old_desc, new_desc)
        LLMService -->> ScriptService: patched_script
        ScriptService ->> ScriptScanner: scan(patched_script)
        ScriptService ->> OSS: upload(patched_script, v+1)
        ScriptService ->> MySQL: UPDATE script_status='ready', script_version=+1
        
    else change_score <= 30
        ScriptService -->> TaskService: action="ignore"
        TaskService ->> MySQL: UPDATE description=new_desc (script_status 不变)
        TaskService -->> TaskAPI: {task, scriptStale: false}
        TaskAPI -->> Claw前端: 200 OK
    end
    
else hash 相同
    TaskService ->> MySQL: UPDATE 其他字段
    TaskService -->> TaskAPI: {task, scriptStale: false}
    TaskAPI -->> Claw前端: 200 OK
end
```

### 5.5 执行失败驱动的脚本自修复

如果脚本执行失败，且错误可能是由于 description 与脚本不匹配导致：

```python
def handle_execution_failure(run: TaskRun, task: ScheduledTask, error: str):
    """
    判断是否需要自动修复脚本
    """
    # 判断错误类型是否可修复
    auto_fixable_patterns = [
        r"KeyError: ['\"](\w+)['\"]",           # 字段不存在
        r"IndexError",                            # 数组越界（可能数据结构变了）
        r"HTTP (404|400)",                       # 接口参数错误
        r"No such file or directory",             # 路径问题
    ]
    
    is_auto_fixable = any(re.search(p, error) for p in auto_fixable_patterns)
    
    if is_auto_fixable and task.auto_fix_enabled:
        # 触发自动修复
        ScriptService.auto_fix(
            task_id=task.id,
            current_script=task.script_content,
            error_message=error,
            execution_log=run.log_text,
        )
        # 修复后自动重试执行（最多 1 次）
        ExecutionService.execute_now(task, is_retry=True)
```

**Auto-fix Prompt：**

```text
用户的定时任务脚本执行失败了，请根据错误信息修复脚本。

当前脚本：
```python
{current_script}
```

任务描述：{description}

执行错误：
{error_message}

执行日志（最后 50 行）：
{execution_log}

请分析错误原因，修复脚本，并返回修改后的完整代码。
注意：
- 如果是字段名变化，请更新字段引用
- 如果是接口参数错误，请修正参数
- 如果是数据结构变化，请添加兼容处理
```

---

## 6. 下次执行的完整链路

### 6.1 从定时触发到产物交付

```
时间线：T-30s → T-0（触发时刻）→ T+5s → T+10s → T+30s

T-30s: XXL-JOB 调度器唤醒
       └─> 调用 /no_auth/v1/scheduled-tasks/dispatch-tick

T-0:    DispatchService 查询到期任务
       └─> SELECT ... WHERE next_run_at <= NOW()
       └─> 获取 Redis 锁
       └─> 提交 ExecutionService 执行

T+1s:   ExecutionService 开始执行
       └─> 检查本地脚本缓存（/var/cache/scheduled-tasks/{oss_key_hash}.py）
       └─> 缓存 miss：从 OSS 下载脚本
       └─> 启动 Docker Sandbox
       └─> 注入环境变量，挂载输出目录

T+5s:   Sandbox 内脚本执行
       └─> 调用数据源 API 拉取数据
       └─> 数据分析/计算
       └─> 生成产物到 OUTPUT_DIR
       └─> stdout 输出 JSON 摘要
       └─> 容器退出

T+8s:   ExecutionService 收集产物
       └─> 扫描 OUTPUT_DIR
       └─> 上传 OSS
       └─> 写入 task_artifact 表
       └─> CDN 同步（如需钉钉推送）

T+10s:  生成执行报告
       └─> 构建 markdown 摘要
       └─> 写入 task_run.execution_result
       └─> 更新 task_run.status = 'success'

T+12s:  推送通知
       └─> 钉钉群机器人推送（如配置）
       └─> Claw 对话推送（如配置）

T+15s:  清理与收尾
       └─> 删除本地工作目录
       └─> 释放 Redis 锁
       └─> 计算并更新 next_run_at
       └─> 记录执行日志到集中日志系统
```

### 6.2 脚本缓存策略

执行节点本地缓存脚本，避免每次执行都请求 OSS：

```python
class ScriptCache:
    CACHE_DIR = "/var/cache/scheduled-tasks"
    TTL_SECONDS = 3600  # 1 小时
    
    def get(self, oss_key: str) -> Optional[str]:
        cache_path = self._cache_path(oss_key)
        if not os.path.exists(cache_path):
            return None
        
        # 检查是否过期
        mtime = os.path.getmtime(cache_path)
        if time.time() - mtime > self.TTL_SECONDS:
            os.remove(cache_path)
            return None
        
        return cache_path
    
    def put(self, oss_key: str, content: bytes):
        cache_path = self._cache_path(oss_key)
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, 'wb') as f:
            f.write(content)
    
    def invalidate(self, task_id: int):
        """任务脚本更新后，清除该任务的所有缓存版本"""
        pattern = os.path.join(self.CACHE_DIR, f"*{task_id}*")
        for path in glob.glob(pattern):
            os.remove(path)
```

**缓存失效时机：**
- 脚本更新（regenerate / patch）后，调用 `invalidate(task_id)`
- 定期清理（cron job 每小时清理过期缓存）

### 6.3 执行版本一致性保障

**问题：** 任务执行过程中，用户可能同时更新了脚本，如何确保执行使用的是正确的脚本版本？

**方案：执行时快照**

```python
def execute(task: ScheduledTask):
    # 执行开始时，快照当前脚本版本
    script_version_at_start = task.script_version
    script_oss_key_at_start = task.oss_object_key
    
    # 下载脚本（使用快照的 oss_key）
    script_path = download_script(script_oss_key_at_start)
    
    # 执行...
    
    # 写入执行记录时，记录快照版本
    run.script_version_used = script_version_at_start
    run.script_oss_key = script_oss_key_at_start
```

这样即使执行过程中脚本被更新，`task_run` 表也能精确追溯到实际执行的脚本版本。

---

## 7. 状态流转与前端感知

### 7.1 脚本状态机

```
                    ┌─────────────┐
         ┌─────────│   pending   │◄────────────────────────┐
         │         │  (等待生成)  │                         │
         │         └──────┬──────┘                         │
         │                │ create / regenerate             │
         │                ▼                                 │
         │         ┌─────────────┐    scan fail             │
         │    ┌───│  generating │────────────┐              │
         │    │   │  (生成中)    │            │              │
         │    │   └──────┬──────┘            │              │
         │    │          │ LLM 返回           │              │
         │    │          ▼                   ▼              │
         │    │   ┌─────────────┐      ┌─────────────┐     │
         │    └──▶│    ready    │      │    error    │─────┘
         │        │  (可执行)    │      │  (生成失败)  │ retry
         │        └──────┬──────┘      └─────────────┘
         │               │ description 变更
         │               ▼
         │        ┌─────────────┐
         │        │    stale    │
         │        │  (待更新)    │
         │        └──────┬──────┘
         │               │ patch / regenerate
         │               ▼
         │        ┌─────────────┐
         └───────▶│  generating │
                  └─────────────┘
```

### 7.2 前端状态感知机制

**方式一：WebSocket / SSE（推荐）**

```python
# 后端：脚本生成完成后推送
async def on_script_ready(task_id: int):
    await websocket_manager.broadcast(
        user_id=task.owner_user_id,
        message={
            "type": "script_status_change",
            "task_id": task_id,
            "status": "ready",
            "version": task.script_version,
        }
    )
```

**方式二：轮询（fallback）**

```typescript
// 前端：创建任务后开始轮询
function pollScriptStatus(taskId: number) {
  const interval = setInterval(async () => {
    const res = await fetch(`/scheduled-tasks/${taskId}/script-status`);
    const { status, version } = await res.json();
    
    if (status === 'ready' || status === 'error') {
      clearInterval(interval);
      updateTaskCard(taskId, { scriptStatus: status, scriptVersion: version });
    }
  }, 2000);  // 每 2 秒轮询一次，最多 30 次（60 秒）
}
```

**方式三：执行结果推送**

脚本执行完成后，通过 WebSocket 推送执行结果摘要，前端实时更新卡片上的"上次执行状态"：

```json
{
  "type": "task_executed",
  "task_id": 123,
  "run_id": "run-uuid",
  "status": "success",
  "last_run_status": "success",
  "execution_result_summary": "发现并跟踪 5 家异常客户",
  "artifact_count": 2
}
```

---

## 8. 关键数据流总结

### 8.1 创建 → 生成 → 执行 → 交付（首次）

```
用户描述 ──▶ TaskService.create() ──▶ MySQL (script_status='pending')
                                              │
                                              ▼ (异步)
                                        ScriptService.generate()
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        ▼                     ▼                     ▼
                   LLM 生成脚本         AST 安全扫描          上传 OSS
                        │                     │                     │
                        ▼                     ▼                     ▼
                   格式化代码          通过/失败            更新 MySQL
                        │                     │              script_status='ready'
                        └─────────────────────┘                     │
                                                                    ▼
                                                              XXL-JOB 调度
                                                                    │
                                                                    ▼
                                                              ExecutionService
                                                                    │
                                          ┌─────────────────────────┼─────────────────────────┐
                                          ▼                         ▼                         ▼
                                    下载脚本到缓存            启动 Docker Sandbox            收集产物
                                          │                         │                         │
                                          ▼                         ▼                         ▼
                                    执行 Python 脚本          stdout/stderr 捕获          上传 OSS
                                          │                         │                         │
                                          └─────────────────────────┴─────────────────────────┘
                                                                    │
                                                                    ▼
                                                              生成执行记录
                                                              推送钉钉/对话
                                                              更新 next_run_at
```

### 8.2 调整 → 检测 → 更新 → 再次执行

```
用户修改描述 ──▶ TaskService.update()
                        │
                        ▼
               hash 对比 → 不同
                        │
                        ▼
               LLM 语义变化评分
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
           ignore    patch    regenerate
              │         │         │
              ▼         ▼         ▼
           无操作    增量更新   全量重生成
                        │         │
                        ▼         ▼
                   新脚本上传 OSS
                        │
                        ▼
                   script_version +1
                   script_status='ready'
                        │
                        ▼
                   推送 ScriptReadyEvent
                        │
                        ▼
                   前端更新状态
                        │
                        ▼
                   下次 XXL-JOB tick 执行新脚本
```

---

## 9. 待确认事项

1. **LLM 服务选型**：使用内部大模型服务还是外部 API（GPT-4/Claude）？是否有专门的脚本生成服务？
2. **数据源注册中心**：可用数据源的 Schema 如何动态维护？是否需要独立的数据源注册服务？
3. **Docker-in-Docker**：K8s 执行节点是否支持 DinD？还是改用 containerd + crun？
4. **语义评分阈值**：`change_score` 的 30/70 分界线是否需要根据实际运行数据调优？
5. **自动修复策略**：执行失败后自动重试和自动修复的开关是否交给用户配置？
6. **一次性任务**：若后端 v1 不支持 `at` 类型，一次性任务的前端降级方案（创建后自动禁用）是否可接受？

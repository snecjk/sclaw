# 云端定时任务服务（Scheduled Tasks Cloud Service）设计文档

> 本文档聚焦**云端后端服务**的完整架构设计，面向独立后端项目（非 Claw 前端）。前端对接仅在与后端交互边界处简要说明。
> 
> **工作流（WORKFLOW）暂不包含，后续单独确定。**

---

## 目录

1. [服务边界与上下文](#1-服务边界与上下文)
2. [系统架构](#2-系统架构)
3. [数据模型](#3-数据模型)
4. [核心流程时序图](#4-核心流程时序图)
5. [模块详细设计](#5-模块详细设计)
6. [存储设计](#6-存储设计)
7. [安全设计](#7-安全设计)
8. [异常处理与重试](#8-异常处理与重试)
9. [监控与可观测性](#9-监控与可观测性)
10. [部署与扩容](#10-部署与扩容)

---

## 1. 服务边界与上下文

### 1.1 上下文图（C4 Context）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              外部系统                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │   Claw 桌面   │  │   钉钉服务   │  │  知多星服务  │  │  数据源服务  │ │
│  │   端 (Electron│  │   (推送)     │  │   (AI Agent) │  │   (总部对账  │ │
│  │    / Web)     │  │              │  │              │  │    客户成本) │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                 │                 │                 │        │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────┘
          │                 │                 │                 │
          │ HTTPS           │ HTTPS           │ RPC/HTTP        │ RPC/HTTP
          │                 │                 │                 │
┌─────────▼─────────────────▼─────────────────▼─────────────────▼────────┐
│                                                                      │
│              Scheduled Tasks Cloud Service (本系统)                   │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │  Task API    │  │   Script     │  │   Execution  │  │  Notifi- │ │
│  │  (用户接口)   │  │  Generator   │  │   Engine     │  │  cation  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
          │
          │ 内部读写
          │
┌─────────▼────────────────────────────────────────────────────────────┐
│                              基础设施                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │   MySQL      │  │    OSS       │  │    Redis     │  │ XXL-JOB  │ │
│  │  (任务/执行  │  │  (脚本/产物)  │  │  (缓存/锁/   │  │ (定时调度)│ │
│  │   记录)      │  │              │  │   队列)      │  │          │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 职责边界

| 系统 | 职责 | 不职责 |
|------|------|--------|
| **Claw 前端** | 用户交互、表单填写、结果展示、产物预览 | 不执行脚本、不存储任务主数据 |
| **本服务 (Scheduled Tasks)** | 任务 CRUD、脚本生成、调度触发、沙箱执行、产物存储、通知推送 | 不处理 Claw 的即时对话逻辑、不替代 Gateway 本地 cron |
| **知多星服务** | 提供 AI Agent 能力（当前 v1 回退模式使用） | 不管理定时任务元数据 |
| **数据源服务** | 提供总部对账、客户成本等业务数据接口 | 不处理定时调度 |

---

## 2. 系统架构

### 2.1 总体架构（微服务/模块化单体）

建议 v1 采用**模块化单体**（Modular Monolith），部署为一个服务，内部按模块隔离。v2 再根据负载拆分为微服务。

```
┌─────────────────────────────────────────────────────────────────┐
│                    scheduled-tasks-service                      │
│                    (Spring Boot / Go / Python)                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    API Layer                             │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │   │
│  │  │ REST       │  │ Auth       │  │ Rate Limit /       │ │   │
│  │  │ Controller │  │ Middleware │  │ Request Validate   │ │   │
│  │  │ (用户接口)  │  │ (SSO验签)  │  │                    │ │   │
│  │  └────────────┘  └────────────┘  └────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌───────────────────────────▼──────────────────────────────┐   │
│  │                   Service Layer                           │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │   │
│  │  │ Task       │  │ Script     │  │ Dispatch           │  │   │
│  │  │ Service    │  │ Service    │  │ Service            │  │   │
│  │  │ (任务管理)  │  │ (脚本生成)  │  │ (调度与触发)        │  │   │
│  │  └────────────┘  └────────────┘  └────────────────────┘  │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │   │
│  │  │ Execution  │  │ Artifact   │  │ Notification       │  │   │
│  │  │ Service    │  │ Service    │  │ Service            │  │   │
│  │  │ (沙箱执行)  │  │ (产物管理)  │  │ (通知推送)          │  │   │
│  │  └────────────┘  └────────────┘  └────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌───────────────────────────▼──────────────────────────────┐   │
│  │                  Repository / Client Layer                │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │   │
│  │  │ Task       │  │ TaskRun    │  │ OSS Client         │  │   │
│  │  │ Repository │  │ Repository │  │ (Aliyun / MinIO)   │  │   │
│  │  └────────────┘  └────────────┘  └────────────────────┘  │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │   │
│  │  │ LLM Client │  │ Redis      │  │ DingTalk /         │  │   │
│  │  │ (ScriptGen)│  │ Client     │  │ Claw Push Client   │  │   │
│  │  └────────────┘  └────────────┘  └────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 职责 | 关键技术点 |
|------|------|-----------|
| **Task Service** | 任务 CRUD、启停、删除、列表查询、详情查询 | 数据校验、乐观锁、软删除 |
| **Script Service** | 脚本生成（LLM 调用）、脚本存储、脚本版本管理、脚本安全扫描 | 异步调用 LLM、Prompt 模板工程、代码 AST 扫描 |
| **Dispatch Service** | 接收 XXL-JOB tick、筛选到期任务、触发执行、处理手动触发请求 | 分布式锁防止重复触发、任务状态机 |
| **Execution Service** | 准备执行环境、下载脚本、启动 Sandbox、收集产物、生成执行报告 | 容器运行时（Docker/Containerd）、资源限制 |
| **Artifact Service** | 产物上传 OSS、生成访问 URL（签名 URL / CDN URL）、产物元数据管理、过期清理 | OSS 预签名、CDN 刷新 |
| **Notification Service** | 钉钉群机器人推送、Claw 对话消息推送、推送失败重试 | Markdown 格式化、富媒体消息 |

---

## 3. 数据模型

### 3.1 ER 图

```
┌─────────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
│   scheduled_task    │       │     task_run        │       │   task_artifact     │
├─────────────────────┤       ├─────────────────────┤       ├─────────────────────┤
│ PK id (bigint)      │──1:N──│ PK id (bigint)      │──1:N──│ PK id (bigint)      │
│    owner_user_id    │       │ FK task_id          │       │ FK run_id           │
│    name (unique)    │       │    run_id (uuid)    │       │    name             │
│    task_type        │       │    status           │       │    size             │
│    description      │       │    outcome          │       │    content_type     │
│    cron_expr        │       │    started_at       │       │    oss_key          │
│    enabled          │       │    completed_at     │       │    cdn_url          │
│    next_run_at      │       │    duration_ms      │       │    created_at       │
│    last_run_at      │       │    execution_result │       └─────────────────────┘
│    last_run_status  │       │    log_text         │
│    notify_mode      │       │    notify_dingtalk  │
│    site_code        │       │    error_code       │
│    site_name        │       │    error_message    │
│    dingding_id      │       └─────────────────────┘
│    dingding_group_id│
│    dingding_group_na│
│    script_content   │
│    oss_object_key   │
│    script_version   │
│    script_status    │
│    dialog_session_ke│
│    openclaw_gateway_│
│    is_delete        │
│    created_at       │
│    updated_at       │
└─────────────────────┘
              │
              │ 1:N
              ▼
┌─────────────────────┐
│   script_version    │  (脚本版本历史表，用于回滚)
├─────────────────────┤
│ PK id (bigint)      │
│ FK task_id          │
│    version (int)    │
│    oss_key          │
│    content (text)   │
│    generated_by     │  -- 'llm' / 'manual'
│    description_hash │  -- 触发生成时的 description 哈希
│    created_at       │
└─────────────────────┘
```

### 3.2 表结构详细定义

#### `scheduled_task`（任务主表）

```sql
CREATE TABLE scheduled_task (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_user_id       VARCHAR(32)  NOT NULL COMMENT '归属用户工号',
  name                VARCHAR(128) NOT NULL COMMENT '任务名称',
  task_type           VARCHAR(32)  NOT NULL DEFAULT 'MONITOR_TASK' COMMENT 'MONITOR_TASK / WORKFLOW',
  description         VARCHAR(2000)         COMMENT '任务说明/指令描述',
  cron_expr           VARCHAR(64)  NOT NULL COMMENT '5段cron表达式',
  enabled             TINYINT      NOT NULL DEFAULT 1 COMMENT '是否启用',
  next_run_at         DATETIME              COMMENT '下次执行时间（Asia/Shanghai）',
  last_run_at         DATETIME              COMMENT '最近执行时间',
  last_run_status     VARCHAR(32)           COMMENT 'success / dispatch_failed / timeout / error',

  -- 通知与推送
  notify_mode         VARCHAR(32)  NOT NULL DEFAULT 'none' COMMENT 'none / dingtalk_group / dialog / both',
  site_code           VARCHAR(32)           COMMENT '网点编码',
  site_name           VARCHAR(128)          COMMENT '网点名称',
  dingding_id         VARCHAR(64)           COMMENT '钉钉用户ID',
  dingding_group_id   VARCHAR(128)          COMMENT '钉钉群ID',
  dingding_group_name VARCHAR(128)          COMMENT '钉钉群名称',

  -- 脚本
  script_content      MEDIUMTEXT            COMMENT '脚本内容（≤64KB时存原文）',
  oss_object_key      VARCHAR(512)          COMMENT '脚本OSS路径',
  script_version      INT          NOT NULL DEFAULT 0 COMMENT '当前脚本版本号',
  script_status       VARCHAR(32)  NOT NULL DEFAULT 'pending' COMMENT 'pending / generating / ready / stale / error',

  -- Claw 回话
  dialog_session_key  VARCHAR(256)          COMMENT '对话推送会话键',
  openclaw_gateway_url VARCHAR(512)         COMMENT 'Gateway地址（本地任务回退用）',

  -- 软删除
  is_delete           TINYINT      NOT NULL DEFAULT 0 COMMENT '0=正常 1=已删除',

  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_owner_name (owner_user_id, name, is_delete),
  KEY idx_owner_enabled (owner_user_id, enabled, is_delete),
  KEY idx_next_run (next_run_at, enabled, is_delete),
  KEY idx_owner_delete (owner_user_id, is_delete)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定时任务主表';
```

#### `task_run`（执行记录表）

```sql
CREATE TABLE task_run (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id             BIGINT UNSIGNED NOT NULL COMMENT '关联任务ID',
  run_id              VARCHAR(64)  NOT NULL COMMENT '本次执行UUID',
  status              VARCHAR(32)  NOT NULL COMMENT 'pending / running / success / failed / timeout',
  outcome             VARCHAR(32)           COMMENT 'dispatched / dispatch_failed / dry_run / skipped',

  started_at          DATETIME     NOT NULL COMMENT '开始时间',
  completed_at        DATETIME              COMMENT '完成时间',
  duration_ms         INT UNSIGNED          COMMENT '执行耗时(ms)',

  execution_result    MEDIUMTEXT            COMMENT '知多星返回的markdown正文 / 脚本执行摘要',
  log_text            LONGTEXT              COMMENT 'trace、推送消息等摘要日志',

  -- 推送状态
  notify_dingtalk_ok  TINYINT               COMMENT '钉钉群推送是否成功',
  notify_dialog_ok    TINYINT               COMMENT '对话推送是否成功',

  -- 错误信息
  error_code          VARCHAR(64)           COMMENT '错误码',
  error_message       VARCHAR(2000)         COMMENT '错误描述',

  -- 脚本版本快照
  script_version_used INT                   COMMENT '执行时使用的脚本版本',
  script_oss_key      VARCHAR(512)          COMMENT '执行时脚本的OSS路径快照',

  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_run_id (run_id),
  KEY idx_task_status (task_id, status),
  KEY idx_task_created (task_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定时任务执行记录';
```

#### `task_artifact`（产物表）

```sql
CREATE TABLE task_artifact (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id              BIGINT UNSIGNED NOT NULL COMMENT '关联执行记录',
  name                VARCHAR(256) NOT NULL COMMENT '文件名',
  size                BIGINT UNSIGNED       COMMENT '文件大小(bytes)',
  content_type        VARCHAR(128)          COMMENT 'MIME类型',
  oss_key             VARCHAR(512) NOT NULL COMMENT 'OSS对象路径',
  cdn_url             VARCHAR(1024)         COMMENT 'CDN访问地址（已推钉钉群的产物）',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务执行产物';
```

#### `script_version`（脚本版本历史）

```sql
CREATE TABLE script_version (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id             BIGINT UNSIGNED NOT NULL COMMENT '关联任务ID',
  version             INT          NOT NULL COMMENT '版本号',
  oss_key             VARCHAR(512) NOT NULL COMMENT '该版本脚本的OSS路径',
  content_snapshot    MEDIUMTEXT            COMMENT '脚本内容快照（≤64KB）',
  generated_by        VARCHAR(32)  NOT NULL DEFAULT 'llm' COMMENT 'llm / manual / system',
  description_hash    VARCHAR(64)           COMMENT '触发生成时的description哈希',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_task_version (task_id, version),
  KEY idx_task_created (task_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='脚本版本历史';
```

---

## 4. 核心流程时序图

### 4.1 创建任务 + 异步生成脚本

```sequence
Claw前端 ->> TaskAPI: POST /scheduled-tasks
    {name, cron_expr, description, ...}
TaskAPI ->> TaskService: createTask(input)
TaskService ->> MySQL: INSERT scheduled_task
    script_status='pending'
TaskService -->> TaskAPI: TaskDTO
TaskAPI -->> Claw前端: 201 Created {task}

TaskService ->> EventBus: publish TaskCreatedEvent

EventBus ->> ScriptService: on TaskCreatedEvent
ScriptService ->> LLMService: generateScript(name, description, site_code)
LLMService -->> ScriptService: scriptContent

ScriptService ->> ScriptScanner: securityScan(scriptContent)
ScriptScanner -->> ScriptService: PASS / FAIL

alt 扫描通过
    ScriptService ->> OSS: uploadScript(taskId, v1, scriptContent)
    OSS -->> ScriptService: ossKey
    ScriptService ->> MySQL: UPDATE scheduled_task
        SET script_content=?, oss_object_key=?, 
            script_version=1, script_status='ready'
    ScriptService ->> EventBus: publish ScriptReadyEvent
else 扫描失败
    ScriptService ->> MySQL: UPDATE scheduled_task
        SET script_status='error'
    ScriptService ->> EventBus: publish ScriptGenFailedEvent
end

EventBus ->> Claw前端(WebSocket): ScriptReadyEvent / ScriptGenFailedEvent
```

### 4.2 XXL-JOB 调度触发执行

```sequence
XXL-JOB ->> DispatchAPI: POST /no_auth/v1/scheduled-tasks/dispatch-tick
    (内部接口，XXL-JOB 定时调用)
DispatchAPI ->> DispatchService: dispatchTick()
DispatchService ->> MySQL: SELECT * FROM scheduled_task
    WHERE enabled=1 AND is_delete=0
    AND next_run_at <= NOW()
    FOR UPDATE SKIP LOCKED
MySQL -->> DispatchService: tasks[]

loop 每个到期任务
    DispatchService ->> Redis: SET task:{id}:lock EX 60 NX
    
    alt 获取锁成功
        DispatchService ->> ExecutionService: execute(task)
        
        alt task.oss_object_key 存在
            ExecutionService ->> OSS: downloadScript(ossKey)
            OSS -->> ExecutionService: scriptFile
            
            ExecutionService ->> Sandbox: run(
                scriptFile,
                env={TASK_ID, SITE_CODE, OUTPUT_DIR, STO_TOKEN},
                limits={cpu:1, mem:512MB, timeout:30s}
            )
            Sandbox ->> 数据源服务: HTTP RPC 拉取数据
            数据源服务 -->> Sandbox: data
            Sandbox ->> Sandbox: 数据分析/计算
            Sandbox ->> OSS: uploadArtifacts(OUTPUT_DIR)
            Sandbox -->> ExecutionService: {exitCode, stdout, stderr}
            
            ExecutionService ->> ArtifactService: registerArtifacts(runId, ossKeys)
            ArtifactService ->> MySQL: INSERT task_artifact
            
            ExecutionService ->> NotificationService: pushResult(task, run, artifacts)
            NotificationService ->> 钉钉服务: 群机器人推送(markdown+链接)
            
            ExecutionService ->> MySQL: INSERT task_run {status='success', ...}
            
        else task.oss_object_key 为空
            ExecutionService ->> 知多星服务: dispatchQuestion(description)
            知多星服务 -->> ExecutionService: markdownResult
            ExecutionService ->> MySQL: INSERT task_run {status='success', execution_result=markdown}
        end
        
        ExecutionService ->> TaskService: updateNextRun(taskId, cron_expr)
        TaskService ->> MySQL: UPDATE next_run_at = calcNext(cron_expr)
        
        DispatchService ->> Redis: DEL task:{id}:lock
        
    else 获取锁失败
        DispatchService ->> Logger: log "Task ${id} skipped, locked by another executor"
    end
end
```

### 4.3 用户修改任务触发脚本更新

```sequence
Claw前端 ->> TaskAPI: POST /scheduled-tasks/update
    {task_id, description: "新的描述..."}
TaskAPI ->> TaskService: updateTask(taskId, patch)
TaskService ->> MySQL: SELECT description_hash FROM scheduled_task WHERE id=?
TaskService ->> TaskService: calcHash(patch.description)

alt description 发生变化
    TaskService ->> MySQL: UPDATE scheduled_task
        SET description=?, script_status='stale'
    TaskService -->> TaskAPI: TaskDTO {scriptStale: true}
    TaskAPI -->> Claw前端: 200 OK {task, scriptStale: true}
    
    Claw前端 ->> Claw前端: 弹窗提示"描述已变更，是否重新生成脚本？"
    Claw前端 ->> TaskAPI: POST /{task_id}/regenerate-script
    
    TaskAPI ->> ScriptService: regenerateScript(taskId)
    ScriptService ->> MySQL: SELECT name, description, site_code WHERE id=?
    ScriptService ->> LLMService: generateScript(...)
    LLMService -->> ScriptService: newScriptContent
    ScriptService ->> ScriptScanner: securityScan(...)
    ScriptService ->> OSS: uploadScript(taskId, v2, ...)
    ScriptService ->> MySQL: 
        UPDATE scheduled_task SET oss_object_key=?, script_version=2, script_status='ready'
        INSERT script_version (task_id, version=2, ...)
    ScriptService ->> EventBus: publish ScriptReadyEvent
    EventBus ->> Claw前端: WebSocket push
    
else description 未变
    TaskService ->> MySQL: UPDATE scheduled_task SET ...
    TaskService -->> TaskAPI: TaskDTO {scriptStale: false}
end
```

---

## 5. 模块详细设计

### 5.1 Task Service（任务管理）

**核心类/接口：**

```python
class TaskService:
    def create_task(self, input: TaskCreateInput, owner: UserContext) -> Task:
        """
        1. 校验 name 在同用户下唯一
        2. 校验 cron_expr 合法性（croniter）
        3. 计算 next_run_at（Asia/Shanghai）
        4. 自动补全 site_code / dingding_group_id（从 SSO 上下文）
        5. 落库，script_status='pending'
        6. 发布 TaskCreatedEvent
        """
        
    def update_task(self, task_id: int, patch: TaskUpdateInput, owner: UserContext) -> Task:
        """
        1. 校验任务存在且归属当前用户
        2. 若修改 cron_expr，重新计算 next_run_at
        3. 若修改 enabled：false→next_run_at=null；true→按 cron_expr 重算
        4. 若修改 description，标记 script_status='stale'
        5. 落库
        """
        
    def delete_task(self, task_id: int, owner: UserContext):
        """
        逻辑删除：is_delete=1, enabled=0, next_run_at=null
        name 加后缀 __del_{id}
        异步删除 OSS 上的脚本（若存在）
        """
        
    def list_tasks(self, owner: UserContext) -> List[TaskSummary]:
        """
        查询当前用户未删除的全部任务
        返回精简字段（id, name, enabled, next_run_at, cron_expr, last_run_status）
        """
        
    def get_task_details(self, task_id: int, owner: UserContext) -> Task:
        """
        查询单条任务详情（全字段）
        """
        
    def toggle_task(self, task_id: int, enabled: bool, owner: UserContext) -> Task:
        """
        启停任务，通过 update_task 实现
        """
        
    def trigger_task(self, task_id: int, owner: UserContext) -> TriggerResult:
        """
        手动触发前置校验：
        - 任务存在、未删除、enabled=true
        - site_code 非空
        然后调用 ExecutionService.execute_now(task)
        """
        
    def calc_next_run(self, cron_expr: str, tz: str = 'Asia/Shanghai') -> datetime:
        """
        基于 croniter 计算下次执行时间
        """
```

**状态机：**

```
                    create_task
                         │
                         ▼
                    ┌─────────┐
         ┌─────────│ pending │◄────────┐
         │         └────┬────┘         │
         │              │ LLM生成成功    │ regenerate-script
         │              ▼                │
         │         ┌─────────┐          │
         │    ┌───▶│  ready  │──────────┘
         │    │    └────┬────┘
         │    │         │ description变化
         │    │         ▼
         │    │    ┌─────────┐
         │    └────│  stale  │
         │    重生成│         │
         │         └────┬────┘
         │              │ LLM生成失败
         │              ▼
         │         ┌─────────┐
         └─────────│  error  │
                   └─────────┘
```

### 5.2 Script Service（脚本生成与管理）

**核心职责：**
1. 调用 LLM 生成 Python 脚本
2. 脚本安全扫描（禁用危险调用）
3. 脚本上传 OSS
4. 版本管理

**Prompt 模板：**

```jinja2
你是一位为物流行业生成数据分析脚本的 AI 助手。

请根据以下信息生成一个标准 Python 3 脚本：

【任务信息】
- 任务名称：{{ name }}
- 任务描述：{{ description }}
- 用户网点编码：{{ site_code }}
- 当前时间：{{ now }}

【可用数据源】（通过环境变量中的 STO_TOKEN 调用）
- 总部对账接口：GET /api/v1/hq/reconciliation?site_code={SITE_CODE}&date={YYYY-MM-DD}
- 客户成本接口：GET /api/v1/customer/cost?site_code={SITE_CODE}&month={YYYY-MM}
- 日均发件接口：GET /api/v1/volume/daily?site_code={SITE_CODE}&start_date=&end_date=

【脚本要求】
1. 脚本必须是自包含的标准 Python 3 代码，不要外部依赖（标准库即可）
2. 通过 os.environ['STO_TOKEN'] 获取鉴权 Token
3. 通过 os.environ['SITE_CODE'] 获取网点编码
4. 将分析结果和产物写入 os.environ['OUTPUT_DIR'] 目录
5. 产物命名规范：report_{YYYYMMDD}.{ext}
6. 在 stdout 输出执行摘要（JSON格式）：{"summary": "...", "rows_processed": N}
7. 禁止使用的模块和函数：os.system, subprocess, eval, exec, compile, __import__, socket
8. 网络请求只能访问 *.sto.cn 域名

【输出格式】
直接返回 Python 代码，不要 Markdown 代码块标记，不要解释说明。
```

**安全扫描规则（ScriptScanner）：**

| 级别 | 规则 | 处理 |
|------|------|------|
| BLOCK | 包含 `os.system`, `subprocess`, `eval`, `exec`, `compile` | 直接拒绝生成，标记 `script_status='error'` |
| BLOCK | 包含 `socket`, `urllib` 非白名单域名 | 直接拒绝 |
| BLOCK | 包含文件系统访问超出 `OUTPUT_DIR` | 直接拒绝 |
| WARN | 包含大量注释掉的危险代码 | 记录日志，人工复核 |
| PASS | 仅使用 `urllib.request`, `http.client` 访问白名单域名 | 通过 |

**脚本版本管理：**
- 每次生成或手动更新递增 `script_version`
- 旧版本写入 `script_version` 历史表
- 执行时快照记录到 `task_run.script_version_used`，确保执行结果可追溯

### 5.3 Dispatch Service（调度服务）

**调度模型：** XXL-JOB 分布式调度

**XXL-JOB 执行器配置：**
```yaml
xxl:
  job:
    admin:
      addresses: http://xxl-job-admin:8080/xxl-job-admin
    executor:
      appname: scheduled-tasks-dispatch
      ip: ''
      port: 9999
      logpath: /data/applogs/xxl-job/jobhandler
      logretentiondays: 30
```

**JobHandler 示例：**
```python
@XxlJob("scheduledTaskDispatchTick")
def dispatch_tick():
    """
    每 30 秒执行一次
    1. 查询到期任务
    2. 分布式锁去重
    3. 提交 ExecutionService 异步执行
    """
    due_tasks = task_repo.find_due_tasks(now=datetime.now(tz='Asia/Shanghai'))
    for task in due_tasks:
        if redis.set(f"task:{task.id}:lock", "1", nx=True, ex=60):
            try:
                execution_service.execute_async(task)
            except Exception as e:
                logger.error(f"Task {task.id} dispatch failed: {e}")
            finally:
                # 执行是异步的，锁由 ExecutionService 释放
                pass
```

**分布式锁策略：**
- 锁 Key：`task:{task_id}:lock`
- 锁时长：60 秒（覆盖脚本最大执行时间 30 秒 + 余量）
- 获取失败：跳过本次 tick，等待下一轮

**next_run_at 计算：**
```python
import croniter
from pytz import timezone

def calc_next_run(cron_expr: str, tz_name: str = 'Asia/Shanghai') -> datetime:
    tz = timezone(tz_name)
    now = datetime.now(tz)
    itr = croniter(cron_expr, now)
    return itr.get_next(datetime)
```

### 5.4 Execution Service（执行引擎）

**两种执行模式：**

| 模式 | 触发条件 | 执行方式 | 产物 |
|------|---------|---------|------|
| **脚本模式** | `oss_object_key != null` | Sandbox 中执行 Python 脚本 | OSS 产物 + markdown 摘要 |
| **知多星回退模式** | `oss_object_key == null` | 调用知多星服务派发 question | markdown 结果 |

**脚本模式执行流程：**

```python
class ExecutionService:
    def execute(self, task: ScheduledTask) -> TaskRun:
        run = TaskRun(task_id=task.id, status='running', started_at=now())
        run_repo.save(run)
        
        try:
            # 1. 准备环境
            work_dir = self._prepare_work_dir(task.id, run.id)
            script_path = self._download_script(task.oss_object_key, work_dir)
            output_dir = os.path.join(work_dir, 'output')
            os.makedirs(output_dir, exist_ok=True)
            
            # 2. 构建环境变量
            env = {
                'TASK_ID': str(task.id),
                'RUN_ID': run.run_id,
                'OWNER_USER_ID': task.owner_user_id,
                'SITE_CODE': task.site_code or '',
                'STO_TOKEN': self._get_sto_token(task.owner_user_id),
                'OUTPUT_DIR': output_dir,
                'TZ': 'Asia/Shanghai',
            }
            
            # 3. 启动 Sandbox
            result = sandbox_runner.run(
                script_path=script_path,
                env=env,
                work_dir=work_dir,
                cpu_limit='1.0',
                mem_limit='512m',
                timeout_sec=30,
                network_policy='whitelist',  # 仅允许 *.sto.cn
            )
            
            # 4. 处理产物
            artifacts = []
            if os.path.exists(output_dir):
                for filename in os.listdir(output_dir):
                    file_path = os.path.join(output_dir, filename)
                    oss_key = artifact_service.upload(run.id, file_path)
                    artifacts.append(Artifact(name=filename, oss_key=oss_key))
            
            # 5. 生成执行摘要
            summary = self._parse_stdout(result.stdout)
            execution_result = self._build_markdown_summary(task, summary, artifacts)
            
            # 6. 更新执行记录
            run.status = 'success'
            run.completed_at = now()
            run.duration_ms = result.duration_ms
            run.execution_result = execution_result
            run.log_text = result.stderr
            run.script_version_used = task.script_version
            run.script_oss_key = task.oss_object_key
            run_repo.update(run)
            
            # 7. 推送通知
            notification_service.push(task, run, artifacts)
            
        except SandboxTimeout:
            run.status = 'timeout'
            run.error_code = 'EXEC_TIMEOUT'
            run.error_message = '脚本执行超过30秒限制'
            run_repo.update(run)
            
        except Exception as e:
            run.status = 'failed'
            run.error_code = 'EXEC_FAILED'
            run.error_message = str(e)
            run_repo.update(run)
            
        finally:
            # 8. 清理工作目录
            self._cleanup_work_dir(work_dir)
            # 9. 释放分布式锁
            redis.delete(f"task:{task.id}:lock")
            # 10. 更新任务下次执行时间
            next_run = calc_next_run(task.cron_expr)
            task_repo.update_next_run(task.id, next_run)
            
        return run
```

**Sandbox Runner 实现方案（推荐）：**

| 方案 | 隔离级别 | 启动速度 | 复杂度 | 推荐度 |
|------|---------|---------|--------|--------|
| **Docker + seccomp** | 进程级 | 1-3 秒 | 中 | ⭐⭐⭐⭐⭐ |
| Firecracker MicroVM | 内核级 | 100-200ms | 高 | ⭐⭐⭐⭐ |
| gVisor | 系统调用拦截 | 500ms | 高 | ⭐⭐⭐⭐ |
| 裸进程 + seccomp-bpf | 弱 | 10ms | 低 | ⭐⭐⭐ |

**v1 推荐 Docker + seccomp 方案：**

```dockerfile
# Dockerfile.sandbox
FROM python:3.11-slim
RUN pip install requests pandas openpyxl
WORKDIR /sandbox
COPY entrypoint.py /entrypoint.py
ENTRYPOINT ["python", "/entrypoint.py"]
```

```python
# sandbox_runner.py (Docker 实现)
import docker

class DockerSandboxRunner:
    def __init__(self):
        self.client = docker.from_env()
        self.image = 'scheduled-tasks-sandbox:v1'
        
    def run(self, script_path, env, work_dir, cpu_limit, mem_limit, timeout_sec, network_policy):
        # 1. 将脚本挂载到容器
        volumes = {
            script_path: {'bind': '/sandbox/script.py', 'mode': 'ro'},
            work_dir: {'bind': '/sandbox/work', 'mode': 'rw'},
        }
        
        # 2. 安全选项
        security_opt = ['no-new-privileges:true']
        
        # 3. 网络限制（白名单模式）
        if network_policy == 'whitelist':
            # 使用自定义 Docker 网络 + iptables 规则限制出站
            network = self._get_restricted_network()
        else:
            network = 'none'
        
        # 4. 启动容器
        container = self.client.containers.run(
            image=self.image,
            command=['python', '/sandbox/script.py'],
            environment=env,
            volumes=volumes,
            network=network,
            cpu_quota=int(float(cpu_limit) * 100000),
            mem_limit=mem_limit,
            timeout=timeout_sec,
            security_opt=security_opt,
            read_only=True,  # 根目录只读
            detach=False,
            remove=True,  # 执行后自动删除
        )
        
        return SandboxResult(
            exit_code=container.exit_code,
            stdout=container.logs(stdout=True, stderr=False),
            stderr=container.logs(stdout=False, stderr=True),
            duration_ms=container.attrs['State']['FinishedAt'] - container.attrs['State']['StartedAt'],
        )
```

### 5.5 Artifact Service（产物管理）

**职责：**
- 执行完成后扫描 `OUTPUT_DIR`，上传文件到 OSS
- 生成临时签名 URL（前端预览/下载）
- 重要产物同步到 CDN（钉钉推送用）
- 定期清理过期产物

**OSS 路径规范：**
```
# 脚本
scheduled-tasks/{owner_user_id}/{task_id}/script_v{version}.py

# 产物
scheduled-tasks/{owner_user_id}/{task_id}/artifacts/{run_id}/{filename}

# 产物元数据（JSON）
scheduled-tasks/{owner_user_id}/{task_id}/artifacts/{run_id}/manifest.json
```

**签名 URL 生成：**
```python
def get_presigned_url(oss_key: str, expires: int = 3600) -> str:
    """生成临时访问链接，有效期默认1小时"""
    return oss_client.sign_url('GET', oss_key, expires)
```

**CDN 同步策略：**
- 执行完成后，所有产物先上传 OSS
- 若 `notify_mode` 包含 `dingtalk_group`，自动将产物同步到 CDN
- CDN URL 格式：`https://cdn.sto.cn/{oss_key}`
- 钉钉推送消息中使用 CDN URL（长期有效）

### 5.6 Notification Service（通知推送）

**通知模式映射：**

| notify_mode | 行为 |
|-------------|------|
| `none` | 不推送，仅保存执行记录 |
| `dingtalk_group` | 推送到 `dingding_group_id` 指定的钉钉群 |
| `dialog` | 推送到 `dialog_session_key` 指定的 Claw 对话 |
| `both` | 同时推送钉钉群和对话 |

**钉钉群推送格式：**
```markdown
## 📊 定时任务执行完成

**任务：** {task.name}
**执行时间：** {run.completed_at}
**状态：** ✅ 成功 / ❌ 失败
**耗时：** {run.duration_ms}ms

**执行摘要：**
{run.execution_result}

**产物下载：**
- [日报表.xlsx]({cdn_url_1})
- [趋势图.png]({cdn_url_2})
```

**推送失败重试：**
- 钉钉推送失败：间隔 30 秒重试，最多 3 次
- 对话推送失败：间隔 10 秒重试，最多 3 次
- 仍失败则记录到 `task_run.notify_dingtalk_ok = false`，不阻断主流程

---

## 6. 存储设计

### 6.1 MySQL

- **主库**：任务 CRUD、调度查询（读多写少）
- **分表策略**：`task_run` 按时间分表或归档（如每月一张表），避免单表过大
- **索引优化**：
  - `scheduled_task`：`idx_next_run` 覆盖调度查询
  - `task_run`：`idx_task_created` 覆盖执行历史查询

### 6.2 OSS

| 存储内容 | Bucket | 生命周期 |
|---------|--------|---------|
| 脚本 | `sto-scheduled-tasks` | 保留 90 天（历史版本） |
| 产物 | `sto-scheduled-tasks` | 保留 30 天 |
| 执行日志 | `sto-scheduled-tasks-logs` | 保留 7 天 |

### 6.3 Redis

| Key 模式 | 用途 | TTL |
|---------|------|-----|
| `task:{id}:lock` | 调度分布式锁 | 60s |
| `task:{id}:script_status` | 脚本生成状态缓存 | 300s |
| `user:{id}:tasks` | 用户任务列表缓存 | 60s |
| `run:{run_id}:artifacts` | 产物元数据缓存 | 3600s |

---

## 7. 安全设计

### 7.1 脚本安全

| 层面 | 措施 |
|------|------|
| **生成时** | LLM Prompt 中明确禁止危险调用；输出后 AST 扫描 |
| **存储时** | 脚本内容 hash 校验，防篡改 |
| **执行时** | Sandbox 隔离（Docker + seccomp）；资源限制；网络白名单 |
| **运行时** | 禁止 root 权限；禁止访问 /etc, /proc, /sys；只读根目录 |

### 7.2 数据安全

- 任务数据按 `owner_user_id` 隔离，所有查询带用户过滤
- `site_code` 等敏感字段不返回给非归属用户
- OSS 产物路径包含随机 run_id，避免遍历猜测

### 7.3 接口安全

- 所有用户接口 SSO 鉴权（`stoToken`）
- `dispatch-tick` 为内部接口（`/no_auth/`），需 IP 白名单或内部 Token
- 限流：单用户 10 次/秒创建，100 次/分钟触发

---

## 8. 异常处理与重试

### 8.1 各类异常处理策略

| 异常场景 | 处理策略 |
|---------|---------|
| LLM 生成脚本超时/失败 | 标记 `script_status='error'`，不重试（让用户重新触发） |
| 脚本安全扫描失败 | 同上，记录具体失败原因到日志 |
| Sandbox 执行超时 | `task_run.status='timeout'`，不重试自动执行 |
| Sandbox 执行内存溢出 | `task_run.status='failed'`，`error_code='OOM'` |
| 数据源接口超时 | 脚本内部应有超时处理；ExecutionService 捕获后记录 |
| OSS 上传失败 | 重试 3 次（指数退避），仍失败则记录错误但标记任务成功 |
| 钉钉推送失败 | 重试 3 次，仍失败标记 `notify_dingtalk_ok=false` |
| MySQL 连接超时 | 连接池自动重连，查询重试 1 次 |

### 8.2 补偿机制

- **调度补偿**：若某次 XXL-JOB tick 因服务重启错过，下次 tick 会批量处理所有到期任务
- **执行补偿**：手动触发不受 cron 限制，可随时补执行
- **通知补偿**：推送失败不阻塞，用户可在执行历史中查看结果

---

## 9. 监控与可观测性

### 9.1 关键指标

| 指标 | 类型 | 告警阈值 |
|------|------|---------|
| `scheduled_tasks_dispatch_tick_duration_ms` | Histogram | P99 > 5s |
| `scheduled_tasks_execution_duration_ms` | Histogram | P99 > 20s |
| `scheduled_tasks_execution_total` | Counter (按 status 分 label) | 失败率 > 5% |
| `scheduled_tasks_script_generation_duration_ms` | Histogram | P99 > 30s |
| `scheduled_tasks_script_generation_failures` | Counter | 连续 5 次失败 |
| `scheduled_tasks_oss_upload_failures` | Counter | 连续 10 次失败 |
| `scheduled_tasks_active_tasks` | Gauge | 按 enabled 统计 |

### 9.2 日志规范

```json
{
  "timestamp": "2026-05-29T09:00:00+08:00",
  "level": "INFO",
  "service": "scheduled-tasks",
  "trace_id": "abc123",
  "span_id": "def456",
  "module": "ExecutionService",
  "message": "Task executed successfully",
  "task_id": 123,
  "run_id": "run-uuid",
  "duration_ms": 15234,
  "status": "success",
  "artifact_count": 2
}
```

### 9.3 链路追踪

- Trace 入口：`dispatch-tick` / `POST /scheduled-tasks` / `POST /trigger`
- 关键 Span：`TaskService.create`, `ScriptService.generate`, `ExecutionService.run`, `Sandbox.run`, `OSS.upload`, `DingTalk.push`

---

## 10. 部署与扩容

### 10.1 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                        K8s Cluster                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Deployment: scheduled-tasks-api (3 replicas)       │   │
│  │  - REST API 服务                                     │   │
│  │  - TaskService, ScriptService, NotificationService   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Deployment: scheduled-tasks-dispatch (2 replicas)  │   │
│  │  - XXL-JOB 执行器                                    │   │
│  │  - DispatchService                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Deployment: scheduled-tasks-executor (5 replicas)  │   │
│  │  - ExecutionService                                  │   │
│  │  - Sandbox Runner (Docker-in-Docker)                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 扩容策略

| 组件 | 扩容触发条件 | 扩容方式 |
|------|------------|---------|
| API 服务 | CPU > 70% 或 QPS > 500 | HPA，max 10 副本 |
| Dispatch | 任务堆积 > 1000 | 增加 XXL-JOB 执行器节点 |
| Executor | 执行队列等待 > 30s | 增加执行节点，Sandbox 并发数 |

### 10.3 资源估算（千级活跃任务）

| 组件 | CPU | 内存 | 存储 |
|------|-----|------|------|
| API 服务 (x3) | 2 核 x3 | 4GB x3 | 20GB SSD |
| Dispatch (x2) | 1 核 x2 | 2GB x2 | 10GB SSD |
| Executor (x5) | 4 核 x5 | 8GB x5 | 100GB SSD（临时产物） |
| MySQL | 8 核 | 32GB | 500GB SSD |
| Redis | 4 核 | 16GB | - |

---

## 附录 A：与 Claw 前端的交互边界

### A.1 Claw 前端 → 本服务（已提供接口）

| 接口 | 用途 |
|------|------|
| `POST /scheduled-tasks` | 创建任务（触发异步脚本生成） |
| `GET /scheduled-tasks/list` | 获取任务列表（前端本地搜索排序） |
| `GET /scheduled-tasks/details?task_id=` | 获取任务详情 |
| `POST /scheduled-tasks/update` | 更新任务（含启停） |
| `POST /scheduled-tasks/delete` | 逻辑删除 |
| `POST /scheduled-tasks/trigger` | 手动触发 |

### A.2 本服务 → Claw 前端（建议新增）

| 机制 | 用途 |
|------|------|
| WebSocket / SSE | 脚本生成完成推送、`script_status` 变更推送 |
| 轮询接口 `GET /{id}/script-status` | 前端轮询脚本生成状态（WebSocket 不可用时 fallback） |

### A.3 前端需处理的特殊场景

- **脚本生成中**：创建任务后 `script_status='pending'`，前端显示加载态
- **脚本生成失败**：`script_status='error'`，前端展示"脚本生成失败，请修改描述后重试"
- **描述变更后脚本过期**：`script_status='stale'`，前端提示重新生成
- **一次性任务**：若后端 v1 仅支持 cron_expr，前端需在到达时间后自动调用 `/update` 禁用任务

---

## 附录 B：待确认事项（与前端/产品对齐）

1. **一次性任务**：后端是否只接受 `cron_expr`？若不支持 `at` 类型，一次性任务需前端在用户指定时间到达后自动调用 `/update` 禁用。
2. **关联工作流**：`task_type: WORKFLOW` 的接口字段扩展时间计划？
3. **LLM 服务**：脚本生成调用的是哪个 LLM 服务？是否有专门的内部 API？
4. **Sandbox 方案**：v1 是否接受 Docker + seccomp 方案？K8s 集群是否支持 Docker-in-Docker？
5. **数据源接口**：脚本中可调用的数据源 API 列表和文档是否已就绪？
6. **OSS/CDN**：Bucket 名称、CDN 域名、预签名 URL 有效期策略是否已确定？

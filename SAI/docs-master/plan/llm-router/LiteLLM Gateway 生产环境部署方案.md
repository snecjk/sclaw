# LiteLLM Gateway 生产环境部署方案

> 文档版本：v1.0 | 更新时间：2026-04-22 | 环境：阿里云 ACK / K8s 生产集群

---

## 一、系统概述

LiteLLM Gateway 作为统一的 LLM 代理网关层，为内部各业务系统提供标准化的 OpenAI 兼容接口，负责多模型路由、鉴权管理、请求缓存及用量日志等底层核心能力。

---

## 二、基础设施组件清单

### 2.1 K8s 工作负载

| 资源类型 | 名称 | 命名空间 | 说明 |
| --- | --- | --- | --- |
| StatefulSet | `devops-litellm-gateway` | `devops-litellm-gateway` | 主服务，2 副本，使用 OpenKruise 控制器 |
| Service (ClusterIP) | `litellm-service` | `devops-litellm-gateway` | 集群内访问入口，端口 4000 |
| ConfigMap | `litellm-config` | `devops-litellm-gateway` | LiteLLM 运行配置文件 |
| Secret | `litellm-secrets` | `devops-litellm-gateway` | 数据库密码、Redis 密码、Master Key 等敏感信息 |

### 2.2 外部依赖组件

| 组件 | 服务类型 | 用途 |
| --- | --- | --- |
| 阿里云 RDS PostgreSQL | 数据库 | 存储用量日志、模型配置、虚拟 Key 等持久化数据 |
| 阿里云 Redis | 缓存 | LLM 响应缓存 + Router 状态共享 + 事务缓冲 |
| 阿里云 SLS（日志服务） | 可观测 | 采集 Pod 标准输出日志 |
| 自研监控平台 | 可观测 | Pod 健康状态监控与告警 |
| 阿里云容器镜像仓库 | 镜像存储 | 私有镜像 `sto-registry-vpc.cn-shanghai.cr.aliyuncs.com` |

---

## 三、关键配置说明

### 3.1 资源规格

```plaintext
CPU:    request=3C / limit=4C（每 Pod）
Memory: request=8Gi / limit=8Gi（每 Pod）
副本数: 2

```

**设计意图：** `num_workers=4` 对应 limit 4C，最大数据库连接数 = `4 worker × 10 pool = 40`，符合中等负载场景需求。

### 3.2 进程管理（Gunicorn）

*   采用 `--run_gunicorn` 模式，进程稳定性优于默认的 asyncio 模式
    
*   `--max_requests_before_restart 10000`：每处理 1 万请求自动回收 Worker，有效防止内存泄漏
    
*   `--keepalive_timeout 75`：与上游 LB 保持连接对齐（建议 > LB 超时设置）
    

### 3.3 缓存策略

```yaml
cache: true
type: redis
# Redis 连接参数通过环境变量注入
```

*   启用 Redis 缓存可显著降低相同 Prompt 的重复请求延迟与成本
    
*   `use_redis_transaction_buffer: true` 用于高流量场景防止 PostgreSQL 死锁
    

### 3.4 路由策略

```yaml
routing_strategy: simple-shuffle  # 随机均衡，高流量推荐
num_retries: 2                    # 请求失败自动重试 2 次
timeout: 300                      # 全局超时 300 秒
enable_loadbalancing: true        # 开启多端点负载均衡
```
> ⚠️ **生产注意事项**：已禁用 Usage-based routing（基于用量路由），避免高流量下的性能瓶颈。

### 3.5 日志与数据库写入

```yaml
proxy_batch_write_at: 60        # 每 60 秒批量写入一次，降低 DB 压力
disable_error_logs: True        # 禁止将异常写入 DB（减少噪声）
store_model_in_db: true         # 模型配置持久化到 DB
store_prompts_in_spend_logs: true  # Prompt 内容写入日志
disable_cost_tracking: true     # 关闭成本追踪计算
```

### 3.6 健康检查

| 探针类型 | 路径 | 端口 | 初始延迟 | 周期 |
| --- | --- | --- | --- | --- |
| Liveness | `/health/liveliness` | 4000 | 60s | 15s |
| Readiness | `/health/readiness` | 4000 | 30s | 10s |

---

## 四、可观测方案

### 4.1 日志采集（SLS）

**采集链路：** Pod stdout/stderr → DaemonSet Log Agent → 阿里云 SLS LogStore

**推荐 SLS 配置要点：**

*   LogStore 命名建议：`litellm-gateway-prod`
    
*   设置容器过滤规则，仅采集 namespace = `devops-litellm-gateway` 的 Pod 日志
    
*   开启日志告警：ERROR 级别日志频率阈值告警（待完善）
    

**当前日志级别：**

```bash
LITELLM_LOG=WARNING      # 容器环境变量
set_verbose: False       # 配置文件
```
> 生产环境已关闭 DEBUG/INFO 级别输出，仅保留 WARNING 及以上，有效控制 SLS 写入量。

### 4.2 监控

*   POD监控
    
    *   devops平台检测配置，pod不健康则告警
        
    *   POD水位监控，通过Prometheus进行告警 （待完善）
        

*   资源监控
    
    *   rds与redis依赖阿里云监控。（待完善）
        

### 4.3 模型健康检查

监控逻辑：

1.  调 /health → 返回 healthy\_endpoints 和 unhealthy\_endpoints
    
2.  标记 unhealthy\_endpoints 中的模型为不健康
    
3.  对不健康模型发探针请求二次确认
    
4.  连续失败达到阈值才发钉钉告警
    
5.  恢复时也发通知
    

  配置：

  - 在 .env 中填入 DINGTALK\_WEBHOOK\_URL 和可选的 DINGTALK\_SECRET 和 LITELLM\_API\_KEY

后续通过k8s的cronjob实现。

基本功能已完成 待上线

---

## 五、安全配置

### 5.1 已实施

*   ✅ 敏感信息通过 K8s Secret 注入（DB 密码、Redis 密码）
    
*   ✅ 使用阿里云 VPC 内网地址访问 RDS/Redis，不走公网
    
*   ✅ Master Key 使用随机生成的高强度密钥
    
*   ✅ 镜像从私有仓库拉取（VPC 内网）
    
*   ✅ `LITELLM_LOCAL_MODEL_COST_MAP=True`，禁止从外网拉取模型价格，避免程序报错
    

---

## 六、扩容与高可用方案

### 当前状态

```plaintext
副本数: 2（StatefulSet，Parallel 启动策略）
单 Pod: 4C8G，4 Worker
总处理能力: 约 8 个并发 Worker
```

### 扩容方案

| 场景 | 建议 |
| --- | --- |
| 日常流量增长 | 调整 `replicas: 3-4`，无需修改其他配置 |
| 突发流量（待完善） | 配置 HPA（基于 CPU 使用率），动态扩缩容 |

### Pod 反亲和性配置示例 （待配置）

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              appName: devops-litellm-gateway
          topologyKey: kubernetes.io/hostname
```
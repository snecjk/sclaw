# 4.22平台技术部

# 项目日报（AI 结构化自动总结版）

## 任务执行总览

本日围绕生产环境部署落地、计费策略深度对比验证、代码架构规范化重构及业务功能扩展展开工作，完成 Lite-LLM 生产上线、LLM 网关成本模型选型、代码工程化治理及全链路业务能力补齐，任务高密度闭环，架构清晰度显著提升。

## 1. 智能运维与环境建设

### Lite-LLM 运维工作

*   完成生产环境 Lite-LLM 全量部署，同步完成日志采集配置，实现生产环境可观测能力闭环。
    
*   在测试环境 Lite-LLM 中完成 Webhook 告警配置，用于预算阈值触发与告警流程验证。
    

## 2. 运开研发任务智能进展

### 一、LLM 网关计费方式对比调研

*   完成 LLM Gateway 多计费模式横向对比测试，重点分析无 Agent 场景下 Token 消耗量、响应耗时、成本费用三项核心指标。
    
*   测试结论：百炼 Token 计费模式在消耗量与费用表现上均优于 Token Plan；结合 IDE + 插件接入形态综合评估，**百炼 Token 计费为当前最优方案**，实现成本与体验平衡。
    
*   后续计划：输出完整对比数据与选型建议文档，推进计费策略落地。
    

### 二、AgentRun 模块

*   本日暂无开发进度。
    
*   明日计划：整理平台侧需落地的 Action 清单，组织大网络团队开展接口方案对接。
    

### 三、Git 代码仓库智能分析（2026-04-22）

#### 提交行为画像

*   提交者：huangli
    
*   提交频次：27 次连续提交（09:59–17:34）
    
*   代码规模：变更 88 个文件，+4,076 行 / -524 行
    
*   工作重心：从基础框架搭建转向**业务功能补齐 + 架构重构优化**
    

#### 核心工作智能分类

1.  **项目结构深度重构**
    
    *   完成包结构规范化治理：dto → entity，util 拆分为 client/constant/build 三个专业子包
        
    *   服务组件重分类：LiteLlmXxxService → LiteLlmXxxComponent 并移入 components 包
        
    *   统一 entity/model 归属，优化结构清晰度
        
    *   新增 llm-business 业务模块，实现基础能力层与业务控制层（Controller/Service）物理隔离
        
    *   引入 Builder 模式构建请求对象：LiteLlmKeyCreateRequestBuilder、LiteLlmMemberRequestBuilder、LiteLlmKeyAliasBuilder 等
        
2.  **用户 Key 管理体系建设**
    
    *   新增用户 Key 详情列表查询接口，完成 Controller/Service 逻辑实现
        
    *   修复明文 Key 不可展示问题
        
    *   新增明文 Key 本地持久化实体 LiteLlmKeyPlainEntity 及完整 DAO/Service 层
        
3.  **配额审批与扩容流程**
    
    *   实现 AI AppKey 配额申请全流程：AiAppKeyQuotaApplyService / CallbackService
        
    *   钉钉回调流程新增明文 Key 插入逻辑
        
    *   增加 Key 启用/禁用状态字段
        
    *   优化配额修改记录逻辑链
        
4.  **钉钉工作通知能力**
    
    *   新增钉钉消息通知服务 DingTalkMessageService 与消息模板体系
        
    *   配额审批流程接入钉钉实时通知
        
5.  **LiteLLM 新接口扩展对接**
    
    *   完成 Token 用量查询列表接口对接
        
    *   实现 LiteLLM 预算告警 Webhook 接收与解析
        
    *   新增 Key 列表查询、Key 更新等扩展实体类
        

#### 核心成果智能总结

本日完成代码架构系统性重构，项目结构标准化、模块化程度显著提升；同时扩展配额审批、钉钉通知、用量查询、预算告警 Webhook 等核心业务能力，LLM 网关功能体系基本成型。
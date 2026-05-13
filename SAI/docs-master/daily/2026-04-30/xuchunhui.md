# 4.30 平台技术部

# 工作内容总结 （AI 结构化自动总结版）

## 任务执行总览

今日聚焦 持续落地 LiteLLM 监控告警体系建设，完成网关链路追踪接入并开展指标效果分析；LLM 网关实现 Key 批量申请、鉴权能力扩容、限流与并发管控、告警模板优化及代码治理。

## 一、基础运维工作

#### LiteLLM 模块-持续推进监控告警体系建设与完善

*   对 Grafana 可视化展示、健康配置相关调研，重点围绕 QPS、TPM、预算等核心维度开展。
    
*   网关已完成 ARMS 链路追踪接入，现阶段正在对接入后的各项运行指标做效果分析与评估。
    

## 二、运维开发工作

#### LLM 网关

*   聚焦网关能力迭代，完成现有功能完善、导入逻辑优化，并补齐 Key 限流 核心管控能力。
    

## 三、Git 代码智能分析（LLM 网关｜4月30日）

### 提交概览

*   分支：feature\_ctfoh2
    
*   提交人：huangli（多次提交）+ 合并提交
    
*   时间：工作时段内迭代
    
*   规模：18 个文件 | +320 行 /-85 行
    
*   方向：批量 Key 管理能力升级、鉴权逻辑扩展、服务稳定性加固、告警与代码治理
    

### 核心迭代内容Key 

#### 批量申请能力重磅升级

*   新增用户名解析与 Excel 导入适配：AuthClient 新增 getUserInfoByUserName() 方法，通过配置化接口调用外部 Auth 服务，实现用户名查询用户信息，补充原仅支持 userCode 查询的单一模式
    
*   引入 UserSource 分流模型：新增 sourceType 字段，支持两种用户匹配规则：     select：沿用原逻辑，通过 userCode 精确匹配用户；     excel：新增 userName 模糊匹配，适配 Excel 批量导入场景。
    
*   重构批量 Key 创建校验流程：按用户来源类型分流校验用户存在性与唯一性，校验失败自动记录原因（“未找到匹配的用户”），校验通过后再执行单条 Key 创建，保障数据准确性。
    

#### Key 申请流程完善

*   根据用户名称申请 Key：在 AuthClient 新增 DevopsAuthApiListResponse 响应模型，支持 API 列表返回格式；LiteLlmKeyManualCreateService 中补充 userName字段传递，使申请流程中用户信息更完整。
    

#### 并发数限制调整

*   将 LiteLlmCreateKeyRequest、LiteLlmUpdateKeyDurationRequest 及 LiteLlmParamNames 中的并发数统一设置为 15，防止单 Key 并发过高影响 LiteLLM 服务稳定性。
    

#### Key 过期时间刷新

*   修改 JobTriggerController 和 LiteLlmDataMigrationController 中触发 Key 过期时间刷新的逻辑（具体参数调整，变更量较小）。
    

#### 告警通知模版优化

*   修改 LiteLlmParamNames 和 LiteLlmKeyAlertServiceImpl 中告警通知模版相关参数，优化告警信息展示格式。
    

#### 操作类型枚举精简

*   OperationTypeEnum 删除 5 行废弃枚举值，清理无用操作类型。
    

### 成果总结

本日完成 LLM 网关 Key 管理体系能力升级，实现批量 Key 申请从单一模式向多场景兼容的突破；同时完成鉴权逻辑扩展、并发管控加固、告警优化与代码治理，整体提升了 Key 管理的灵活性、服务运行的稳定性与代码的可维护性，为后续业务落地与联调对接做好了充分准备。
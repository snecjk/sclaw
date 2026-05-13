# 一、各模块进展

## 1. agent_ai_claw：

### 代码开发：
- 优化聊天功能chatService 并调整上传限制，附件上传限制提升至 5MB
- 移除未使用的 sessions 状态管理，简化 chatService
- 兼容 qwen 等模型将文本放在 result 而非 content 的情况
- start.sh 日志改用 tee 同时输出到终端和文件
- 代码风格优化：变量命名、import 排序、移除冗余代码

### serverless环境：
- 日志规范统一修改在serverless中使用标准logger打印日志
- 验证挂载OSS目录设置为只读属性是否可以文件copy — 确认OK
- 与隋云团队沟通SKILL和CLI的资源目录基本格式，待@文鹏给出具体OSS路径

## 2. agent-gateway：
- 完成项目框架初始化
- 与前端沟通基于h5 sdk的channel对接方案


## 3. 基于通用Agent的AI销售助理开发：
- **线索Skill**：线索辅助信息利用webSearch联网搜索功能开发
- **报价Skill**：流程中增加输入报价详情；市场新增报价接口进行对接
- **标书Skill**：基本流程已走通，接收用户输入的文件及其描述，根据文件内容结合用户描述生成大纲，再根据大纲联网检索内容补充并生成章节内容，最终输出一份word文档

---

# 二、项目里程碑&风险

**0430里程碑**：申懂懂里面嵌套通用Agent前端sdk，通过agent-gateway，按照用户session在serverless上分配Agent，能够问「你好」。

**当前状态**：无风险
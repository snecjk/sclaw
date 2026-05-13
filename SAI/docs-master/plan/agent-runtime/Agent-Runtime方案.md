# Agent Crew 


### 用户隔离：基于AgentRun（serverless）实现

*   Agent实例的启动流程：会话进入run docker，agent无状态，会话结束销毁。当前拉起一个docer的RT：<1秒级（热启动100ms），在通用Agent调用上可以接受。
    
*   用户执行环境隔离，根据用户session\_id动态分配Agent实例，确保一个Agent实例当前只有一个session。
    
*   基于claude agent sdk构建通用Agent，这条路现在已经跑通，后续遇到的bug会跟大家share。agent用户日志，方便大家接入后自行排查问题，后续同步方案。
    
*   我们现在是直接用的阿里云的函数计算控制台部署，等徐总他们devops运维平台对接ready直接切换。
    

### SKILL隔离：基于docker 的文件目录挂载实现


**2.1 Agent实例的文件系统可以挂载OSS，并支持linux管道命令。当前block的点，oss的挂在逻辑是在Agent层配置，无法根据用户实现个性化挂载。**


两种解法：

（1）阿里云提供个性化挂在接口，已经提需求，待评估

（2）在Agent层自行实现基于用户的文件路径权限，如果（1）走不通，我们就走（2）

**2.2 OSS挂载目录的逻辑：**

把workspace 和 systemspace区分开，分别对应oss挂载目录下的两个子目录，systemspace可按照用户/领域/公共来组织，这个看隋云那边skill分发的策略。

我们的思考希望跟SKILL的切面是oss（希望云头能按照oss交付skill），为了提升agent拉起来时的RT。

###  AI销售助理当前使用CLI的方式

当前项目方案是在skill的执行script中引用python 脚本执行api调用获取业务数据，相当于逻辑在skill里面，当前是skill主动调用python，而不是CLI提供给Agent。


后续随云完成CLI wrapper，我们直接换成随云的client。

### Agent的通用页面SDK  

PC、移动项目的前端引入SDK就能与Agent进行交互，现在pc端的demo是跑通了（AI销售助理），但是需要重新按照宏宇的逻辑进行一次对焦，看如何迭代和演进。

### Agent支撑ACP协议的考虑

ACP是一个AI IDE客户端和Agent间交互的协议。解决各种客户端产品和Agent对接的问题。


（1）ACP协议的支持只需要在Agent上面集成ACP SDK，写一层Adapter，当前Agent设计考虑这个点，向前兼容。

（2）由于两个原因当前不做：

*   当前的Agent是云端的，ACP不支持http协议，需要自己去写，不分散精力
    
*   claude agent acp sdk是typescript写的，再等等就有python版本了，不急
    

### 本月目标

（1）基于AI销售助理的架构调整成：通用Agent 和 业务SKILL、CLI完全隔离。（2）实现跟上诉4个部分的架构向前兼容。（3）前端能够在申懂懂上跑起来。
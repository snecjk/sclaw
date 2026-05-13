# yihang 4.20日报

## 1. agent和徐总serverless层接口澄清

核心两个接口：

- 基于用户级别workspace获取agent session：  
`session = get_session(mount_list, ...)`  
其中mount_list是本地文件路径和 oss bucket下文件路径的映射，即组织用户workspace，list的原因是除了skill、cli分发之外，还有session持久化等考虑。这样的好处是老徐不用关注user id到workspace的关系，user id到workspace的关系只需要我和隋云耦合，serverless层不感知user id，不用侵入业务逻辑，更加干净。
- 基于session进行Agent交互：  
`result = send_request(session, content_body)`

## 2. 代码仓库初始化

茗微将通用 agent 逻辑放到 `SAI/agent-runtime` repo 下。明天自己开始review 通用agent代码，深入到代码逻辑中。

## 3. 生产关系调整

- 茗微侧不再负责AI网点管家，下沉至网络侧元屠负责，元屠直接负责网络侧业务和用户的AI需求。
- 谋定/茗微的核心放在通用Agent，逻辑就是基于SAI项目 和 AI销售助理项目持续迭代通用Agent。并且需要重新思考通用Agent的本身演进，比如mem、比如session状态等。
- 人先承接channel sdk开发，follow宏宇逻辑，一期以申懂懂接入sdk为主。


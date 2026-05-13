# SAI项目管理v2.0

## 用Git issue串联「里程碑-Spec-Task-代码」管理

> 里程碑 = 迭代 / 目标
>
> Spec = 一个独立模块（方案）
>
> Task = 开发要做的具体工作（任务）
>
> 全部通过 Git 平台的 Issue + Milestone 功能绑定在一起
>
> 代码通过 PR/MR 关联 Issue → 最终归属里程碑

## 一、核心目标

明确 520MVP 里程碑下，Spec（方案）、Task（任务）、代码的串联逻辑，实现流程可追溯、文档统一管理，适配1个group内包含6个仓库（1个docs+5个团队仓）的架构模式

## 二、核心规则

- 仅1个里程碑：SAI520MVP；
- 共5个Spec issue：对应 channel、agent-runtime、harness、llm-router、cli 5个模块；
- 关联规则：1个spec issue对应多个task issue，每个spec issue顶部粘贴docs-plan-对应spec方案；全程遵循「里程碑（1个）→Spec（5个）→Task（n个）→代码」的链路，以上通过 Issue 关联；
- 闭环逻辑：单个 Task issue完成→关闭对应Task Issue；所有 Task issue 完成→Spec issue 标记完成；所有 Spec 完成→里程碑归档

## 三、全链路串联逻辑

### 1. 可视化链路图

```text
GitLab 520MVP 里程碑
        ↓ 绑定（归属关系）
Spec-Issue（对应各模块规格）
        ↓ （每个Spec Issue贴docs文档链接）
docs-master 仓库（Spec正式文档存放地）
        ↓ （1个Spec对应多个Task）
多个 Task-Issue（开发任务）
        ↓ （MR关联Task ID）
团队仓库（代码实现）
```

### 2. 关键节点说明

#### （1）Spec 文档管理

- 文档唯一源：仅 docs-master 仓库存有正式 Spec 文档，统一存放在 `docs-master/plan`，团队仓库和spec issue仅引用链接，不存放文档副本；
- 若Spec方案有更新，模块负责人要记得检查Spec issue内的链接是否需要更新；

#### （2）Issue 关联

- 1个spec issue对应多个task issue，5个spec issue只需要一次性创建，每个spec issue归属 520MVP 里程碑，再基于spec issue持续创建issue（即task issue），且spec issue需粘贴docs-plan-对应spec的方案链接；
- Select label分为两种：spec issue & task issue；
- issue跟着团队仓库走，非docs仓库

#### （3）代码与 Task 绑定

- MR合并前，需确认MR描述中已正确填写「关联 #TaskID」，否则无法完成代码与Task的关联，影响全链路追溯；

### 3. docs目录结构设计

```text
docs-master/
│
├── plan/                                   # 核心目录（扁平化布局）
│   │
│   ├── 520MVP/                             # 里程碑专属文件夹
│   │
│   ├── channel/                            # channel 模块
│   │   ├── spec_channel_v1.0.md            # Spec 方案
│   │   └── pic/                            # 图片资源
│   │
│   ├── agent-runtime/                      # agent-runtime 模块
│   │   ├── spec_agent-runtime_v1.0.md      # Spec 方案
│   │   └── pic/                            # 图片资源
│   │
│   ├── harness/                            # harness 模块
│   │   ├── spec_harness_v1.0.md            # Spec 方案
│   │   └── pic/                            # 图片资源
│   │
│   ├── llm-router/                         # llm-router 模块
│   │   ├── spec_llm-router_v1.0.md         # Spec 方案
│   │   └── pic/                            # 图片资源
│   │
│   └── cli/                                # cli 模块
│       ├── spec_cli_v1.0.md                # Spec 方案
│       └── pic/                            # 图片资源
│
├── daily/                                  # 日常文档存放目录
│
├── notes/                                  # 会议纪要、评审记录
│
├── project/                                # 项目相关补充文档
│
├── README.md                               # 仓库说明文档
│
└── .gitignore                              # 忽略文件配置
```

**命名规范：** `spec_模块名_版本.md`

### TODO

1. 调整docs目录结构，新增里程碑相关文件夹 --- 平台技术
2. 里程碑文件内补充每个模块520里程碑要交付的内容。完成【关键能力】，达到【阶段上线 / 闭环条件】 -- 各模块负责人
3. 方案和需求全部上git，方案放在docs-plan（不变）；需求和开发文档，存放在团队仓库 -- 项目组执行同学
4. 基于各个模块spec，结合实际任务执行情况，持续关联task issue
5. 5.8开始执行

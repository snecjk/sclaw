import type {
  OfficialWorkflowCard,
  VersionItem,
  WorkflowCardItem,
  WorkflowDetailData,
  WorkflowLink,
  WorkflowNodeData,
} from '@/pages/Workflow/types';

// @mock: 待接入 POST /agent/v1/workflows/page，工作流列表卡片数据（对齐 test-mockup.html）
export const MOCK_WORKFLOW_CARDS: WorkflowCardItem[] = [
  {
    id: 'wf_1',
    name: '总部结算对账',
    listKind: 'published',
    category: '财务对账',
    schedule: '每天 09:00 自动运行',
    scheduleIcon: 'clock',
    enabled: true,
    description:
      '自动从总部拉结算数据，按规则核对收支差异，生成对账表和异常清单，可一键导出。',
    flow: ['拉数据', '按规则核对', '找出差异', '生成报告'],
    lastRun: '上次运行 今天 09:12',
    coverKey: 'cover-1',
    runSuccess: true,
  },
  {
    id: 'wf_2',
    name: '异常客户跟踪',
    listKind: 'published',
    category: '异常监控',
    schedule: '发现异常时自动运行',
    scheduleIcon: 'zap',
    enabled: true,
    description:
      '找出件量、货品、服务异常的客户，生成跟进清单并同步到任务，方便分配和闭环。',
    flow: ['扫描数据', '判定异常', '建跟进单', '通知到人'],
    lastRun: '上次运行 昨天 18:30',
    coverKey: 'cover-2',
    runSuccess: true,
  },
  {
    id: 'wf_3',
    name: '每日营业款核对',
    listKind: 'published',
    category: '财务对账',
    schedule: '每天 20:00 自动运行',
    scheduleIcon: 'clock',
    enabled: true,
    description: '汇总当天各网点营业款，和系统应收金额核对，自动标出对不上的网点。',
    flow: ['汇总营业款', '核对应收', '标出差异'],
    lastRun: '上次运行 今天 20:05',
    coverKey: 'cover-3',
    runSuccess: true,
  },
  {
    id: 'wf_4',
    name: '发件客户成本分析',
    listKind: 'draft',
    category: '经营管理',
    schedule: '每月 1 号自动运行',
    scheduleIcon: 'clock',
    enabled: false,
    isCustom: true,
    scheduleMuted: true,
    showPausedLabel: true,
    description: '按客户算出每张港单的成本、毛利和异常项，生成成本报表和优化建议。',
    flow: ['取单据', '算成本毛利', '出优化建议'],
    lastRun: '还没运行过',
    coverKey: 'cover-4',
    neverRun: true,
  },
  {
    id: 'wf_5',
    name: '件量日报推送',
    listKind: 'published',
    category: '经营管理',
    schedule: '每天 08:00 自动运行',
    scheduleIcon: 'clock',
    enabled: true,
    description: '取昨日各网点件量，生成日报并自动推送到管理群，异常波动会标红。',
    flow: ['取昨日件量', '生成日报', '推送到群'],
    lastRun: '上次运行 今天 08:00',
    coverKey: 'cover-1',
    runSuccess: true,
  },
  {
    id: 'wf_6',
    name: '到付货款回收提醒',
    listKind: 'installed',
    category: '客户运营',
    schedule: '发现逾期时自动运行',
    scheduleIcon: 'zap',
    enabled: true,
    description: '扫描到付账款，算出逾期天数，自动给对应负责人发催收提醒。',
    flow: ['扫到付账款', '算逾期', '发提醒'],
    lastRun: '上次运行 昨天 16:40',
    coverKey: 'cover-5',
    runSuccess: true,
  },
];

// @mock: 待接入 GET /agent/v1/workflow-templates，官方推荐列表
export const MOCK_OFFICIAL_WORKFLOWS: OfficialWorkflowCard[] = [
  {
    id: 'off_1',
    name: '网点经营收支执行跟踪',
    category: '经营管理',
    schedule: '每月初自动运行',
    scheduleIcon: 'clock',
    description: '把预算和实际收支对比，跟踪各网点经营目标完成到什么程度。',
    flow: ['取预算实际', '对比考核', '出进度'],
    coverKey: 'cover-1',
  },
  {
    id: 'off_2',
    name: '进项票据与对账单勾稽',
    category: '财务对账',
    schedule: '每天 18:00 自动运行',
    scheduleIcon: 'clock',
    description: '把进项发票、付款流水、对账单三方比对，标出税额和金额对不上的地方。',
    flow: ['取三方数据', '自动匹配', '标出偏差'],
    coverKey: 'cover-3',
  },
  {
    id: 'off_3',
    name: '对账合规检查与整改闭环',
    category: '异常监控',
    schedule: '每周一自动运行',
    scheduleIcon: 'clock',
    description: '按内控要点抽查对账留痕，盯着整改项一直到验收完成。',
    flow: ['抽查留痕', '列整改项', '跟到验收'],
    coverKey: 'cover-2',
  },
  {
    id: 'off_4',
    name: '大客户流失预警跟进',
    category: '客户运营',
    schedule: '发现流失风险时自动运行',
    scheduleIcon: 'zap',
    description: '盯住大客户的件量和结算波动，有流失苗头就预警并自动派跟进任务。',
    flow: ['盯波动', '评估风险', '预警派单'],
    coverKey: 'cover-5',
  },
];

// @mock: 待接入工作流详情 API，「它会怎么做」步骤明细
export const MOCK_WORKFLOW_DETAILS: Record<string, WorkflowDetailData> = {
  总部结算对账: {
    produces: '对账表 + 异常清单',
    estimatedDuration: '预计 3 分钟执行完成',
    monthRunCount: 12,
    steps: [
      { title: '拉取结算数据', description: '从总部结算系统拉取当期收支明细，自动按网点归类。', skills: ['数据接入'] },
      { title: '按规则核对', description: '先清洗对齐两边数据，再用预设对账规则逐笔比对。', skills: ['数据清洗', '对账规则匹配'] },
      { title: '找出差异', description: '识别金额对不上、缺漏、重复的记录，分类打标并给出可能原因。', skills: ['差异分析', '异常打标', '原因推断'] },
      { title: '生成报告', description: '输出标准对账表和异常明细，支持一键导出。', skills: ['报表生成'] },
    ],
  },
  异常客户跟踪: {
    produces: '异常客户跟进清单',
    estimatedDuration: '预计 2 分钟执行完成',
    monthRunCount: 4,
    steps: [
      { title: '扫描数据', description: '汇总各网点件量、货品、服务等运营数据。', skills: ['数据扫描'] },
      { title: '判定异常', description: '按阈值规则识别件量、货品、服务异常的客户。', skills: ['差异分析', '异常打标'] },
      { title: '建跟进单', description: '为异常客户生成跟进清单并同步到任务。', skills: ['任务创建'] },
      { title: '通知到人', description: '把跟进任务推送给对应负责人。', skills: ['通知推送'] },
    ],
  },
  每日营业款核对: {
    produces: '营业款核对表',
    steps: [
      { title: '汇总营业款', description: '汇总当天各网点上缴的营业款。', skills: ['数据汇总'] },
      { title: '核对应收', description: '和系统应收金额逐网点核对。', skills: ['账款核对'] },
      { title: '标出差异', description: '自动标出对不上的网点并提示差额。', skills: ['差异分析', '异常打标'] },
    ],
  },
  发件客户成本分析: {
    produces: '成本报表 + 优化建议',
    steps: [
      { title: '取单据', description: '按客户拉取港单与计费单据。', skills: ['数据接入'] },
      { title: '算成本毛利', description: '逐单核算成本、毛利并识别异常项。', skills: ['成本核算', '毛利分析'] },
      { title: '出优化建议', description: '生成成本报表并给出降本优化建议。', skills: ['报表生成', '优化建议'] },
    ],
  },
  件量日报推送: {
    produces: '件量日报',
    steps: [
      { title: '取昨日件量', description: '拉取昨日各网点件量数据。', skills: ['数据接入'] },
      { title: '生成日报', description: '汇总成日报，异常波动自动标红。', skills: ['报表生成', '差异分析'] },
      { title: '推送到群', description: '自动推送日报到管理群。', skills: ['通知推送'] },
    ],
  },
  到付货款回收提醒: {
    produces: '催收提醒清单',
    steps: [
      { title: '扫到付账款', description: '扫描全部到付账款记录。', skills: ['数据扫描'] },
      { title: '算逾期', description: '计算每笔账款的逾期天数。', skills: ['逾期计算'] },
      { title: '发提醒', description: '给对应负责人发送催收提醒。', skills: ['通知推送'] },
    ],
  },
  网点经营收支执行跟踪: {
    produces: '经营进度报表',
    steps: [
      { title: '取预算实际', description: '拉取各网点预算与实际收支。', skills: ['数据接入'] },
      { title: '对比考核', description: '预算与实际对比，计算完成度。', skills: ['预算对比'] },
      { title: '出进度', description: '输出各网点目标完成进度。', skills: ['报表生成'] },
    ],
  },
  进项票据与对账单勾稽: {
    produces: '勾稽结果表',
    steps: [
      { title: '取三方数据', description: '拉取进项发票、付款流水、对账单。', skills: ['数据接入'] },
      { title: '自动匹配', description: '三方数据自动勾稽匹配。', skills: ['票据匹配'] },
      { title: '标出偏差', description: '标出税额、金额对不上的地方。', skills: ['差异分析', '异常打标'] },
    ],
  },
  对账合规检查与整改闭环: {
    produces: '合规检查与整改清单',
    steps: [
      { title: '抽查留痕', description: '按内控要点抽查对账留痕。', skills: ['合规抽查'] },
      { title: '列整改项', description: '列出不合规项及整改要求。', skills: ['异常打标'] },
      { title: '跟到验收', description: '盯整改项直到验收完成。', skills: ['任务创建'] },
    ],
  },
  大客户流失预警跟进: {
    produces: '流失预警与跟进单',
    steps: [
      { title: '盯波动', description: '监测大客户件量与结算波动。', skills: ['趋势监测'] },
      { title: '评估风险', description: '评估流失风险等级。', skills: ['风险评估'] },
      { title: '预警派单', description: '有流失苗头就预警并派跟进任务。', skills: ['通知推送', '任务创建'] },
    ],
  },
};

// @mock: 待接入工作流详情 API，AI 生成默认流程节点与连线
export const MOCK_FLOW_PLAN = [
  { title: '数据获取', description: '从已配置的系统数据表取数' },
  { title: '数据处理', description: '按对象 / 科目 / 流向 / 重量段汇总' },
  { title: '条件判定', description: '按阈值判断是否异常，再分流' },
  { title: '输出与通知', description: '有异常则输出报告、推通知；无异常结束' },
];

export const MOCK_FLOW_NODES: WorkflowNodeData[] = [
  {
    id: 'n1',
    kind: 'db',
    icon: 'DB',
    label: '数据获取',
    ai: false,
    title: '数据获取',
    description: '获取本流程需要的业务数据，来自已配置的系统数据表。',
    x: 0,
    y: 0,
    fields: [
      {
        key: 'datasource',
        label: '数据源（至少选一种，可多选）',
        type: 'dsgroup',
        dataSource: { sys: ['发件数据表', '客户关系表'] },
      },
    ],
  },
  {
    id: 'n2',
    kind: 'proc',
    icon: '处',
    label: '数据处理',
    ai: false,
    title: '数据处理',
    tryRun: true,
    resultSummary: '输出 1,268 个客户的汇总数据',
    description: '选定分析对象，并勾选要统计的科目与汇总维度。',
    x: 0,
    y: 0,
    fields: [
      {
        key: 'rule',
        label: '处理规则',
        type: 'textarea',
        value: '选定分析对象为客户，统计面单、中转、考核科目，按客户维度汇总。',
      },
    ],
    summary: [
      { key: '分析对象', value: '客户（面单 / 中转 / 考核 · 按客户汇总）', ai: true },
      { key: '引用技能', value: '客户维度汇总分析', pick: true },
    ],
  },
  {
    id: 'n3',
    kind: 'cond',
    icon: '!',
    label: '条件判定',
    ai: false,
    title: '条件判定',
    tryRun: true,
    resultSummary: '命中 57 个异常客户',
    description: '配置判定类型与阈值，判定后分流至结果输出或结束。',
    x: 0,
    y: 0,
    fields: [
      {
        key: 'rule',
        label: '判定规则',
        type: 'textarea',
        value: '监控单量异常与服务异常：连续 3 天降量 > 20%，或滞留率 > 5%，即判定为异常。',
      },
    ],
    summary: [
      { key: '判定条件', value: '降量 > 20%（连续 3 天）· 滞留率 > 5%', ai: true },
      { key: '引用技能', value: '异常规则判定', pick: true },
    ],
  },
  {
    id: 'n4',
    kind: 'task',
    icon: '出',
    label: '结果输出',
    ai: false,
    title: '结果输出',
    description: '满足条件时输出结构化分析报告作为流程产物。',
    x: 0,
    y: 0,
    fields: [
      {
        key: 'output',
        label: '输出要求',
        type: 'textarea',
        value: '满足条件时生成《客户异常监控报告》，包含异常明细与处理建议。',
      },
    ],
    summary: [
      { key: '输出产物', value: '客户异常监控报告 · 报告', ai: true },
      { key: '引用技能', value: '报告生成', pick: true },
    ],
  },
  {
    id: 'n5',
    kind: 'notify',
    icon: '↗',
    label: '发送通知',
    ai: false,
    title: '发送通知',
    description: '按设定时间将报告以通知形式发送至工作台或钉钉。',
    x: 0,
    y: 0,
    fields: [
      {
        key: 'freqtime',
        label: '推送时间',
        type: 'freqtime',
        freq: '每天',
        value: '09:00',
        options: ['09:00', '12:00', '18:00', '21:00'],
      },
      {
        key: 'channels',
        label: '推送渠道（多选）',
        type: 'multi',
        value: 'STO Claw',
        options: ['STO Claw', '钉钉', '邮件', '企业微信'],
      },
    ],
  },
  {
    id: 'n6',
    kind: 'end',
    icon: '■',
    label: '无异常结束',
    ai: false,
    title: '无异常结束',
    description: '无异常时结束流程，不再输出结果与发送通知。',
    x: 0,
    y: 0,
    fields: [
      { key: 'note', label: '结束说明', type: 'text', value: '未满足判定条件，跳过后续输出与通知' },
    ],
  },
];

export const MOCK_FLOW_LINKS: WorkflowLink[] = [
  { from: 'n1', to: 'n2' },
  { from: 'n2', to: 'n3' },
  { from: 'n3', to: 'n4' },
  { from: 'n4', to: 'n5' },
  { from: 'n3', to: 'n6' },
];

// @mock: 待接入技能广场 API，节点引用技能列表
export const MOCK_SKILLS = [
  '网点发件数据取数',
  '客户维度汇总分析',
  '异常规则判定',
  '成本科目取数',
  '报告生成',
  '流向重量段分析',
];

// @mock: 待接入数据源目录 API
export const MOCK_DATA_TREES = {
  sys: {
    title: '系统数据源',
    groups: [
      { name: '经营数据', items: ['发件数据表', '收件数据表', '网点收支表'] },
      { name: '客户数据', items: ['客户关系表', '客户投诉记录'] },
      { name: '财务数据', items: ['结算流水', '成本科目表'] },
    ],
  },
  online: {
    title: '我的在线数据',
    groups: [
      { name: '在线表格', items: ['异常客户台账（飞书）', '网点经营周报（飞书）'] },
      { name: '云文档', items: ['月度复盘文档'] },
      { name: '数据看板', items: ['经营驾驶舱'] },
    ],
  },
} as const;

// @mock: 待接入工作流版本历史 API
export const MOCK_VERSIONS: VersionItem[] = [
  { time: '2026-05-02 14:30', type: '自动保存', current: true, description: '修改「条件判定」阈值：滞留率 > 5%' },
  { time: '2026-05-02 11:20', type: '手动保存', description: '「发送通知」新增推送渠道：钉钉' },
  { time: '2026-05-01 18:05', type: '发布', published: true, description: '发布上线，开始按计划自动运行' },
  { time: '2026-05-01 16:40', type: 'AI 修改', ai: true, description: '按对话调整判定规则为「连续 3 天降量 > 20%」' },
  { time: '2026-04-30 10:12', type: '手动保存', description: '配置数据源：发件数据表、客户关系表' },
  { time: '2026-04-30 09:58', type: 'AI 生成', ai: true, description: '一句话生成初始流程（6 个节点）' },
];

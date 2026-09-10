import type { IMArtifactOption, IMChatFileItem, IMContact, IMConversation, IMMessage, IMOrgDepartment, IMOrgMember } from './types';

export const MOCK_TOTAL_UNREAD = 16;

export const MOCK_CONVERSATIONS: IMConversation[] = [
  {
    id: 'conv-group-sales',
    type: 'group',
    name: '销售群',
    avatarLabel: '销',
    lastMessage: '张三: @你 看一下报表',
    lastTime: '09:15',
    unread: 12,
    pinned: true,
    memberCount: 28,
    groupTag: '内部群',
    orgPath: '28 人',
  },
  {
    id: 'conv-user-zhangsan',
    type: 'single',
    name: '张三',
    avatarLabel: '张',
    lastMessage: '今天的数据出来了吗？',
    lastTime: '10:32',
    unread: 3,
    status: 'online',
    statusText: '有事请钉钉联系',
    orgPath: '华东销售 | 销售经理',
  },
  {
    id: 'conv-agent-data',
    type: 'digital_employee',
    name: '数据分析助手',
    avatarLabel: '🤖',
    lastMessage: '华东区同比+12%，详见报告',
    lastTime: '09:48',
    unread: 1,
    status: 'online',
    subtitle: '销售分析',
    statusText: '在线 · 可处理数据分析与报表任务',
    orgPath: '数字员工 · 销售分析',
  },
  {
    id: 'conv-user-lisi',
    type: 'single',
    name: '李四',
    avatarLabel: '李',
    lastMessage: '好的，收到',
    lastTime: '昨天',
    unread: 0,
    status: 'offline',
    orgPath: '数据中心 | 数据分析师',
  },
  {
    id: 'conv-agent-report',
    type: 'digital_employee',
    name: '报告写作助手',
    avatarLabel: '🤖',
    lastMessage: '[文件] 周报.xlsx',
    lastTime: '周一',
    unread: 0,
    status: 'busy',
    subtitle: '报告生成',
    statusText: '执行中 · 正在生成报告',
    orgPath: '数字员工 · 报告生成',
  },
];

export const MOCK_DIGITAL_EMPLOYEES: IMContact[] = [
  {
    id: 'agent-data',
    kind: 'digital_employee',
    name: '数据分析助手',
    avatarLabel: '🤖',
    subtitle: '在线 · 销售分析',
    status: 'online',
    skills: ['数据分析', '报表', 'SQL'],
  },
  {
    id: 'agent-report',
    kind: 'digital_employee',
    name: '报告写作助手',
    avatarLabel: '🤖',
    subtitle: '执行中...',
    status: 'busy',
    skills: ['写作', 'PPT'],
  },
  {
    id: 'agent-flow',
    kind: 'digital_employee',
    name: '流程审批助手',
    avatarLabel: '🤖',
    subtitle: '离线',
    status: 'offline',
    skills: ['审批', '流程'],
  },
];

export const MOCK_COLLEAGUES: IMContact[] = [
  { id: 'user-zhangsan', kind: 'colleague', name: '张三', avatarLabel: '张', subtitle: '华东销售' },
  { id: 'user-lisi', kind: 'colleague', name: '李四', avatarLabel: '李', subtitle: '数据中心' },
  { id: 'user-wangwu', kind: 'colleague', name: '王五', avatarLabel: '王', subtitle: '总部运营' },
];

export const MOCK_GROUPS: IMContact[] = [
  { id: 'group-sales', kind: 'group', name: '销售群', avatarLabel: '群', subtitle: '28 人', memberCount: 28 },
  { id: 'group-project-a', kind: 'group', name: '项目A协作群', avatarLabel: '群', subtitle: '5 人', memberCount: 5 },
];

export const MOCK_ORG_DEPARTMENTS: IMOrgDepartment[] = [
  { id: 'dept-east', name: '华东大区' },
  { id: 'dept-east-sales', name: '华东销售', parentId: 'dept-east' },
  { id: 'dept-data', name: '数据中心', parentId: 'dept-east' },
  { id: 'dept-hq', name: '总部运营' },
  { id: 'dept-hq-ops', name: '运营支持', parentId: 'dept-hq' },
];

export const MOCK_ORG_MEMBERS: IMOrgMember[] = [
  { id: 'user-zhangsan', name: '张三', title: '销售经理', departmentId: 'dept-east-sales', avatarLabel: '张' },
  { id: 'user-lisi', name: '李四', title: '数据分析师', departmentId: 'dept-data', avatarLabel: '李' },
  { id: 'user-wangwu', name: '王五', title: '运营专员', departmentId: 'dept-hq-ops', avatarLabel: '王' },
  { id: 'user-zhaoliu', name: '赵六', title: '销售代表', departmentId: 'dept-east-sales', avatarLabel: '赵' },
  { id: 'user-sunqi', name: '孙七', title: '数据工程师', departmentId: 'dept-data', avatarLabel: '孙' },
  { id: 'user-zhouba', name: '周八', title: '运营主管', departmentId: 'dept-hq-ops', avatarLabel: '周' },
];

export const MOCK_MESSAGES_BY_CONVERSATION: Record<string, IMMessage[]> = {
  'conv-user-zhangsan': [
    {
      id: 'm1',
      role: 'system',
      contentType: 'text',
      content: '2026-03-07 10:30',
      time: '',
    },
    {
      id: 'm2',
      role: 'other',
      senderName: '张三',
      contentType: 'text',
      content: '今天的数据出来了吗？',
      time: '2026-03-07 10:32:00',
    },
    {
      id: 'm3',
      role: 'self',
      contentType: 'artifact',
      content: '',
      time: '2026-03-07 10:35:00',
      readStatus: 'read',
      artifact: {
        title: '上海销售周报',
        fileName: 'report.xlsx',
        fileSize: '2.3 MB',
      },
    },
    {
      id: 'm3b',
      role: 'self',
      contentType: 'text',
      content: '数据已更新，请查收附件。',
      time: '2026-03-07 10:36:00',
      readStatus: 'read',
    },
    {
      id: 'm3c',
      role: 'self',
      contentType: 'text',
      content: '下午我再同步一版最终口径。',
      time: '2026-03-07 10:38:00',
      readStatus: 'sent',
    },
  ],
  'conv-agent-data': [
    {
      id: 'm4',
      role: 'self',
      contentType: 'text',
      content: '帮我查一下华东区本月销售同比',
      time: '2026-03-07 09:40:00',
      readStatus: 'read',
    },
    {
      id: 'm5',
      role: 'other',
      senderName: '数据分析助手',
      senderAvatarLabel: '🤖',
      contentType: 'thinking',
      content: '正在分析华东区销售数据，需要关联上周口径...',
      time: '2026-03-07 09:41:00',
      collapsed: true,
    },
    {
      id: 'm6',
      role: 'other',
      senderName: '数据分析助手',
      senderAvatarLabel: '🤖',
      contentType: 'tool',
      content: '正在查询销售库...',
      time: '2026-03-07 09:42:00',
      toolName: 'query_sales_db',
    },
    {
      id: 'm7',
      role: 'other',
      senderName: '数据分析助手',
      senderAvatarLabel: '🤖',
      contentType: 'text',
      content: '华东区本月销售额 1.2 亿，同比 +12%。完整报告已生成，可在上方产物卡片查看。',
      time: '2026-03-07 09:48:00',
    },
  ],
  'conv-group-sales': [
    {
      id: 'm8',
      role: 'other',
      senderName: '张三',
      contentType: 'text',
      content: '@你 看一下今天的华东报表',
      time: '2026-03-07 09:10:00',
    },
    {
      id: 'm9',
      role: 'other',
      senderName: '李四',
      contentType: 'text',
      content: '我这边还在等数据组回传',
      time: '2026-03-07 09:12:00',
    },
    {
      id: 'm10',
      role: 'self',
      contentType: 'text',
      content: '我先发一版临时数据，大家先看下趋势。',
      time: '2026-03-07 09:14:00',
      readStatus: 'read',
      groupReadReceipt: { readCount: 18, memberCount: 28 },
    },
    {
      id: 'm11',
      role: 'self',
      contentType: 'text',
      content: '最终版预计下午三点同步。',
      time: '2026-03-07 09:15:00',
      readStatus: 'sent',
      groupReadReceipt: { readCount: 6, memberCount: 28 },
    },
  ],
};

export const MOCK_ARTIFACTS: IMArtifactOption[] = [
  { id: 'art-1', title: '上海销售周报', fileName: 'report.xlsx', fileSize: '2.3 MB' },
  { id: 'art-2', title: '华东区客户画像', fileName: 'customers.pdf', fileSize: '1.1 MB' },
  { id: 'art-3', title: '流程审批汇总', fileName: 'approval.md', fileSize: '24 KB' },
];

export const MOCK_CHAT_FILES: IMChatFileItem[] = [
  {
    id: 'file-1',
    tab: 'files',
    name: '上海销售周报.xlsx',
    metaLine: '2.3 MB · 2026/03/07 10:35 · 我',
    fileType: 'spreadsheet',
  },
  {
    id: 'file-2',
    tab: 'files',
    name: 'JDK11-17-21基础镜像使用指南',
    metaLine: '226 B · 最后更新: 2025/04/16 18:10 · 张三',
    fileType: 'document',
  },
  {
    id: 'file-3',
    tab: 'media',
    name: 'sclaw_demo.mp4',
    metaLine: '6.8 MB · 2026/08/24 09:35 · 文鹏',
    fileType: 'video',
  },
  {
    id: 'file-4',
    tab: 'media',
    name: 'p8_mfinal.mp4',
    metaLine: '6.8 MB · 2026/08/24 09:35 · 文鹏',
    fileType: 'video',
  },
  {
    id: 'file-5',
    tab: 'links',
    name: '运维答疑助手',
    metaLine: 'https://sclaw.example.com/help · 张三',
    fileType: 'link',
  },
];

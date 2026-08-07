/** 节点模板工厂：根据节点名称创建带完整默认字段的 WorkflowNodeData */
import type { WorkflowNodeData } from '@/pages/WorkflowBuilder/types';

/** @mock: 待接入节点模板 API — 当前每种节点类型硬编码默认字段，未匹配名称返回通用 proc 模板 */
export function createNodeFromTemplate(name: string, id: string): WorkflowNodeData {
  if (name === '数据获取') {
    return {
      id,
      kind: 'db',
      icon: 'DB',
      label: '数据获取',
      title: '数据获取',
      description: '获取本流程需要的业务数据，来自已配置的系统数据表。',
      x: 0,
      y: 0,
      fields: [
        {
          key: 'datasource',
          label: '数据源（至少选一种，可多选）',
          type: 'dsgroup',
          dataSource: {},
        },
      ],
    };
  }

  if (name === '数据处理') {
    return {
      id,
      kind: 'proc',
      icon: '处',
      label: '数据处理',
      title: '数据处理',
      tryRun: true,
      description: '选定分析对象，并勾选要统计的科目与汇总维度。',
      x: 0,
      y: 0,
      fields: [
        {
          key: 'rule',
          label: '处理规则',
          type: 'textarea',
          value: '',
        },
      ],
    };
  }

  if (name === '条件判定') {
    return {
      id,
      kind: 'cond',
      icon: '!',
      label: '条件判定',
      title: '条件判定',
      tryRun: true,
      description: '配置判定类型与阈值，判定后分流至结果输出或结束。',
      x: 0,
      y: 0,
      fields: [
        {
          key: 'rule',
          label: '判定规则',
          type: 'textarea',
          value: '',
        },
      ],
    };
  }

  if (name === '结果输出') {
    return {
      id,
      kind: 'task',
      icon: '出',
      label: '结果输出',
      title: '结果输出',
      description: '满足条件时输出结构化分析报告作为流程产物。',
      x: 0,
      y: 0,
      fields: [
        {
          key: 'output',
          label: '输出要求',
          type: 'textarea',
          value: '',
        },
      ],
    };
  }

  if (name === '发送通知') {
    return {
      id,
      kind: 'notify',
      icon: '↗',
      label: '发送通知',
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
          value: '',
          options: ['SClaw', '钉钉', '邮件', '企业微信'],
        },
      ],
    };
  }

  if (name === '结束') {
    return {
      id,
      kind: 'end',
      icon: '■',
      label: '结束',
      title: '结束',
      description: '结束流程，不再执行后续节点。',
      x: 0,
      y: 0,
      fields: [{ key: 'note', label: '结束说明', type: 'text', value: '' }],
    };
  }

  return {
    id,
    kind: 'proc',
    icon: '＋',
    label: name,
    title: name,
    description: `新增的「${name}」节点，点击配置参数。`,
    x: 0,
    y: 0,
    fields: [{ key: 'param', label: '参数', type: 'text', value: '' }],
  };
}

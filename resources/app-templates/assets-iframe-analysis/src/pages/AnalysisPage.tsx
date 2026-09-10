import { Alert, Card, Col, Progress, Row, Select, Statistic, Table, Tag, Typography } from 'antd';

const trend = [42, 57, 48, 66, 61, 78, 86];
const rows = [
  { key: '1', name: '华东区域', volume: '12,486', value: '¥ 268,400', rate: '18.4%', status: '正常' },
  { key: '2', name: '华南区域', volume: '9,872', value: '¥ 204,900', rate: '15.2%', status: '关注' },
  { key: '3', name: '华北区域', volume: '8,364', value: '¥ 176,300', rate: '12.8%', status: '正常' },
  { key: '4', name: '西南区域', volume: '6,916', value: '¥ 141,600', rate: '10.6%', status: '关注' },
];

const metrics = [
  { title: '分析对象数', value: 12846, suffix: '个', change: '+8.2%' },
  { title: '累计业务量', value: 37628, suffix: '单', change: '+12.6%' },
  { title: '核心指标', value: 82.4, suffix: '%', precision: 1, change: '+3.1%' },
  { title: '待关注项', value: 36, suffix: '项', change: '-5.4%' },
];

export function AnalysisPage() {
  return (
    <main className="analysis-page">
      <section className="analysis-title-row">
        <div>
          <Typography.Title level={3}>经营分析看板</Typography.Title>
          <Typography.Text type="secondary">单页 Assets 子应用基础框架</Typography.Text>
        </div>
        <div className="analysis-filters">
          <Select defaultValue="all" options={[{ value: 'all', label: '全部区域' }, { value: 'east', label: '华东区域' }, { value: 'south', label: '华南区域' }]} />
          <Select defaultValue="month" options={[{ value: 'week', label: '近 7 天' }, { value: 'month', label: '近 30 天' }, { value: 'quarter', label: '本季度' }]} />
        </div>
      </section>

      <Alert
        className="analysis-tip"
        type="info"
        showIcon
        message="当前展示模拟数据"
        description="接入真实数据时，可直接将本页的 metrics、trend 与 rows 模拟数据替换为接口调用结果。"
      />

      <Row gutter={[16, 16]}>
        {metrics.map((metric) => (
          <Col key={metric.title} xs={24} sm={12} xl={6}>
            <Card className="metric-card">
              <Statistic {...metric} />
              <Tag color={metric.change.startsWith('-') ? 'green' : 'blue'}>{metric.change} 较上期</Tag>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} className="analysis-content-row">
        <Col xs={24} lg={15}>
          <Card title="趋势概览" extra={<Typography.Text type="secondary">近 7 个周期</Typography.Text>}>
            <div className="trend-chart" aria-label="趋势模拟图">
              {trend.map((value, index) => <span key={index} style={{ height: `${value}%` }} title={`${value}`} />)}
            </div>
            <div className="trend-labels"><span>周期 1</span><span>周期 7</span></div>
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title="分类分布">
            <div className="distribution-item"><span>高价值</span><Progress percent={46} strokeColor="#1677ff" /></div>
            <div className="distribution-item"><span>稳态</span><Progress percent={34} strokeColor="#52c41a" /></div>
            <div className="distribution-item"><span>待关注</span><Progress percent={20} strokeColor="#faad14" /></div>
          </Card>
        </Col>
      </Row>

      <Card className="analysis-table" title="分析明细" extra={<Typography.Text type="secondary">模拟数据 · 共 4 条</Typography.Text>}>
        <Table
          pagination={false}
          dataSource={rows}
          columns={[
            { title: '维度名称', dataIndex: 'name' },
            { title: '业务量', dataIndex: 'volume', align: 'right' },
            { title: '产出金额', dataIndex: 'value', align: 'right' },
            { title: '完成率', dataIndex: 'rate', align: 'right' },
            { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === '正常' ? 'green' : 'gold'}>{value}</Tag> },
          ]}
        />
      </Card>
    </main>
  );
}

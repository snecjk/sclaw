import { useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { http, RequestError } from '../lib/request';

const DEMO_ROWS = [
  { id: 'A1001', name: '华东网点巡检', owner: '张三', status: '进行中' },
  { id: 'A1002', name: '政策核对', owner: '李四', status: '已完成' },
  { id: 'A1003', name: '客户回访', owner: '王五', status: '待处理' },
];

export function DemoPage() {
  const [loading, setLoading] = useState(false);

  const onProbe = async () => {
    setLoading(true);
    try {
      await http.get('/api/health');
      message.success('请求成功（/api/health）');
    } catch (error) {
      if (error instanceof RequestError) {
        message.warning(`请求封装已生效：HTTP ${error.status}（可替换为真实接口）`);
      } else if (error instanceof Error && error.name === 'AbortError') {
        message.error('请求超时');
      } else {
        message.info('请求已发出（网络层或 CORS 拦截），封装逻辑可用');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          antd 组件示例
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          表单、表格、标签等默认组件已可用；业务页可直接复用。
        </Typography.Paragraph>
      </div>

      <Card title="筛选表单">
        <Form layout="inline" onFinish={() => message.success('已提交筛选条件')}>
          <Form.Item name="keyword" label="关键词">
            <Input allowClear placeholder="名称 / 单号" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 140 }}
              options={[
                { value: 'todo', label: '待处理' },
                { value: 'doing', label: '进行中' },
                { value: 'done', label: '已完成' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                查询
              </Button>
              <Button loading={loading} onClick={() => void onProbe()}>
                试请求封装
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card title="数据表格" bordered={false}>
        <Table
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={DEMO_ROWS}
          columns={[
            { title: '编号', dataIndex: 'id', width: 120 },
            { title: '名称', dataIndex: 'name' },
            { title: '负责人', dataIndex: 'owner', width: 120 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 120,
              render: (value: string) => (
                <Tag color={value === '已完成' ? 'success' : value === '进行中' ? 'processing' : 'default'}>
                  {value}
                </Tag>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}

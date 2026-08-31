import { Button, Form, Input, Select, Table, Tag } from 'antd';
import { ContentSection } from '../components/ContentSection';

const EXAMPLE_ROWS = [
  { id: 'example-1', name: '示例内容', owner: '示例用户', status: '启用' },
];

export function DemoPage() {
  return (
    <>
      <ContentSection title="基础表单">
        <Form layout="inline">
          <Form.Item name="keyword" label="关键词">
            <Input allowClear placeholder="请输入关键词" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 140 }}
              options={[
                { value: 'enabled', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary">提交</Button>
          </Form.Item>
        </Form>
      </ContentSection>

      <ContentSection title="基础表格">
        <Table
          rowKey="id"
          pagination={false}
          dataSource={EXAMPLE_ROWS}
          columns={[
            { title: '编号', dataIndex: 'id', width: 120 },
            { title: '名称', dataIndex: 'name' },
            { title: '负责人', dataIndex: 'owner', width: 120 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 120,
              render: (value: string) => <Tag color="success">{value}</Tag>,
            },
          ]}
        />
      </ContentSection>
    </>
  );
}

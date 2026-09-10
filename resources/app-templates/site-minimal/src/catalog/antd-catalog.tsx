import { z } from 'zod';
import { Button, Input, Pagination, Space, Table, Typography } from 'antd';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';

/**
 * Ant Design Catalog — 给用户 AI 做查询/列表页用的白名单组件。
 * 同一 surface 只能用一个 catalogId；antd 页不要混用 basic 的 Column/Text。
 */

const AntdTextApi = {
  name: 'AntdText',
  schema: z.object({
    text: CommonSchemas.DynamicString,
    strong: CommonSchemas.DynamicBoolean.optional(),
  }),
};

export const AntdText = createComponentImplementation(AntdTextApi, ({ props }) => (
  <Typography.Title level={props.strong ? 4 : 5} style={{ marginTop: 0 }}>
    {props.text}
  </Typography.Title>
));

const AntdStackApi = {
  name: 'AntdStack',
  schema: z.object({
    children: z.array(z.string()).optional(),
  }),
};

export const AntdStack = createComponentImplementation(AntdStackApi, ({ props, buildChild }) => (
  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {(props.children ?? []).map((childId: string) => (
      <div key={childId}>{buildChild?.(childId)}</div>
    ))}
  </Space>
));

const AntdButtonApi = {
  name: 'AntdButton',
  schema: z.object({
    text: CommonSchemas.DynamicString,
    type: z.enum(['primary', 'default', 'dashed', 'link', 'text']).optional(),
    onClick: CommonSchemas.Action.optional(),
  }),
};

export const AntdButton = createComponentImplementation(AntdButtonApi, ({ props }) => (
  <Button type={props.type ?? 'default'} onClick={props.onClick}>
    {props.text}
  </Button>
));

const AntdInputApi = {
  name: 'AntdInput',
  schema: z.object({
    value: CommonSchemas.DynamicString.optional(),
    placeholder: CommonSchemas.DynamicString.optional(),
    allowClear: CommonSchemas.DynamicBoolean.optional(),
  }),
};

export const AntdInput = createComponentImplementation(AntdInputApi, ({ props }) => (
  <Input
    value={props.value ?? ''}
    placeholder={props.placeholder ?? ''}
    allowClear={props.allowClear ?? true}
    onChange={(e) => props.setValue?.(e.target.value)}
    style={{ minWidth: 180 }}
  />
));

const AntdFilterBarApi = {
  name: 'AntdFilterBar',
  schema: z.object({
    keyword: CommonSchemas.DynamicString.optional(),
    placeholder: CommonSchemas.DynamicString.optional(),
    onSearch: CommonSchemas.Action.optional(),
  }),
};

export const AntdFilterBar = createComponentImplementation(AntdFilterBarApi, ({ props }) => (
  <Space wrap style={{ marginBottom: 4 }}>
    <Input
      value={props.keyword ?? ''}
      placeholder={props.placeholder ?? '请输入关键词'}
      allowClear
      onChange={(e) => props.setKeyword?.(e.target.value)}
      onPressEnter={() => props.onSearch?.()}
      style={{ width: 240 }}
    />
    <Button type="primary" onClick={props.onSearch}>
      查询
    </Button>
  </Space>
));

const columnSchema = z.object({
  title: z.string(),
  dataIndex: z.string(),
  key: z.string().optional(),
  width: z.number().optional(),
});

const AntdTableApi = {
  name: 'AntdTable',
  schema: z.object({
    columns: z.array(columnSchema).optional(),
    dataSource: z.array(z.record(z.string(), z.unknown())).optional(),
    loading: CommonSchemas.DynamicBoolean.optional(),
    rowKey: CommonSchemas.DynamicString.optional(),
    size: z.enum(['small', 'middle', 'large']).optional(),
  }),
};

export const AntdTable = createComponentImplementation(AntdTableApi, ({ props }) => {
  const columns = (props.columns ?? []).map((col) => ({
    ...col,
    key: col.key ?? col.dataIndex,
  }));
  return (
    <Table
      size={props.size ?? 'middle'}
      loading={Boolean(props.loading)}
      rowKey={props.rowKey || 'id'}
      columns={columns}
      dataSource={props.dataSource ?? []}
      pagination={false}
    />
  );
});

const AntdPaginationApi = {
  name: 'AntdPagination',
  schema: z.object({
    current: CommonSchemas.DynamicNumber.optional(),
    pageSize: CommonSchemas.DynamicNumber.optional(),
    total: CommonSchemas.DynamicNumber.optional(),
    onChange: CommonSchemas.Action.optional(),
  }),
};

export const AntdPagination = createComponentImplementation(AntdPaginationApi, ({ props }) => (
  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
    <Pagination
      current={Number(props.current ?? 1)}
      pageSize={Number(props.pageSize ?? 10)}
      total={Number(props.total ?? 0)}
      showSizeChanger
      onChange={(page, pageSize) => {
        props.setCurrent?.(page);
        props.setPageSize?.(pageSize);
        props.onChange?.();
      }}
    />
  </div>
));

export const ANTD_CATALOG_ID = 'https://sclaw.local/catalogs/antd-v1.json';

export const antdCatalog = new Catalog(
  ANTD_CATALOG_ID,
  [AntdText, AntdStack, AntdButton, AntdInput, AntdFilterBar, AntdTable, AntdPagination],
  [],
);

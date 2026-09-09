import { z } from 'zod';
import { Button, Card, Input, Pagination, Space, Table, Typography } from 'antd';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { A2uiStamp, resolveA2uiCtxId } from '../runtime/a2ui-stamp';

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

export const AntdText = createComponentImplementation(AntdTextApi, ({ props, ...rest }) => (
  <A2uiStamp name="AntdText" id={resolveA2uiCtxId({ props, ...rest })}>
    <Typography.Title level={props.strong ? 4 : 5} style={{ marginTop: 0 }}>
      {props.text}
    </Typography.Title>
  </A2uiStamp>
));

const AntdStackApi = {
  name: 'AntdStack',
  schema: z.object({
    children: z.array(z.string()).optional(),
  }),
};

export const AntdStack = createComponentImplementation(AntdStackApi, ({ props, buildChild, ...rest }) => (
  <A2uiStamp name="AntdStack" id={resolveA2uiCtxId({ props, buildChild, ...rest })}>
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {(props.children ?? []).map((childId: string) => (
        <div key={childId} data-a2ui-component-id={childId} style={{ display: 'contents' }}>
          {buildChild?.(childId)}
        </div>
      ))}
    </Space>
  </A2uiStamp>
));

const AntdButtonApi = {
  name: 'AntdButton',
  schema: z.object({
    text: CommonSchemas.DynamicString,
    type: z.enum(['primary', 'default', 'dashed', 'link', 'text']).optional(),
    onClick: CommonSchemas.Action.optional(),
  }),
};

export const AntdButton = createComponentImplementation(AntdButtonApi, ({ props, ...rest }) => (
  <A2uiStamp name="AntdButton" id={resolveA2uiCtxId({ props, ...rest })}>
    <Button type={props.type ?? 'default'} onClick={props.onClick}>
      {props.text}
    </Button>
  </A2uiStamp>
));

const AntdInputApi = {
  name: 'AntdInput',
  schema: z.object({
    value: CommonSchemas.DynamicString.optional(),
    placeholder: CommonSchemas.DynamicString.optional(),
    allowClear: CommonSchemas.DynamicBoolean.optional(),
  }),
};

export const AntdInput = createComponentImplementation(AntdInputApi, (ctx) => (
  <A2uiStamp name="AntdInput" id={resolveA2uiCtxId(ctx)}>
    <Input
      value={ctx.props.value ?? ''}
      placeholder={ctx.props.placeholder ?? ''}
      allowClear={ctx.props.allowClear ?? true}
      onChange={(e) => ctx.props.setValue?.(e.target.value)}
      style={{ minWidth: 180 }}
    />
  </A2uiStamp>
));

const AntdFilterBarApi = {
  name: 'AntdFilterBar',
  schema: z.object({
    keyword: CommonSchemas.DynamicString.optional(),
    placeholder: CommonSchemas.DynamicString.optional(),
    onSearch: CommonSchemas.Action.optional(),
  }),
};

export const AntdFilterBar = createComponentImplementation(AntdFilterBarApi, (ctx) => (
  <A2uiStamp name="AntdFilterBar" id={resolveA2uiCtxId(ctx)}>
    <Space wrap style={{ marginBottom: 4 }}>
      <Input
        value={ctx.props.keyword ?? ''}
        placeholder={ctx.props.placeholder ?? '请输入关键词'}
        allowClear
        onChange={(e) => ctx.props.setKeyword?.(e.target.value)}
        onPressEnter={() => ctx.props.onSearch?.()}
        style={{ width: 240 }}
      />
      <Button type="primary" onClick={ctx.props.onSearch}>
        查询
      </Button>
    </Space>
  </A2uiStamp>
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

export const AntdTable = createComponentImplementation(AntdTableApi, (ctx) => {
  const columns = (ctx.props.columns ?? []).map((col) => ({
    ...col,
    key: col.key ?? col.dataIndex,
  }));
  return (
    <A2uiStamp name="AntdTable" id={resolveA2uiCtxId(ctx)}>
      <Table
        size={ctx.props.size ?? 'middle'}
        loading={Boolean(ctx.props.loading)}
        rowKey={ctx.props.rowKey || 'id'}
        columns={columns}
        dataSource={ctx.props.dataSource ?? []}
        pagination={false}
      />
    </A2uiStamp>
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

export const AntdPagination = createComponentImplementation(AntdPaginationApi, (ctx) => (
  <A2uiStamp name="AntdPagination" id={resolveA2uiCtxId(ctx)}>
    <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
      <Pagination
        current={Number(ctx.props.current ?? 1)}
        pageSize={Number(ctx.props.pageSize ?? 10)}
        total={Number(ctx.props.total ?? 0)}
        showSizeChanger
        onChange={(page, pageSize) => {
          ctx.props.setCurrent?.(page);
          ctx.props.setPageSize?.(pageSize);
          ctx.props.onChange?.();
        }}
      />
    </div>
  </A2uiStamp>
));

const AntdStatCardApi = {
  name: 'AntdStatCard',
  schema: z.object({
    title: CommonSchemas.DynamicString.optional(),
    value: CommonSchemas.DynamicString.optional(),
    prefix: CommonSchemas.DynamicString.optional(),
    suffix: CommonSchemas.DynamicString.optional(),
  }),
};

export const AntdStatCard = createComponentImplementation(AntdStatCardApi, (ctx) => (
  <A2uiStamp name="AntdStatCard" id={resolveA2uiCtxId(ctx)}>
    <Card size="small" styles={{ body: { padding: 16 } }}>
      <Typography.Text type="secondary">{ctx.props.title ?? ''}</Typography.Text>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 600, lineHeight: 1.2, color: 'var(--sto-color-text)' }}>
        {ctx.props.prefix ?? ''}{ctx.props.value ?? ''}{ctx.props.suffix ?? ''}
      </div>
    </Card>
  </A2uiStamp>
));

export const ANTD_CATALOG_ID = 'https://sclaw.local/catalogs/antd-v1.json';

export const antdCatalog = new Catalog(
  ANTD_CATALOG_ID,
  [AntdText, AntdStack, AntdButton, AntdInput, AntdFilterBar, AntdTable, AntdPagination, AntdStatCard],
  [],
);

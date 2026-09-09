import { describe, expect, it } from 'vitest';
import {
  applyA2uiVisibleText,
  composeA2uiFormattedValue,
  findA2uiComponent,
  insertA2uiModule,
  patchA2uiComponentProps,
  patchA2uiDataModelPath,
  type A2uiMessage,
} from '@/lib/app-dev-a2ui-page';
import { builderMetaToModuleFragment, parseComponentBuilderContract, findBuilderComponentMeta } from '@/lib/app-dev-component-builder';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sample: A2uiMessage[] = [
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'home',
      components: [
        { id: 'root', component: 'AntdStack', children: ['title'] },
        { id: 'title', component: 'AntdText', text: { path: '/title' }, strong: true },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'home',
      path: '/',
      value: { title: '欢迎' },
    },
  },
];

describe('app-dev a2ui page patch', () => {
  it('patches literal props and data model paths', () => {
    const withStrong = patchA2uiComponentProps(sample, 'title', { strong: false });
    expect(findA2uiComponent(withStrong, 'title')?.strong).toBe(false);
    const withTitle = patchA2uiDataModelPath(sample, '/title', '客户');
    const data = withTitle[1]?.updateDataModel as { value: { title: string } };
    expect(data.value.title).toBe('客户');
  });

  it('writes visible text to literals or bound data model', () => {
    const literalPage: A2uiMessage[] = [{
      updateComponents: {
        components: [{ id: 'btn', component: 'AntdButton', text: '返回' }],
      },
    }];
    expect(findA2uiComponent(applyA2uiVisibleText(literalPage, 'btn', '首页'), 'btn')?.text).toBe('首页');
    const bound = applyA2uiVisibleText(sample, 'title', '客户');
    const data = bound[1]?.updateDataModel as { value: { title: string } };
    expect(data.value.title).toBe('客户');
  });

  it('composes prefix / suffix / precision', () => {
    expect(composeA2uiFormattedValue('12.345', { prefix: '¥', suffix: '万', precision: 2 })).toBe('¥12.35万');
  });

  it('inserts a module under a stack and remaps ids', () => {
    const next = insertA2uiModule(sample, 'root', {
      id: 'kpi-card',
      name: '指标卡',
      catalogId: 'antd',
      parentHint: 'AntdStack',
      components: [
        { id: 'kpi-card', component: 'AntdStatCard', title: { path: '/kpi/title' } },
      ],
      dataDefaults: { kpi: { title: '指标', value: '0' } },
    });
    const root = findA2uiComponent(next, 'root');
    expect(root?.children).toEqual(['title', 'kpi-card']);
    expect(findA2uiComponent(next, 'kpi-card')?.component).toBe('AntdStatCard');
    const data = next[1]?.updateDataModel as { value: { kpi: { title: string } } };
    expect(data.value.kpi.title).toBe('指标');
  });

  it('parses template component-builder contract', () => {
    const raw = JSON.parse(readFileSync(
      join(process.cwd(), 'resources/app-templates/assets-minimal/contracts/component-builder.v1.json'),
      'utf8',
    ));
    const contract = parseComponentBuilderContract(raw);
    expect(findBuilderComponentMeta(contract, 'AntdStatCard')?.nameZh).toBe('指标卡');
    expect(findBuilderComponentMeta(contract, 'AntdTable')?.dataFields.some((f) => f.key === 'dataSource')).toBe(true);
    const card = findBuilderComponentMeta(contract, 'AntdStatCard');
    expect(builderMetaToModuleFragment(card!).components[0]?.component).toBe('AntdStatCard');
    expect(findBuilderComponentMeta(contract, 'AntdButton')?.styleFields.some((f) => f.key === 'type')).toBe(true);
  });
});

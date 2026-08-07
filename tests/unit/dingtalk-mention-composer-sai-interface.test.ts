import { describe, expect, it } from 'vitest';
import {
  createSaiInterfaceSpan,
  insertSaiInterfaceSpan,
  serializeMentionEditor,
} from '@/lib/dingtalk-mention-composer';

describe('dingtalk-mention-composer sai interface token', () => {
  it('shows Chinese name and serializes with path for the agent', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode('使用'));
    insertSaiInterfaceSpan(root, 'market.customer-business.search', '查询客户商务档案');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.plainText).toContain('使用');
    expect(snapshot.plainText).toContain('「查询客户商务档案」(market.customer-business.search)');
    expect(root.querySelector('.sai-interface-token')?.textContent).toBe('查询客户商务档案');
  });

  it('inserts multiple chips at caret without replacing earlier ones', () => {
    const root = document.createElement('div');
    insertSaiInterfaceSpan(root, 'a.b.c', '接口甲');
    insertSaiInterfaceSpan(root, 'd.e.f', '接口乙');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.plainText).toContain('「接口甲」(a.b.c)');
    expect(snapshot.plainText).toContain('「接口乙」(d.e.f)');
    expect(root.querySelectorAll('.sai-interface-token')).toHaveLength(2);
  });

  it('createSaiInterfaceSpan keeps path in dataset', () => {
    const span = createSaiInterfaceSpan('market.a30-service.query', '查询 A30 时效服务汇总数据');
    expect(span.dataset.saiPath).toBe('market.a30-service.query');
    expect(span.dataset.saiName).toBe('查询 A30 时效服务汇总数据');
    expect(span.textContent).toBe('查询 A30 时效服务汇总数据');
  });
});

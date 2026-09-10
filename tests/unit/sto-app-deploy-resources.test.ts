import { describe, expect, it } from 'vitest';
import {
  flattenDeployResourcePages,
  parseDeployResourceRecords,
} from '../../shared/sto-app-deploy-resources';

const indexUrl = 'https://assets.example/app/1.0.0/index.html';
const mainUrl = 'https://assets.example/app/1.0.0/main.js';

describe('sto app deploy resources', () => {
  it.each([
    (rows: unknown[]) => rows,
    (rows: unknown[]) => ({ data: rows }),
    (rows: unknown[]) => ({ result: { body: { data: rows } } }),
  ])('unwraps supported response envelope %#', (wrap) => {
    const records = parseDeployResourceRecords(wrap([{
      id: 862,
      app_name: 'test-2000001',
      env: 'daily',
      instance_id: 5591,
      pages: [indexUrl],
      available: true,
    }]));

    expect(records).toEqual([expect.objectContaining({
      id: 862,
      appName: 'test-2000001',
      instanceId: 5591,
      pages: [indexUrl],
      available: true,
    })]);
  });

  it('filters unsafe pages, deduplicates, and marks index as entry', () => {
    const records = parseDeployResourceRecords({
      data: [
        {
          id: 862,
          appName: 'test-2000001',
          env: 'daily',
          pages: [indexUrl, mainUrl, mainUrl, 'javascript:alert(1)', ''],
          available: true,
        },
        {
          id: 863,
          appName: 'test-2000001',
          env: 'daily',
          pages: [mainUrl, 'https://assets.example/app/service-worker.js'],
          available: false,
        },
      ],
    });

    expect(flattenDeployResourcePages(records)).toEqual([
      { url: indexUrl, fileName: 'index.html', entry: true, available: true },
      { url: mainUrl, fileName: 'main.js', entry: false, available: true },
      {
        url: 'https://assets.example/app/service-worker.js',
        fileName: 'service-worker.js',
        entry: false,
        available: false,
      },
    ]);
  });

  it('ignores invalid records and defaults missing pages to empty', () => {
    expect(parseDeployResourceRecords({ data: [null, 'bad', { id: 'bad' }] })).toEqual([]);
    expect(parseDeployResourceRecords({ data: [{ id: 1, app_name: 'demo' }] })[0].pages).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { resolveSiteAppGitGroup } from '../../shared/site-app-git-group';
import { setSiteDepartmentTypes } from '../../shared/site-user-utils';

describe('resolveSiteAppGitGroup', () => {
  beforeEach(() => {
    setSiteDepartmentTypes(null);
  });

  it('returns null when categoryCode or companyCode is missing', () => {
    expect(resolveSiteAppGitGroup({ categoryCode: '独立网点' })).toBeNull();
    expect(resolveSiteAppGitGroup({ companyCode: '432100' })).toBeNull();
    expect(resolveSiteAppGitGroup({})).toBeNull();
  });

  it('maps independent site to site + companyCode', () => {
    setSiteDepartmentTypes(['独立网点', '承包区', '网点部门', '丹鸟加盟站点']);
    expect(
      resolveSiteAppGitGroup({
        categoryCode: '独立网点',
        companyCode: '432100',
      }),
    ).toEqual({ groupType: 'site', groupCode: '432100' });
  });

  it('falls back to site keywords when Apollo cache is empty', () => {
    expect(
      resolveSiteAppGitGroup({
        categoryCode: '独立网点',
        companyCode: '432100',
      }),
    ).toEqual({ groupType: 'site', groupCode: '432100' });
  });

  it('maps management area / provincial company to department + companyCode', () => {
    setSiteDepartmentTypes(['独立网点', '承包区']);
    expect(
      resolveSiteAppGitGroup({
        categoryCode: '管理区',
        companyCode: '000096',
      }),
    ).toEqual({ groupType: 'department', groupCode: '000096' });
  });

  it('maps headquarters category to headquarters + companyCode', () => {
    setSiteDepartmentTypes(['独立网点', '承包区']);
    expect(
      resolveSiteAppGitGroup({
        categoryCode: '总公司',
        companyCode: '2155',
      }),
    ).toEqual({ groupType: 'headquarters', groupCode: '2155' });

    expect(
      resolveSiteAppGitGroup({
        categoryCode: '总部',
        companyCode: '2155',
      }),
    ).toEqual({ groupType: 'headquarters', groupCode: '2155' });
  });

  it('trims whitespace on category and company codes', () => {
    setSiteDepartmentTypes(['独立网点']);
    expect(
      resolveSiteAppGitGroup({
        categoryCode: ' 独立网点 ',
        companyCode: ' 432100 ',
      }),
    ).toEqual({ groupType: 'site', groupCode: '432100' });
  });
});
